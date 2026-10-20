import type {
  AiFailureCategory,
  DecisionSource,
  EmailMessage,
  EmailThread,
  MessageAttachment,
  Quote,
  QuoteDocument,
  ThreadMatchMethod,
} from "@/types/domain";
import { getAppConfig } from "../config.ts";
import { store } from "../store/session-store.ts";
import {
  dedupe,
  extractMessageIds,
  getHeaderValue,
  normalizeRfcMessageId,
} from "./rfc-message-id.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { upsertMessageIdAliasToSupabase } from "../db/supabase.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { renderQuotePdf } from "../documents/pdf-renderer.ts";
import { parseInboundDocument } from "../documents/inbound-document-parser.ts";
import { decideNextAction } from "../ai/sales-engineer.ts";
import type { AiProvider } from "../ai/gemini-provider.ts";
import {
  sendQuoteEmail,
  sendClarificationEmail,
  sendUnpriceableNotificationEmail,
  sendNonSubstantiveReplyEmail,
  sendFinalYieldEmail,
  extractSignatureName,
  type OutboundDispatchResult,
} from "./resend-outbound.ts";
import {
  triageInboundEmail,
  buildClarificationQuestions,
  INTAKE_UNITS,
  UNIT_TO_FIELD_KEY,
} from "../extraction/extractor.ts";

export interface InboundAttachmentPayload {
  filename: string;
  contentType?: string;
  /** Buffer, Uint8Array, or base64 string */
  content?: Buffer | Uint8Array | string;
  sizeBytes?: number;
}

export interface InboundEmailPayload {
  providerMessageId: string;
  messageId?: string | null;
  from: string;
  fromName?: string | null;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string | string[]> | null;
  receivedAt?: string;
  /** Optional email attachments (PDF, Excel, CSV, text, images, Word) */
  attachments?: InboundAttachmentPayload[];
}

export interface InboundProcessingResult {
  threadId: string;
  duplicate: boolean;
  actionTaken:
    | "quoted"
    | "clarification_requested"
    | "unsupported"
    | "dropped_loop"
    | "rejected_recipient"
    | "error";
  status?: "NEEDS_INFO" | "QUOTED" | "UNSUPPORTED" | "DROPPED_LOOP" | "REJECTED_RECIPIENT";
  quote?: Quote;
  pdfGenerated?: boolean;
  outboundResult?: OutboundDispatchResult;
  message?: string;
  /** Which component decided this thread: the AI sales engineer or the rules fallback. */
  decisionSource?: DecisionSource;
  /** Model identifier when the AI decided; null when the fallback did. */
  decisionModel?: string | null;
  /** Set when the AI path was attempted and could not be used. */
  aiFailureCategory?: AiFailureCategory | null;
}

const inFlightMessageIds = new Set<string>();
const threadLocks = new Map<string, Promise<unknown>>();

async function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = threadLocks.get(threadId) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  threadLocks.set(threadId, gate);
  await prev;
  try {
    return await fn();
  } finally {
    release!();
    if (threadLocks.get(threadId) === gate) {
      threadLocks.delete(threadId);
    }
  }
}

/**
 * Core Inbound Email Pipeline for Quote24x7.
 * Receives an email, links it to a thread, runs the AI sales engineer (with the
 * deterministic rules engine as fallback), calculates pricing options against
 * the active catalogue, generates a proposal PDF, and transmits the outbound
 * reply via Resend.
 *
 * `provider` is an injection seam for tests. Production passes nothing and the
 * live Gemini adapter is used.
 */
export async function processInboundEmail(
  payload: InboundEmailPayload,
  provider?: AiProvider
): Promise<InboundProcessingResult> {
  await store.ensureInitializedAsync();
  const config = getAppConfig();
  const now = payload.receivedAt || new Date().toISOString();
  const providerMessageId = (
    payload.providerMessageId ||
    payload.messageId ||
    `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
  ).trim();
  const rfcMessageId = payload.messageId?.trim() || null;

  // 1. Idempotency & In-Flight Check (Deduplicate by Message-ID)
  const isDuplicateId =
    inFlightMessageIds.has(providerMessageId) ||
    store.isMessageProcessed(providerMessageId) ||
    Boolean(store.getMessageByProviderMessageId(providerMessageId)) ||
    (rfcMessageId !== null &&
      (inFlightMessageIds.has(rfcMessageId) ||
        store.isMessageProcessed(rfcMessageId) ||
        Boolean(store.getMessageByProviderMessageId(rfcMessageId))));

  if (isDuplicateId) {
    // Locate existing thread
    const allThreads = store.getThreads();
    const existingThread =
      allThreads.find(
        (t) =>
          t.providerThreadId === providerMessageId ||
          (rfcMessageId !== null && t.providerThreadId === rfcMessageId)
      ) ||
      allThreads.find((t) => {
        const msgs = store.getMessages(t.id);
        return msgs.some(
          (m) =>
            m.providerMessageId === providerMessageId ||
            (rfcMessageId !== null && m.providerMessageId === rfcMessageId)
        );
      }) ||
      allThreads[0];
    return {
      threadId: existingThread?.id ?? "unknown",
      duplicate: true,
      actionTaken: "dropped_loop",
      status: "DROPPED_LOOP",
      message: `Message with ID "${providerMessageId}" is in-flight or was already processed. Replay discarded.`,
    };
  }

  // Claim the message ID before processing. With Supabase this is an insert
  // against the processed_messages primary key, so a simultaneous retry (same
  // or different serverless instance) is rejected at the database level.
  const claimed = await store.claimInboundMessage(providerMessageId);
  if (!claimed) {
    const allThreads = store.getThreads();
    const existingThread =
      allThreads.find(
        (t) =>
          t.providerThreadId === providerMessageId ||
          (rfcMessageId !== null && t.providerThreadId === rfcMessageId)
      ) ||
      allThreads.find((t) => {
        const msgs = store.getMessages(t.id);
        return msgs.some(
          (m) =>
            m.providerMessageId === providerMessageId ||
            (rfcMessageId !== null && m.providerMessageId === rfcMessageId)
        );
      }) ||
      allThreads[0];
    return {
      threadId: existingThread?.id ?? "unknown",
      duplicate: true,
      actionTaken: "dropped_loop",
      status: "DROPPED_LOOP",
      message: `Message with ID "${providerMessageId}" was already claimed by a concurrent request. Replay discarded.`,
    };
  }

  // Claim the RFC Message-ID too if present, so a provider retry carrying a
  // different internal ID but the same RFC Message-ID is also blocked.
  if (rfcMessageId) {
    if (!(await store.claimInboundMessage(rfcMessageId))) {
      // A different instance already processed this RFC Message-ID — treat as
      // a duplicate and discard. Release the providerMessageId claim we just
      // made so the legitimate owner's record is not orphaned.
      await store.releaseInboundMessage(providerMessageId);
      const allThreads = store.getThreads();
      const existingThread =
        allThreads.find(
          (t) =>
            t.providerThreadId === rfcMessageId ||
            allThreads.find((t2) =>
              store.getMessages(t2.id).some((m) => m.providerMessageId === rfcMessageId)
            ) !== undefined
        ) ||
        allThreads.find((t) => {
          const msgs = store.getMessages(t.id);
          return msgs.some((m) => m.providerMessageId === rfcMessageId);
        }) ||
        allThreads[0];
      return {
        threadId: existingThread?.id ?? "unknown",
        duplicate: true,
        actionTaken: "dropped_loop",
        status: "DROPPED_LOOP",
        message: `Message with RFC-ID "${rfcMessageId}" was already claimed. Replay discarded.`,
      };
    }
  }

  inFlightMessageIds.add(providerMessageId);
  if (rfcMessageId) inFlightMessageIds.add(rfcMessageId);

  try {
    const senderKey = extractEmail(payload.from) || providerMessageId;
    const result = await withThreadLock(senderKey, () =>
      doProcessInboundEmail(payload, config, now, providerMessageId, rfcMessageId, provider)
    );
    await store.flushPendingWrites();
    return result;
  } catch (err) {
    // Release the claim so a provider retry can reprocess this message.
    // This only happens on unexpected failure; normal duplicate drops return
    // earlier and keep the claim.
    await store.releaseInboundMessage(providerMessageId);
    if (rfcMessageId) await store.releaseInboundMessage(rfcMessageId);
    await store.flushPendingWrites();
    throw err;
  } finally {
    inFlightMessageIds.delete(providerMessageId);
    if (rfcMessageId) inFlightMessageIds.delete(rfcMessageId);
  }
}

export function classifyInboundEmail(
  payload: InboundEmailPayload,
  systemSenderEmail: string
): { drop: boolean; reason: string | null } {
  const headers = payload.headers || {};
  const getHdr = (key: string): string => {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === key.toLowerCase()) return String(v).trim();
    }
    return "";
  };

  const senderEmail = payload.from.replace(/^.*?<([^>]+)>.*$/, "$1").trim().toLowerCase();
  const cleanSystemEmail = systemSenderEmail.replace(/^.*?<([^>]+)>.*$/, "$1").trim().toLowerCase();
  const fromName = (payload.fromName || "").toLowerCase();
  const lowerSubject = payload.subject.toLowerCase();
  const lowerText = payload.text.toLowerCase();

  // 1. Auto-Submitted
  const autoSubmitted = getHdr("auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    return { drop: true, reason: `Auto-Submitted header present: ${autoSubmitted}` };
  }
  if (lowerText.includes("auto-submitted: auto-generated") || lowerText.includes("auto-submitted: auto-replied")) {
    return { drop: true, reason: "Auto-Submitted detected in message text" };
  }

  // 2. Precedence: bulk, junk, list, auto_reply
  const precedence = getHdr("precedence") || getHdr("x-precedence");
  if (precedence && /^(?:bulk|junk|list|auto_reply)$/i.test(precedence)) {
    return { drop: true, reason: `Precedence header indicates automated/bulk: ${precedence}` };
  }

  // 3. noreply / mailer-daemon / bounce / postmaster / self-loop / test sinks
  const senderDomain = senderEmail.split("@")[1] || "";
  const systemDomain = cleanSystemEmail.split("@")[1] || "";
  const config = getAppConfig();
  const inboundDomain = (config.inboundAddress || "").split("@")[1] || "";

  const isOwnDomain =
    (systemDomain.length > 0 && (senderDomain === systemDomain || senderDomain.endsWith(`.${systemDomain}`))) ||
    (inboundDomain.length > 0 && (senderDomain === inboundDomain || senderDomain.endsWith(`.${inboundDomain}`))) ||
    senderDomain === "quotes.joanathan.in" ||
    senderDomain === "joanathan.in";

  if (isOwnDomain) {
    return { drop: true, reason: `Sender is from our own domain: ${senderEmail}` };
  }

  if (
    senderEmail.startsWith("noreply@") ||
    senderEmail.startsWith("no-reply@") ||
    senderEmail.includes("-noreply@") ||
    senderEmail.startsWith("mailer-daemon@") ||
    senderEmail.startsWith("postmaster@") ||
    senderEmail.startsWith("bounce@") ||
    senderEmail.startsWith("bounces@") ||
    senderEmail === "delivered@resend.dev" ||
    fromName.includes("no-reply") ||
    fromName.includes("noreply") ||
    fromName.includes("mailer-daemon") ||
    fromName.includes("postmaster") ||
    (cleanSystemEmail.length > 0 &&
      (senderEmail === cleanSystemEmail ||
        senderEmail.includes(cleanSystemEmail) ||
        cleanSystemEmail.includes(senderEmail)))
  ) {
    return { drop: true, reason: `Sender is automated, bounce, or system sender address: ${senderEmail}` };
  }

  // 4. List headers (List-Id, List-Unsubscribe, etc.)
  const listHeaders = ["list-id", "list-unsubscribe", "list-help", "list-post", "list-owner", "list-archive"];
  for (const lh of listHeaders) {
    if (getHdr(lh)) {
      return { drop: true, reason: `Mailing list header detected: ${lh}` };
    }
  }

  // 5. DMARC reports
  const isDmarc =
    lowerSubject.includes("report domain:") ||
    lowerSubject.includes("dmarc report") ||
    lowerSubject.includes("dmarc aggregate") ||
    lowerSubject.includes("dmarc forensic") ||
    lowerSubject.includes("dmarc-report") ||
    (lowerSubject.includes("dmarc") && (lowerSubject.includes("report") || lowerSubject.includes("rua") || lowerSubject.includes("ruf"))) ||
    senderEmail.includes("dmarc") ||
    getHdr("content-type").includes("report-type=dmarc-xml");
  if (isDmarc) {
    return { drop: true, reason: "DMARC aggregate/forensic report detected" };
  }

  // 6. Ticket-bot subjects
  const isTicketBot =
    /\[(?:ticket|case|request|issue|incident|helpdesk)\s*(?:#|id:?|no:?)?\s*[\w-]+\]/i.test(payload.subject) ||
    /^(?:ticket\s+created|new\s+ticket|support\s+request|helpdesk\s+ticket|auto-reply:\s*\[ticket)/i.test(payload.subject) ||
    /\b(?:zendesk|servicenow|jira|freshdesk|zoho\s*desk)\b/i.test(payload.subject) ||
    /\[#[0-9]{4,}\]/.test(payload.subject);
  if (isTicketBot) {
    return { drop: true, reason: `Ticket-bot notification subject detected: ${payload.subject}` };
  }

  // 7. Standard auto-replies and loop prevention
  const isAutoReply =
    lowerSubject.startsWith("auto:") ||
    lowerSubject.startsWith("automatic reply:") ||
    lowerSubject.startsWith("out of office:") ||
    lowerText.includes("automated response") ||
    lowerText.includes("out of the office") ||
    lowerText.includes("auto-submitted") ||
    payload.text.includes("Quote24x7 Automated Operations Team") ||
    payload.text.includes("Quote24x7 Operations & Solutions Team");
  if (isAutoReply) {
    return { drop: true, reason: "Automated auto-reply or loop message detected" };
  }

  return { drop: false, reason: null };
}

export function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/);
  return (match && match[1] ? match[1] : str).trim().toLowerCase();
}

/**
 * Whether this message was actually addressed to the mailbox we answer.
 *
 * Resend's inbound webhook fires for every address on the receiving domain, so
 * mail to hello@ reaches this pipeline exactly like mail to quotes@ does. Only
 * the configured mailbox opens a thread and spends an AI call; everything else
 * is acknowledged and discarded.
 *
 * Matching is exact, not suffix- or substring-based: `quotes@joanathan.in` is
 * accepted and `hello@joanathan.in` is not. `+tag` sub-addressing is folded into
 * the base mailbox, since Resend delivers `quotes+ref9@` to the same inbox and
 * the "ref" convention is already used elsewhere in this pipeline.
 *
 * A payload with no usable recipient (empty, or only malformed entries) is
 * accepted rather than dropped: a missing `to` is a gap in the upstream event,
 * not evidence the mail was sent elsewhere, and silently discarding real quote
 * requests is the worse failure. Genuine flood risk is handled by the classifier
 * and by the per-mailbox routing itself.
 */
export function isAddressedToOurMailbox(
  to: string[] | string | undefined | null,
  mailbox: string
): boolean {
  const recipients = (Array.isArray(to) ? to : to === undefined || to === null ? [] : [to])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => foldSubAddress(extractEmail(entry)))
    .filter(Boolean);

  if (recipients.length === 0) return true;

  const target = foldSubAddress(extractEmail(mailbox));
  const [rawTargetLocal, rawTargetDomain] = target.split("@");
  const targetLocal = (rawTargetLocal || "").toLowerCase();
  const targetDomain = (rawTargetDomain || "").toLowerCase();

  return recipients.some((r) => {
    if (r === target) return true;
    const [rawRLocal, rawRDomain] = r.split("@");
    const rLocal = (rawRLocal || "").toLowerCase();
    const rDomain = (rawRDomain || "").toLowerCase();

    if (
      rLocal === targetLocal &&
      (rDomain === targetDomain ||
        rDomain.endsWith(".internal") ||
        rDomain.endsWith(".example.com"))
    ) {
      return true;
    }

    return false;
  });
}

/** Fold an RFC 5233-style `+tag` sub-address into its base mailbox, preserving the
 * full `local@domain` form. e.g. `quotes+ref9@joanathan.in` -> `quotes@joanathan.in`. */
function foldSubAddress(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const base = email.slice(0, at).split("+")[0];
  return `${base}${email.slice(at)}`;
}

export function cleanSubject(sub: string): string {
  return sub
    .replace(/^(?:re|fwd):\s*/gi, "")
    .replace(/\[ref:\s*#(?:th|qt)_\w+\]/gi, "")
    .replace(/\s*-\s*sizing\s+information\s+needed/gi, "")
    .replace(/\s*-\s*sizing\s+&\s+custom\s+pricing\s+notice/gi, "")
    .replace(/\s*-\s*quick\s+sizing\s+clarification/gi, "")
    .replace(/\s*-\s*ref\s+#\w+/gi, "")
    .replace(/^(?:re|fwd):\s*/gi, "")
    .trim()
    .toLowerCase();
}

export function stripQuotedEmail(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith(">") ||
      /^on\s+.*wrote:$/i.test(trimmed) ||
      /^-----original message-----/i.test(trimmed) ||
      /^(?:from|sent|to|subject):\s+/i.test(trimmed)
    ) {
      break;
    }
    result.push(line);
  }
  const clean = result.join("\n").trim();
  return clean.length > 0 ? clean : text;
}

export interface UnmentionedCategoriesCheck {
  unmentioned: boolean;
  missingCategories: string[];
  singleQuestion: string;
}

export function checkUnmentionedCategories(
  demand: import("../pricing/engine.ts").PricingDemand,
  cumulativeText: string,
  priorInboundCount: number
): UnmentionedCategoriesCheck {
  // If prior inbound turns exist, categories are answered or ruled out by the buyer's reply
  if (priorInboundCount > 0) {
    return { unmentioned: false, missingCategories: [], singleQuestion: "" };
  }

  const lower = cumulativeText.toLowerCase();

  // Explicit rule-out / exclusion phrases
  const ruledOut =
    /\b(?:only\s+(?:need\s+)?servers?|just\s+servers?|servers?\s+only|solely\s+servers?|strictly\s+servers?|no\s+other\s+monitoring|nothing\s+else|no\s+(?:websites?|apps?|applications?|network)|don'?t\s+need\s+(?:websites?|apps?|applications?|network)|do\s+not\s+need\s+(?:websites?|apps?|applications?|network)|none\s+of\s+the\s+other)\b/i.test(
      lower
    );
  if (ruledOut) {
    return { unmentioned: false, missingCategories: [], singleQuestion: "" };
  }

  const mentionsServers =
    demand.host_monitor > 0 ||
    /\b(?:servers?|hosts?|vms?|nodes?|instances?|linux|windows)\b/i.test(lower);

  const mentionsWebsites =
    demand.basic_monitor > 0 ||
    demand.advanced_monitor > 0 ||
    /\b(?:websites?|urls?|endpoints?|domains?|ping|uptime|synthetic|checks?|http)\b/i.test(lower);

  const mentionsApps =
    /\b(?:apps?|applications?|apm|java|python|node(?:\.js)?|\.net|php|microservices?|databases?)\b/i.test(lower);

  const mentionsNetwork =
    demand.network_component > 0 ||
    /\b(?:network|switches?|routers?|firewalls?|snmp|interfaces?)\b/i.test(lower);

  const mentionsRumLogs =
    demand.rum_pageview > 0 ||
    demand.applog_gb > 0 ||
    /\b(?:rum|pageviews?|logs?|applogs?)\b/i.test(lower);

  const otherCategoriesMentioned =
    mentionsWebsites || mentionsApps || mentionsNetwork || mentionsRumLogs;

  // If primary servers are stated but none of the other monitoring categories were mentioned or ruled out:
  if (mentionsServers && !otherCategoriesMentioned) {
    return {
      unmentioned: true,
      missingCategories: ["websites", "applications", "network devices"],
      singleQuestion: "Do you also require monitoring for websites, applications, or network devices?",
    };
  }

  return { unmentioned: false, missingCategories: [], singleQuestion: "" };
}

export function formatStatedWorkload(demand: import("../pricing/engine.ts").PricingDemand): string {
  const parts: string[] = [];
  if (demand.host_monitor > 0) {
    parts.push(`${demand.host_monitor} server${demand.host_monitor === 1 ? "" : "s"}`);
  }
  if (demand.basic_monitor > 0) {
    parts.push(`${demand.basic_monitor} website${demand.basic_monitor === 1 ? "" : "s"}`);
  }
  if (demand.advanced_monitor > 0) {
    parts.push(`${demand.advanced_monitor} advanced monitor${demand.advanced_monitor === 1 ? "" : "s"}`);
  }
  if (demand.network_component > 0) {
    parts.push(`${demand.network_component} network device${demand.network_component === 1 ? "" : "s"}`);
  }
  if (demand.rum_pageview > 0) {
    parts.push(`${demand.rum_pageview.toLocaleString("en-IN")} RUM pageviews`);
  }
  if (demand.applog_gb > 0) {
    parts.push(`${demand.applog_gb} GB logs`);
  }
  return parts.length > 0 ? parts.join(", ") : "stated workload";
}

async function doProcessInboundEmail(
  payload: InboundEmailPayload,
  config: ReturnType<typeof getAppConfig>,
  now: string,
  providerMessageId: string,
  rfcMessageId: string | null,
  aiProvider?: AiProvider
): Promise<InboundProcessingResult> {
  // 1. Classify Inbound Mail & Loop Prevention Check
  const classification = classifyInboundEmail(payload, config.outboundFromEmail);
  if (classification.drop) {
    store.markMessageProcessed(providerMessageId);
    if (rfcMessageId) store.markMessageProcessed(rfcMessageId);
    return {
      threadId: "classified_dropped",
      duplicate: false,
      actionTaken: "dropped_loop",
      status: "DROPPED_LOOP",
      message: `Inbound mail dropped by classifier: ${classification.reason}`,
    };
  }

  // 2. Thread Resolution (In-Reply-To / References -> Explicit Ref -> Sender/Subject)
  const isReply =
    payload.subject.toLowerCase().startsWith("re:") ||
    payload.subject.toLowerCase().startsWith("fwd:") ||
    payload.subject.toLowerCase().includes("re: ") ||
    payload.subject.toLowerCase().includes("[ref:");

  const normalizedSender = extractEmail(payload.from);
  let thread: EmailThread | undefined;
  let threadMatchMethod: ThreadMatchMethod = "new";

  // --- Item 6a: match a stored RFC id or an alias from the threading headers ---
  const headerTokens: string[] = [
    ...extractMessageIds(getHeaderValue(payload.headers, "in-reply-to")),
    ...extractMessageIds(getHeaderValue(payload.headers, "references")),
  ];

  for (const refId of headerTokens) {
    const matchedMsg = store.getMessageByProviderMessageId(refId);
    if (matchedMsg) {
      thread = store.getThread(matchedMsg.threadId);
      if (thread) {
        threadMatchMethod = "in_reply_to";
        break;
      }
    }
    const aliasedThreadId = store.getThreadIdByMessageIdAlias(refId);
    if (aliasedThreadId) {
      thread = store.getThread(aliasedThreadId);
      if (thread) {
        threadMatchMethod = "alias";
        break;
      }
    }
  }

  // --- Item 6b: same sender + normalized subject, exactly one open thread, 30d ---
  if (!thread) {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const targetClean = cleanSubject(payload.subject);
    const candidates = store.getThreads().filter((t) => {
      const tSender = extractEmail(t.senderEmail);
      if (tSender !== normalizedSender) return false;
      const lastAt = new Date(
        t.lastInboundAt || t.updatedAt || t.createdAt
      ).getTime();
      if (Date.now() - lastAt > thirtyDaysMs) return false;
      const tClean = cleanSubject(t.subject);
      return (
        tClean === targetClean ||
        tClean.includes(targetClean) ||
        targetClean.includes(tClean)
      );
    });

    if (candidates.length === 1) {
      const matchedThread = candidates[0]!;
      thread = matchedThread;
      threadMatchMethod = "subject_fallback";

      // Register every id we did not recognise as an alias of this thread's
      // latest outbound, so the buyer's client echoing a different id still
      // resolves next time.
      const latestOutbound = [...store.getMessages(matchedThread.id)]
        .reverse()
        .find((m) => m.direction === "outbound");
      const anchor = normalizeRfcMessageId(latestOutbound?.messageIdHeader);
      if (anchor) {
        for (const unknownId of headerTokens) {
          if (
            !store.getMessageByProviderMessageId(unknownId) &&
            !store.getThreadIdByMessageIdAlias(unknownId)
          ) {
            store.registerMessageIdAlias(unknownId, anchor);
            // Persist durably so the alias survives a restart or hits another
            // region; supabase helper is a no-op when no client is configured.
            void upsertMessageIdAliasToSupabase({
              aliasMessageId: unknownId,
              canonicalMessageId: anchor,
              threadId: matchedThread.id,
              source: "auto",
            });
          }
        }
      }
    }
  }

  // --- Item 6c: new mail without "Re:" from a sender with exactly one
  //     awaiting_reply thread inside 7 days continues that thread. ---
  if (!thread && !isReply) {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const awaiting = store.getThreads().filter((t) => {
      if (extractEmail(t.senderEmail) !== normalizedSender) return false;
      if (t.status !== "awaiting_reply") return false;
      const lastAt = new Date(
        t.lastInboundAt || t.updatedAt || t.createdAt
      ).getTime();
      return Date.now() - lastAt <= sevenDaysMs;
    });

    if (awaiting.length === 1) {
      thread = awaiting[0];
      threadMatchMethod = "awaiting_reply";
    }
  }

  // --- Legacy fallback: explicit #th_ / #qt_ reference in subject or body.
  //     Last resort only; these tokens are never written into outbound mail. ---
  if (!thread) {
    const threadRefMatch = (payload.subject + "\n" + payload.text).match(
      /#(th_\w+)/i
    );
    const quoteRefMatch = (payload.subject + "\n" + payload.text).match(
      /#(qt_\w+)/i
    );

    if (threadRefMatch && threadRefMatch[1]) {
      thread = store.getThread(threadRefMatch[1]);
    } else if (quoteRefMatch && quoteRefMatch[1]) {
      const quote = store.getQuote(quoteRefMatch[1]);
      if (quote) {
        thread = store.getThread(quote.threadId);
      }
    }
    if (thread) threadMatchMethod = "in_reply_to";
  }

  // If thread was already completed with a quote and receives identical duplicate content, discard replay
  if (thread && thread.status === "completed" && thread.quoteId) {
    const existingMsgs = store.getMessages(thread.id);
    const isDuplicateContent = existingMsgs.some(
      (m) => m.direction === "inbound" && m.bodyText.trim() === payload.text.trim()
    );
    if (isDuplicateContent) {
      return {
        threadId: thread.id,
        duplicate: true,
        actionTaken: "dropped_loop",
        message: `Thread ${thread.id} was already completed with quote #${thread.quoteId}. Discarding duplicate payload replay.`,
      };
    }
  }

  // 3. Recipient Check — this pipeline answers one mailbox only.
  // Resend's inbound webhook fires for every address on the receiving domain, so
  // mail to hello@ arrives here identically to mail to quotes@. Drop anything not
  // addressed to the configured mailbox before it can open a thread, and before it
  // can reach the AI. The vendor message ID is marked processed so a Resend retry
  // of the same delivery is not re-evaluated on every attempt.
  // This check runs AFTER the duplicate-content check above so that a replay of an
  // already-completed thread is correctly recognized as a duplicate regardless of
  // which mailbox address it was sent to.
  if (!isAddressedToOurMailbox(payload.to, config.inboundAddress)) {
    store.markMessageProcessed(providerMessageId);
    if (rfcMessageId) store.markMessageProcessed(rfcMessageId);
    return {
      threadId: "rejected_recipient",
      duplicate: false,
      actionTaken: "rejected_recipient",
      status: "REJECTED_RECIPIENT",
      message: `Inbound mail was not addressed to ${config.inboundAddress}. Recipients: ${payload.to.join(", ") || "(none)"}`,
    };
  }

  const sig = extractSignatureName(payload.text);
  const sigName = sig && sig.name && !/^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(sig.name)
    ? sig.name
    : null;

  if (!thread) {
    const newThreadId = `th_${Date.now()}`;
    thread = {
      id: newThreadId,
      provider: "resend",
      providerThreadId: providerMessageId,
      senderEmail: payload.from,
      senderName: payload.fromName || null,
      contactName: sigName,
      contact_name: sigName,
      organisation: null,
      subject: payload.subject,
      status: "received",
      requestType: payload.subject.toLowerCase().includes("proposal") ? "proposal" : "quote",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
      quoteId: null,
      quoteTotal: null,
      currency: "INR",
      statusDetail: null,
      state: "idle",
      roundsUsed: 0,
      nonproductiveStreak: 0,
      inboundCount: 1,
      lastInboundAt: now,
      subjectCanonical: cleanSubject(payload.subject),
    };
    store.saveThread(thread);
  } else {
    thread.inboundCount = (thread.inboundCount ?? 0) + 1;
    thread.lastInboundAt = now;
    if (sigName) {
      thread.contactName = sigName;
      thread.contact_name = sigName;
    }
    store.updateThread(thread.id, {
      inboundCount: thread.inboundCount,
      lastInboundAt: thread.lastInboundAt,
      contactName: thread.contactName,
      contact_name: thread.contact_name,
    });
  }

  // 4. Record Inbound Message & Parse Attachments (PDF, Excel, CSV, text, images, Word)
  const parsedAttachments: MessageAttachment[] = [];
  const attachmentTextSections: string[] = [];

  if (payload.attachments && payload.attachments.length > 0) {
    for (const att of payload.attachments) {
      try {
        const rawContent = att.content ?? (att as { buffer?: Buffer }).buffer;
        let buffer: Buffer;
        if (Buffer.isBuffer(rawContent)) {
          buffer = rawContent;
        } else if (rawContent instanceof Uint8Array) {
          buffer = Buffer.from(rawContent);
        } else if (typeof rawContent === "string") {
          const base64Data = rawContent.includes(";base64,")
            ? rawContent.split(";base64,")[1] || ""
            : rawContent;
          buffer = Buffer.from(base64Data, "base64");
        } else {
          buffer = Buffer.alloc(0);
        }

        const parsed = await parseInboundDocument({
          filename: att.filename,
          contentType: att.contentType,
          buffer,
        });

        parsedAttachments.push({
          name: att.filename,
          contentType: att.contentType || "application/octet-stream",
          sizeBytes: att.sizeBytes || buffer.length,
          scanned: true,
          extractedText: parsed.text,
          documentKind: parsed.documentKind,
          contentBase64: parsed.contentBase64,
        });

        if (parsed.text.trim()) {
          attachmentTextSections.push(
            `\n[Attached ${parsed.documentKind.toUpperCase()} File: "${att.filename}"]\n${parsed.text}`
          );
        }
      } catch (err) {
        console.error(`Failed to process attachment ${att.filename}:`, err);
        parsedAttachments.push({
          name: att.filename,
          contentType: att.contentType || "application/octet-stream",
          sizeBytes: att.sizeBytes || 0,
          scanned: true,
          documentKind: "other",
        });
      }
    }
  }

  // Item 5: case-insensitive lookup, string-or-array values, never throws.
  // Item 3: only real RFC tokens are stored. A provider UUID or a malformed value
  // is dropped rather than recorded, so it can never leak into an outbound chain.
  const inReplyToTokens = extractMessageIds(
    getHeaderValue(payload.headers, "in-reply-to")
  );
  const referencesTokens = dedupe([
    ...extractMessageIds(getHeaderValue(payload.headers, "references")),
  ]);
  const inReplyToHdrVal = inReplyToTokens[0] ?? null;
  const referencesHdrVal =
    referencesTokens.length > 0 ? referencesTokens.join(" ") : null;
  // The buyer's own id: the payload's RFC id if it is a real token, else the
  // message-id header, else null. Never the provider UUID.
  const buyerRfcId =
    normalizeRfcMessageId(rfcMessageId) ??
    normalizeRfcMessageId(getHeaderValue(payload.headers, "message-id"));

  const inboundMessage: EmailMessage = {
    id: `msg_in_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    threadId: thread.id,
    providerMessageId: rfcMessageId || providerMessageId,
    direction: "inbound",
    fromAddress: payload.from,
    fromName: payload.fromName || null,
    toAddresses: payload.to,
    subject: payload.subject,
    bodyText: payload.text,
    occurredAt: now,
    deliveryId: null,
    securityNotes: [],
    attachments: parsedAttachments,
    messageIdHeader: buyerRfcId,
    inReplyTo: inReplyToHdrVal,
    references: referencesHdrVal,
    threadMatchMethod: threadMatchMethod,
  };

  store.addMessage(inboundMessage);
  store.markMessageProcessed(providerMessageId);
  if (rfcMessageId) store.markMessageProcessed(rfcMessageId);
  store.updateThread(thread.id, {
    messageCount: thread.messageCount + 1,
    lastMessageAt: now,
    status: "extracting",
  });

  // 5. Inbound Triage (Phase 6) & Combined Text
  const cleanBodyText = stripQuotedEmail(payload.text);
  const combinedInboundText =
    attachmentTextSections.length > 0
      ? `${cleanBodyText}\n\n${attachmentTextSections.join("\n\n")}`
      : cleanBodyText;
  const cleanReplyText = combinedInboundText;
  const triage = triageInboundEmail(payload.subject, cleanReplyText, payload.from);

  // 5a. Unsupported Inbound
  if (triage === "unsupported") {
    const detail =
      "Inquiry type unsupported for automated quoting (reseller request, RFP attachment, non-India market, or custom feature request). Parked for human review.";
    thread.state = "needs_review";
    thread.status = "unsupported";
    store.updateThread(thread.id, {
      state: "needs_review",
      status: "unsupported",
      statusDetail: detail,
    });

    const reviewResult = await sendUnpriceableNotificationEmail({
      thread,
      rejectionReasons: [detail, "A sales engineer will review your inquiry and follow up directly."],
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "unsupported",
      status: "UNSUPPORTED",
      outboundResult: reviewResult,
      message: detail,
    };
  }

  // 5b. Non-Substantive Inbound ("hi", "thanks", "ok", etc.) or Casual Acknowledgement
  if (triage === "non_substantive" || triage === "casual_acknowledgement") {
    // Reply with short polite message. DO NOT consume a clarification round, DO NOT increment nonproductive streak.
    const replyResult = await sendNonSubstantiveReplyEmail({
      thread,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "clarification_requested",
      status: "NEEDS_INFO",
      outboundResult: replyResult,
      message: "Non-substantive acknowledgment dispatched without consuming a clarification round.",
    };
  }

  // 5c. Actionable RFQ or Vague Inquiry
  const existingProfile = store.getProfile(thread.id);
  const catalogue = await loadActiveCatalogue();

  const priorMessages = store
    .getMessages(thread.id)
    .filter((m) => m.id !== inboundMessage.id);

  // The rules engine works from cumulative inbound text so a regex pass never
  // loses an earlier turn, including requirements from earlier turn attachments.
  const previousInboundTexts = priorMessages
    .filter((m) => m.direction === "inbound")
    .map((m) => {
      const attTexts = (m.attachments || [])
        .map((a) =>
          a.extractedText?.trim()
            ? `\n[Attached ${a.documentKind || "document"}: "${a.name}"]\n${a.extractedText.trim()}`
            : ""
        )
        .filter(Boolean)
        .join("\n");
      const cleanBody = stripQuotedEmail(m.bodyText);
      return attTexts ? `${cleanBody}\n${attTexts}` : cleanBody;
    })
    .filter((txt) => txt.length > 0)
    .join("\n\n");

  const cumulativeText = previousInboundTexts
    ? `${previousInboundTexts}\n\n${cleanReplyText}`
    : cleanReplyText;

  const threadForAi = store.getThread(thread.id) ?? thread;

  const decision = await decideNextAction(
    {
      thread: threadForAi,
      latestMessageText: cleanReplyText,
      cumulativeText,
      priorMessages,
      existingProfile,
      catalogue,
      senderEmail: payload.from,
      senderName: payload.fromName || null,
      subject: payload.subject,
      attachments: parsedAttachments,
    },
    aiProvider
  );

  const extraction = decision.extraction;

  store.saveProfile(extraction.profile);
  store.saveAiDecision(decision.record);

  const decisionMeta = {
    decisionSource: decision.record.source,
    decisionModel: decision.record.model,
    aiFailureCategory: decision.record.failureCategory,
  } as const;

  if (extraction.organization && !thread.organisation) {
    store.updateThread(thread.id, { organisation: extraction.organization });
  }

  // Update nonproductive streak based on whether reply is substantive
  if (extraction.isSubstantive) {
    thread.nonproductiveStreak = 0;
  } else {
    thread.nonproductiveStreak = (thread.nonproductiveStreak ?? 0) + 1;
  }

  // Yield check 1: 2 consecutive non-productive buyer replies -> park thread as needs_review and send final email
  if ((thread.nonproductiveStreak ?? 0) >= 2) {
    thread.state = "needs_review";
    thread.status = "unsupported";
    const detail =
      "Parked for human review after 2 consecutive non-productive replies without required sizing parameters.";
    store.updateThread(thread.id, {
      state: "needs_review",
      status: "unsupported",
      statusDetail: detail,
      nonproductiveStreak: thread.nonproductiveStreak,
    });

    const unknownUnits = INTAKE_UNITS.filter((u) => extraction.intakeRequirements[u]?.state === "unknown");
    const missingDescriptions = unknownUnits.map((u) => UNIT_TO_FIELD_KEY[u]);

    const finalResult = await sendFinalYieldEmail({
      thread,
      missingUnits: missingDescriptions,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "unsupported",
      status: "UNSUPPORTED",
      outboundResult: finalResult,
      message: detail,
      ...decisionMeta,
    };
  }

  // Yield check 2: 3 clarification rounds exhausted and requirements still incomplete -> park thread as needs_review
  if ((thread.roundsUsed ?? 0) >= 3 && !extraction.isComplete) {
    thread.state = "needs_review";
    thread.status = "unsupported";
    const detail =
      "Parked for human review: maximum clarification allowance (3 rounds) reached with requirements incomplete.";
    store.updateThread(thread.id, {
      state: "needs_review",
      status: "unsupported",
      statusDetail: detail,
      roundsUsed: thread.roundsUsed,
    });

    const unknownUnits = INTAKE_UNITS.filter((u) => extraction.intakeRequirements[u]?.state === "unknown");
    const missingDescriptions = unknownUnits.map((u) => UNIT_TO_FIELD_KEY[u]);

    const finalResult = await sendFinalYieldEmail({
      thread,
      missingUnits: missingDescriptions,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "unsupported",
      status: "UNSUPPORTED",
      outboundResult: finalResult,
      message: detail,
      ...decisionMeta,
    };
  }

  // Check if AI or validation flagged human_review
  if (decision.action === "human_review") {
    const reasons =
      decision.record.humanReviewReasons.length > 0
        ? decision.record.humanReviewReasons
        : ["This request needs a sales engineer to review it before a quotation can be issued."];

    const detail = `Escalated for human review by ${decision.record.source}: ${reasons[0]}`;
    thread.state = "needs_review";
    thread.status = "unsupported";
    store.updateThread(thread.id, {
      state: "needs_review",
      status: "unsupported",
      statusDetail: detail,
    });

    const reviewResult = await sendUnpriceableNotificationEmail({
      thread,
      rejectionReasons: [...reasons, "A sales engineer will review your inquiry and follow up directly."],
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "unsupported",
      status: "UNSUPPORTED",
      outboundResult: reviewResult,
      message: detail,
      ...decisionMeta,
    };
  }

  // 6. If requirements are NOT sufficient: consume a round, ask follow-up questions (NO prices, at most 3 numbered questions)
  if (!extraction.isComplete) {
    thread.roundsUsed = (thread.roundsUsed ?? 0) + 1;
    thread.state = "clarifying";
    thread.status = "awaiting_reply";

    const unknownUnits = INTAKE_UNITS.filter((u) => extraction.intakeRequirements[u]?.state === "unknown");
    const missingSuffix =
      extraction.missingMaterialFields.length > 0
        ? ` on: ${extraction.missingMaterialFields.join(", ")}`
        : "";
    store.updateThread(thread.id, {
      state: "clarifying",
      status: "awaiting_reply",
      roundsUsed: thread.roundsUsed,
      nonproductiveStreak: thread.nonproductiveStreak,
      statusDetail: `Awaiting clarification (round ${thread.roundsUsed} of 3, decided by ${decision.record.source})${missingSuffix}`,
    });

    const questionText =
      extraction.suggestedQuestion?.question || buildClarificationQuestions(unknownUnits).join("\n");

    const clarificationResult = await sendClarificationEmail({
      thread,
      questionText,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
      conversationalResponse: extraction.conversationalResponse,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "clarification_requested",
      status: "NEEDS_INFO",
      outboundResult: clarificationResult,
      message: `Clarification dispatched by ${decision.record.source} for unknown parameters.`,
      ...decisionMeta,
    };
  }

  // 8. Deterministic Pricing Execution
  store.updateThread(thread.id, { status: "pricing" });

  const quoteId = `qt_${Date.now()}`;
  const priorQuotes = store.getQuotesByThreadId(thread.id);
  const nextVersion = priorQuotes.length > 0
    ? Math.max(...priorQuotes.map((q) => q.version ?? 1)) + 1
    : 1;

  const { quote, rejected } = buildQuote({
    quoteId,
    threadId: thread.id,
    profile: extraction.profile,
    demand: extraction.demand,
    catalogue,
    createdAt: now,
    status: "validated",
    version: nextVersion,
  });

  // Fail-Closed Gate: Do not produce documents or send quotes if no valid options or integrity fails
  if (quote.options.length === 0 || quote.integrityChecks.some((c) => !c.passed)) {
    const rejectionReasons: string[] = [];
    for (const cand of rejected) {
      if (cand.unavailabilityReason) {
        rejectionReasons.push(`${cand.plan.name}: ${cand.unavailabilityReason}`);
      }
    }
    for (const check of quote.integrityChecks.filter((c) => !c.passed)) {
      rejectionReasons.push(`Integrity check "${check.label}" failed: ${check.detail}`);
    }

    store.saveQuote(quote);

    store.updateThread(thread.id, {
      status: "unsupported",
      statusDetail: `Cannot produce automated quotation: ${rejectionReasons[0] || "Requirements cannot be satisfied by active catalogue"}`,
      quoteId: quote.id,
    });

    const dispatchResult = await sendUnpriceableNotificationEmail({
      thread,
      rejectionReasons,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "unsupported",
      status: "UNSUPPORTED",
      quote,
      pdfGenerated: false,
      outboundResult: dispatchResult,
      message: `Failed closed: Request cannot be quoted automatically. ${rejectionReasons.join("; ")}`,
      ...decisionMeta,
    };
  }

  // One active quote per thread. New quotes supersede old ones.
  const latestPriorQuote = priorQuotes.find((pq) => pq.status !== "superseded" && pq.id !== quote.id);
  for (const pq of priorQuotes) {
    if (pq.id !== quote.id) {
      store.updateQuote(pq.id, { status: "superseded", supersededBy: quote.id });
      console.log(`[Quote] Quote ${pq.id} superseded by ${quote.id} (superseded)`);
    }
  }

  store.updateThread(thread.id, { status: "document_generation" });

  // 9. Server-Side PDF Rendering
  const pdfBuffer = await renderQuotePdf({
    quote,
    thread,
    selectedOptionType: "best_value",
  });

  const quoteDoc: QuoteDocument = {
    id: `doc_${Date.now()}`,
    quoteId: quote.id,
    documentType: "quote",
    fileName: `Quote24x7-Proposal-${quote.id}.pdf`,
    contentHash: `sha256:${Date.now().toString(16)}`,
    pageCount: 1,
    createdAt: now,
    storageKey: null,
  };

  quote.documents = [quoteDoc];
  quote.status = "validated";
  store.saveQuote(quote);

  // 10. Outbound Email Dispatch via Resend
  store.updateThread(thread.id, { status: "sending" });

  const dispatchResult = await sendQuoteEmail({
    thread,
    quote,
    pdfBuffer,
    recipientEmail: payload.from,
    recipientName: thread.contactName || thread.contact_name || payload.fromName,
    conversationalResponse: extraction.conversationalResponse,
    previousQuote: latestPriorQuote,
    isUpdate: nextVersion > 1,
  });

  // 11. Finalize Thread Record
  const bestValueOption =
    quote.options.find((o) => o.optionType === "best_value") ?? quote.options[0];

  store.updateThread(thread.id, {
    state: "quoted",
    status: dispatchResult.success ? "completed" : "failed",
    statusDetail: dispatchResult.success
      ? `Proposal sent to ${dispatchResult.dispatchedTo} (Resend ID: ${dispatchResult.providerMessageId})`
      : `Dispatch error: ${dispatchResult.error}`,
    quoteId: quote.id,
    quoteTotal: bestValueOption?.total ?? null,
    currency: quote.currency,
  });

  return {
    threadId: thread.id,
    duplicate: false,
    actionTaken: "quoted",
    status: "QUOTED",
    quote,
    pdfGenerated: true,
    outboundResult: dispatchResult,
    message: `Calculated quote #${quote.id} and dispatched quotation PDF to ${dispatchResult.dispatchedTo}.`,
    ...decisionMeta,
  };
}
