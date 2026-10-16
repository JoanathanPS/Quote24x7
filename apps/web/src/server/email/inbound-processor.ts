import type {
  AiFailureCategory,
  DecisionSource,
  EmailMessage,
  EmailThread,
  Quote,
  QuoteDocument,
} from "@/types/domain";
import { getAppConfig } from "../config.ts";
import { store } from "../store/session-store.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { renderQuotePdf } from "../documents/pdf-renderer.ts";
import { decideNextAction } from "../ai/sales-engineer.ts";
import type { AiProvider } from "../ai/gemini-provider.ts";
import {
  sendQuoteEmail,
  sendClarificationEmail,
  sendUnpriceableNotificationEmail,
  type OutboundDispatchResult,
} from "./resend-outbound.ts";
import { formatMoney } from "../pricing/money.ts";

export interface InboundEmailPayload {
  providerMessageId: string;
  messageId?: string | null;
  from: string;
  fromName?: string | null;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string> | null;
  receivedAt?: string;
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
  const providerMessageId = payload.providerMessageId.trim();
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
    return await doProcessInboundEmail(payload, config, now, providerMessageId, rfcMessageId, provider);
  } catch (err) {
    // Release the claim so a provider retry can reprocess this message.
    // This only happens on unexpected failure; normal duplicate drops return
    // earlier and keep the claim.
    await store.releaseInboundMessage(providerMessageId);
    if (rfcMessageId) await store.releaseInboundMessage(rfcMessageId);
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
        rDomain === "quotes.joanathan.in" ||
        rDomain === "joanathan.in" ||
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

  // A. Thread by In-Reply-To and References headers
  const inReplyToHdr = payload.headers?.["in-reply-to"] || payload.headers?.["In-Reply-To"];
  const referencesHdr = payload.headers?.["references"] || payload.headers?.["References"];

  if (inReplyToHdr || referencesHdr) {
    const candidateIds: string[] = [];
    if (inReplyToHdr) {
      candidateIds.push(...inReplyToHdr.split(/\s+/).map((id) => id.replace(/[<>]/g, "").trim()).filter(Boolean));
    }
    if (referencesHdr) {
      candidateIds.push(...referencesHdr.split(/\s+/).map((id) => id.replace(/[<>]/g, "").trim()).filter(Boolean));
    }

    for (const refId of candidateIds) {
      const matchedMsg = store.getMessageByProviderMessageId(refId);
      if (matchedMsg) {
        thread = store.getThread(matchedMsg.threadId);
        if (thread) break;
      }
    }
  }

  // B. Check for explicit Thread or Quote Ref in subject or body
  if (!thread) {
    const threadRefMatch = (payload.subject + "\n" + payload.text).match(/#(th_\w+)/i);
    const quoteRefMatch = (payload.subject + "\n" + payload.text).match(/#(qt_\w+)/i);

    if (threadRefMatch && threadRefMatch[1]) {
      thread = store.getThread(threadRefMatch[1]);
    } else if (quoteRefMatch && quoteRefMatch[1]) {
      const quote = store.getQuote(quoteRefMatch[1]);
      if (quote) {
        thread = store.getThread(quote.threadId);
      }
    }
  }

  // C. Match active thread for this sender only if this is a reply
  if (!thread && isReply) {
    const openThread = store.getActiveThreadBySender(normalizedSender);
    if (openThread) {
      thread = openThread;
    } else {
      // Fuzzy match subject for this sender
      const targetClean = cleanSubject(payload.subject);
      const subjectMatch = store.getThreads().find((t) => {
        const tSender = extractEmail(t.senderEmail);
        const tClean = cleanSubject(t.subject);
        return (
          tSender === normalizedSender &&
          (tClean === targetClean || tClean.includes(targetClean) || targetClean.includes(tClean))
        );
      });
      if (subjectMatch) {
        thread = subjectMatch;
      }
    }
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

  if (!thread) {
    const newThreadId = `th_${Date.now()}`;
    thread = {
      id: newThreadId,
      provider: "resend",
      providerThreadId: providerMessageId,
      senderEmail: payload.from,
      senderName: payload.fromName || null,
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
    };
    store.saveThread(thread);
  }

  // 4. Record Inbound Message
  const inboundMessage: EmailMessage = {
    id: `msg_in_${Date.now()}`,
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
    attachments: [],
  };

  store.addMessage(inboundMessage);
  store.markMessageProcessed(providerMessageId);
  if (rfcMessageId) store.markMessageProcessed(rfcMessageId);
  store.updateThread(thread.id, {
    messageCount: thread.messageCount + 1,
    lastMessageAt: now,
    status: "extracting",
  });

  // 5. AI Sales Engineer (Gemini first, deterministic rules engine as fallback)
  const cleanReplyText = stripQuotedEmail(payload.text);
  const existingProfile = store.getProfile(thread.id);
  const catalogue = await loadActiveCatalogue();

  const priorMessages = store
    .getMessages(thread.id)
    .filter((m) => m.id !== inboundMessage.id);

  // The rules engine works from cumulative inbound text so a regex pass never
  // loses an earlier turn. Gemini receives the structured history instead.
  const previousInboundTexts = priorMessages
    .filter((m) => m.direction === "inbound")
    .map((m) => stripQuotedEmail(m.bodyText))
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

  // 6. Branch on the validated decision
  if (decision.action === "human_review") {
    const reasons =
      decision.record.humanReviewReasons.length > 0
        ? decision.record.humanReviewReasons
        : ["This request needs a sales engineer to review it before a quotation can be issued."];

    const detail = `Escalated for human review by ${decision.record.source}: ${reasons[0]}`;
    store.updateThread(thread.id, { status: "unsupported", statusDetail: detail });

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
      outboundResult: reviewResult,
      message: detail,
      ...decisionMeta,
    };
  }

  if (decision.action === "ask_follow_up" && extraction.suggestedQuestion) {
    store.updateThread(thread.id, {
      status: "awaiting_reply",
      statusDetail:
        `Awaiting clarification (round ${extraction.profile.clarificationRound}, decided by ${decision.record.source})` +
        `${extraction.missingMaterialFields.length > 0 ? ` on: ${extraction.missingMaterialFields.join(", ")}` : ""}`,
    });

    const clarificationResult = await sendClarificationEmail({
      thread,
      questionText: extraction.suggestedQuestion.question,
      recipientEmail: payload.from,
      recipientName: payload.fromName,
      conversationalResponse: extraction.conversationalResponse,
    });

    return {
      threadId: thread.id,
      duplicate: false,
      actionTaken: "clarification_requested",
      outboundResult: clarificationResult,
      message: `Clarification dispatched by ${decision.record.source}${
        extraction.missingMaterialFields.length > 0
          ? ` for: ${extraction.missingMaterialFields.join(", ")}`
          : ""
      }.`,
      ...decisionMeta,
    };
  }

  // 7. Check for unmentioned monitoring categories
  const priorInboundCount = priorMessages.filter((m) => m.direction === "inbound").length;
  const categoryCheck = checkUnmentionedCategories(
    extraction.demand,
    cumulativeText,
    priorInboundCount
  );

  if (categoryCheck.unmentioned) {
    const quoteId = `qt_${Date.now()}`;
    const { quote } = buildQuote({
      quoteId,
      threadId: thread.id,
      profile: extraction.profile,
      demand: extraction.demand,
      catalogue,
      createdAt: now,
      status: "estimate",
    });

    if (quote.options.length > 0 && quote.integrityChecks.every((c) => c.passed)) {
      // One active quote per thread. New quotes supersede old ones.
      const priorQuotes = store.getQuotesByThreadId(thread.id);
      for (const pq of priorQuotes) {
        if (pq.id !== quote.id) {
          store.updateQuote(pq.id, { status: "superseded" });
        }
      }
      store.saveQuote(quote);

      const liteOpt = quote.options.find(
        (o) => o.planId === "lite" || o.planName.toLowerCase().includes("lite")
      );
      const proOpt = quote.options.find(
        (o) => o.planId === "pro" || o.planName.toLowerCase().includes("professional")
      );

      const clarificationResult = await sendClarificationEmail({
        thread,
        questionText: categoryCheck.singleQuestion,
        recipientEmail: payload.from,
        recipientName: payload.fromName,
        conversationalResponse: extraction.conversationalResponse,
        estimate: {
          liteTotal: liteOpt ? liteOpt.total : (quote.options[0]?.total ?? 0),
          proTotal: proOpt ? proOpt.total : (quote.options[0]?.total ?? 0),
          currency: quote.currency,
          billingPeriod: "month",
          statedWorkload: formatStatedWorkload(extraction.demand),
        },
      });

      store.updateThread(thread.id, {
        status: "awaiting_reply",
        statusDetail: `Estimate provided for ${formatStatedWorkload(extraction.demand)} (${formatMoney(liteOpt?.total ?? 0, quote.currency)} Lite / ${formatMoney(proOpt?.total ?? 0, quote.currency)} Pro); awaiting confirmation on other categories.`,
        quoteId: quote.id,
        quoteTotal: liteOpt ? liteOpt.total : (quote.options[0]?.total ?? null),
        currency: quote.currency,
      });

      return {
        threadId: thread.id,
        duplicate: false,
        actionTaken: "clarification_requested",
        status: "NEEDS_INFO",
        quote,
        pdfGenerated: false,
        outboundResult: clarificationResult,
        message: `Estimate sent (${formatMoney(liteOpt?.total ?? 0, quote.currency)} Lite / ${formatMoney(proOpt?.total ?? 0, quote.currency)} Pro). Single question asked for unmentioned categories; no PDF generated.`,
        ...decisionMeta,
      };
    }
  }

  // 8. Deterministic Pricing Execution
  store.updateThread(thread.id, { status: "pricing" });

  const quoteId = `qt_${Date.now()}`;

  const { quote, rejected } = buildQuote({
    quoteId,
    threadId: thread.id,
    profile: extraction.profile,
    demand: extraction.demand,
    catalogue,
    createdAt: now,
    status: "validated",
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
  const priorQuotes = store.getQuotesByThreadId(thread.id);
  for (const pq of priorQuotes) {
    if (pq.id !== quote.id) {
      store.updateQuote(pq.id, { status: "superseded" });
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
    recipientName: payload.fromName,
    conversationalResponse: extraction.conversationalResponse,
  });

  // 11. Finalize Thread Record
  const bestValueOption =
    quote.options.find((o) => o.optionType === "best_value") ?? quote.options[0];

  store.updateThread(thread.id, {
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
