import zlib from "node:zlib";
import type { DeliveryRecord, EmailMessage, EmailThread, Quote, CoverageRow, QuoteLineItem } from "@/types/domain";
import { getAppConfig, isTestRuntime, formatFromEmail } from "../config.ts";
import { store } from "../store/session-store.ts";
import { dryRunStore } from "../store/dryrun-store.ts";
import { formatMoney } from "../pricing/money.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildComparisonLine } from "../pricing/engine.ts";
import { dedupe, extractMessageIds, normalizeRfcMessageId } from "./rfc-message-id.ts";
import { getResendClient, isFakeResendActive } from "./fake-resend-provider.ts";
import { formatShortRef } from "../pricing/quote-builder.ts";

const BANNED_PHRASES = [
  /valued customer/i,
  /\bdear\b/i,
  /greetings from/i,
  /i hope you'?re doing well/i,
  /autonomous/i,
  /\bprovision\b/i,
  /\bcapacity\b/i,
  /interactive proposal/i,
  /quick sizing/i,
  /sizing clarification/i,
  /sizing questions/i,
  /sales desk/i,
  /operations\s*&\s*solutions/i,
  /enterprise solutions/i,
  /billing cadence/i,
  /total billed today/i,
  /\btailored\b/i,
  /customized quotation/i,
  /\bpaise\b/i,
];

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;
const INTERNAL_ID_RE = /(?:#?th_[a-zA-Z0-9_-]+|#?qt_[a-zA-Z0-9_-]+|Ref\s+qt_[a-zA-Z0-9_-]+|\bqt_\w+|\bth_\w+|#th_)/i;
const UNFORMATTED_LARGE_INT_RE = /(?<!₹|INR\s|#)(?<![\d,.])(?<!\.)\b\d{5,}\b(?![\d,])(?!\s*(?:paise|cents))/;
const NON_QUOTE_HTML_FORBIDDEN = /<img\b|<button\b|background-color\s*:/i;

export interface PreSendCheckResult {
  passed: boolean;
  violations: string[];
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (!clean || clean.length % 2 !== 0) return "";
  try {
    const buf = Buffer.from(clean, "hex");
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      return buf.subarray(2).swap16().toString("utf16le");
    }
    return buf.toString("latin1");
  } catch {
    return "";
  }
}

function unescapePdfLiteral(s: string): string {
  return s
    .replace(/\\\\/g, "\\")
    .replace(/\\([()])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

export function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const extractedPieces: string[] = [];

  // 1. Extract metadata from PDF headers/dictionaries
  const metaRegex = /\/(?:Title|Author|Subject|Keywords|Creator)\s*(?:<([0-9a-fA-F\s]+)>|\(([^)]*)\))/g;
  let metaMatch;
  while ((metaMatch = metaRegex.exec(raw)) !== null) {
    if (metaMatch[1]) {
      extractedPieces.push(decodePdfHexString(metaMatch[1]));
    } else if (metaMatch[2]) {
      extractedPieces.push(unescapePdfLiteral(metaMatch[2]));
    }
  }

  // 2. Extract and inflate streams, then extract all text operators (Tj, TJ, ', ")
  let pos = 0;
  while ((pos = raw.indexOf("stream", pos)) !== -1) {
    let start = pos + 6;
    if (raw[start] === "\r") start++;
    if (raw[start] === "\n") start++;
    const end = raw.indexOf("endstream", start);
    if (end !== -1) {
      let realEnd = end;
      if (raw[realEnd - 1] === "\n") realEnd--;
      if (raw[realEnd - 1] === "\r") realEnd--;
      const slice = buffer.subarray(start, realEnd);
      let streamContent = "";
      try {
        streamContent = zlib.inflateSync(slice).toString("latin1");
      } catch {
        try {
          streamContent = zlib.unzipSync(slice).toString("latin1");
        } catch {
          streamContent = slice.toString("latin1");
        }
      }

      if (streamContent) {
        // Hex strings: <455354494D415445> Tj
        const hexTjRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/g;
        let hMatch;
        while ((hMatch = hexTjRegex.exec(streamContent)) !== null) {
          extractedPieces.push(decodePdfHexString(hMatch[1]!));
        }

        // Literal strings: (text) Tj
        const litTjRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
        let lMatch;
        while ((lMatch = litTjRegex.exec(streamContent)) !== null) {
          extractedPieces.push(unescapePdfLiteral(lMatch[1]!));
        }

        // TJ array operations: [ (text) -10 <hex> ] TJ
        const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
        let arrMatch;
        while ((arrMatch = tjArrayRegex.exec(streamContent)) !== null) {
          const inner = arrMatch[1]!;
          const elemRegex = /(?:<([0-9a-fA-F\s]+)>|\(([^)]*)\))/g;
          let elMatch;
          while ((elMatch = elemRegex.exec(inner)) !== null) {
            if (elMatch[1]) {
              extractedPieces.push(decodePdfHexString(elMatch[1]));
            } else if (elMatch[2]) {
              extractedPieces.push(unescapePdfLiteral(elMatch[2]));
            }
          }
        }
      }
      pos = end + 9;
    } else {
      pos = start;
    }
  }

  return extractedPieces.filter(Boolean).join(" ");
}

export function extractSignatureName(body: string | null | undefined): { name: string; evidence: string } | null {
  if (!body) return null;
  const cleanBody = body.replace(/\r\n/g, "\n");
  const lines = cleanBody.split("\n").map((l) => l.trim());

  const signoffRegex = /^(?:Thanks|Thank you|Best regards|Warm regards|Regards|Cheers|Sincerely|Best),?$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (signoffRegex.test(line)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const candidate = lines[j]!;
        if (!candidate) continue;
        if (
          /^[A-Z][a-zA-Z'.]+(?:\s+[A-Z][a-zA-Z'.]+){1,2}$/.test(candidate) &&
          !/(?:team|support|procurement|site24x7|devops|engineer|manager|lead|director|contact|buyer)/i.test(candidate)
        ) {
          return {
            name: candidate,
            evidence: `${line} ${candidate}`,
          };
        }
      }
    }
  }

  const inlineMatch = cleanBody.match(/(?:Thanks|Thank you|Best regards|Warm regards|Regards|Cheers|Sincerely|Best),\s*([A-Z][a-zA-Z'.]+(?:\s+[A-Z][a-zA-Z'.]+){1,2})/i);
  if (inlineMatch && inlineMatch[1]) {
    const candidate = inlineMatch[1].trim();
    if (!/(?:team|support|procurement|site24x7|devops|engineer|manager|lead|director|contact|buyer)/i.test(candidate)) {
      return {
        name: candidate,
        evidence: inlineMatch[0],
      };
    }
  }

  return null;
}

export function resolveRecipientName(
  thread?: EmailThread | null,
  latestMessageBody?: string | null,
): { name: string; evidence?: string } {
  if (latestMessageBody) {
    const sig = extractSignatureName(latestMessageBody);
    if (sig && sig.name) return sig;
  }
  const savedContact = (thread?.contactName || thread?.contact_name || "").trim();
  if (savedContact && !/^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(savedContact)) {
    return { name: savedContact };
  }
  const displayName = thread?.senderName?.trim();
  if (displayName && !/^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(displayName)) {
    return { name: displayName };
  }
  return { name: "" };
}

export function runPreSendChecks(
  content: string,
  options?: { isQuoteEmail?: boolean }
): PreSendCheckResult {
  const violations: string[] = [];

  for (const pattern of BANNED_PHRASES) {
    const match = content.match(pattern);
    if (match) {
      violations.push(`Banned phrase: "${match[0]}"`);
    }
  }

  const emojiMatch = content.match(EMOJI_RE);
  if (emojiMatch) {
    violations.push(`Emoji found: "${emojiMatch[0]}"`);
  }

  // Requirement 3: Internal IDs banned on ALL emails, quotes included
  const idMatch = content.match(INTERNAL_ID_RE);
  if (idMatch) {
    violations.push(`Internal ID exposed: "${idMatch[0]}"`);
  }

  const intMatch = content.match(UNFORMATTED_LARGE_INT_RE);
  if (intMatch) {
    violations.push(`Unformatted large integer: "${intMatch[0]}"`);
  }

  if (!options?.isQuoteEmail) {
    const htmlForbiddenMatch = content.match(NON_QUOTE_HTML_FORBIDDEN);
    if (htmlForbiddenMatch) {
      violations.push(`Forbidden HTML in non-quote email: "${htmlForbiddenMatch[0]}"`);
    }
  }

  return { passed: violations.length === 0, violations };
}

interface DispatchInput {
  threadId: string;
  recipientEmail: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
  attachments?: { filename: string; content: Buffer }[];
  quoteId?: string | null;
  prefixTag: string;
  fromName?: string;
  isQuoteEmail?: boolean;
}

/**
 * Escapes text that originates outside this module before it is placed in an
 * HTML email body.
 *
 * Both of the values this is applied to are ultimately customer-controlled: a
 * display name taken from an email header, and clarification questions now
 * authored by the AI sales engineer while reading an untrusted customer
 * message. Neither may be allowed to inject markup into mail we send.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendQuoteEmailInput {
  thread: EmailThread;
  quote: Quote;
  pdfBuffer: Buffer;
  recipientEmail: string;
  recipientName?: string | null;
  conversationalResponse?: string | null;
  previousQuote?: Quote | null;
  isUpdate?: boolean;
}

export interface SendClarificationEmailInput {
  thread: EmailThread;
  questionText: string;
  recipientEmail: string;
  recipientName?: string | null;
  conversationalResponse?: string | null;
}

export interface SendNonSubstantiveReplyEmailInput {
  thread: EmailThread;
  recipientEmail: string;
  recipientName?: string | null;
}

export interface SendFinalYieldEmailInput {
  thread: EmailThread;
  missingUnits: string[];
  recipientEmail: string;
  recipientName?: string | null;
}

export interface SendUnpriceableNotificationEmailInput {
  thread: EmailThread;
  rejectionReasons: string[];
  recipientEmail: string;
  recipientName?: string | null;
}

export interface OutboundDispatchResult {
  success: boolean;
  providerMessageId: string | null;
  deliveryId: string;
  status: "accepted" | "failed";
  mode: "live" | "dry_run";
  error?: string;
  dispatchedTo: string;
}

/**
 * The single subject every outbound in a thread must carry.
 *
 * Email clients (Gmail in particular) group messages by subject. Any suffix
 * added here — a ref, a "Clarification Needed" tag, a quote id — splits the
 * reply into a brand-new thread, which is exactly the failure this guards
 * against. Every outbound in a thread therefore uses exactly:
 *
 *     Re: <original subject>
 *
 * with a single "Re:" and nothing else.
 */
export function resolveThreadSubject(originalSubject: string): string {
  // Strip every leading Re:/Fwd: (case-insensitive), including stacked ones.
  let cleaned = originalSubject.trim();
  let prev: string | null = null;
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/^\s*(?:re|fwd)\s*:\s*/i, "");
  }
  cleaned = cleaned.trim();
  cleaned = cleaned
    .replace(/\s*\[ref:\s*#(?:th_|qt_)\w+\]\s*/gi, "")
    .replace(/\s*\[ref:\s*#\w+\]\s*/gi, "")
    .replace(/\s*[-–—]\s*(?:sizing\s+(?:information|&\s*custom\s*pricing)\s+needed|quick\s+sizing\s+clarification|clarification\s+needed|quote\s+sent)\s*/gi, "")
    .replace(/\s*(?:re|fwd)\s*:\s*$/i, "")
    .trim();
  return `Re: ${cleaned}`;
}

/**
 * Resolves standard RFC 2822 / 5322 In-Reply-To and References headers for email threading.
 * Gathers prior messages from the thread history to maintain email client conversation grouping.
 */
/**
 * Builds the threading headers for an outbound reply in a thread.
 *
 * Item 4 guarantees:
 *   - In-Reply-To is the RFC message-id of the latest inbound.
 *   - References lists earlier RFC ids in order, de-duplicated, valid tokens only.
 *   - No custom Message-ID is set; Resend owns the message-id we later record.
 */
export function buildThreadingHeaders(
  threadId: string,
  customPrefix?: string
): {
  messageId: string;
  inReplyTo?: string;
  references?: string;
  headers: Record<string, string>;
} {
  const config = getAppConfig();
  const domainMatch = config.outboundFromEmail.match(/@([^>]+)/);
  const domain = domainMatch?.[1]?.replace(/>/g, "").trim() || "quotes.joanathan.in";
  const prefix = customPrefix || `msg_${Date.now()}`;
  const messageId = `<${prefix}.${Date.now()}@${domain}>`;

  // Item 2: Do NOT set a custom Message-ID header — let Resend generate it.
  // We still compute In-Reply-To and References for threading.
  const headers: Record<string, string> = {};

  const messages = store.getMessages(threadId);
  if (!messages || messages.length === 0) {
    return { messageId, headers };
  }

  // Only real RFC tokens reach the chain. A stored id that is not `<local@domain>`
  // (a provider UUID, or a legacy bare value) is dropped rather than emitted.
  const chain: string[] = [];
  for (const m of messages) {
    chain.push(...extractMessageIds(m.messageIdHeader));
  }
  const orderedChain = dedupe(chain);

  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const inReplyTo = lastInbound
    ? normalizeRfcMessageId(lastInbound.messageIdHeader) ??
      undefined
    : undefined;

  const references =
    orderedChain.length > 0 ? orderedChain.join(" ") : inReplyTo;

  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references) headers["References"] = references;

  return { messageId, inReplyTo, references, headers };
}

export interface OutboundPolicyCheck {
  targetRecipient: string;
  isBlocked: boolean;
  blockReason?: string;
}

export function validateOutboundPolicy(
  config: ReturnType<typeof getAppConfig>,
  threadId: string,
  intendedRecipient: string
): OutboundPolicyCheck {
  const cleanIntended = intendedRecipient.replace(/^.*?<([^>]+)>.*$/, "$1").trim().toLowerCase();
  const recipientDomain = cleanIntended.split("@")[1] || "";

  // 1. Never send to our own domain, zoho.com, or site24x7.com
  const ownDomainMatch = config.outboundFromEmail.match(/@([^>]+)/);
  const ownDomain = ownDomainMatch?.[1]
    ? ownDomainMatch[1].replace(/>/g, "").toLowerCase().trim()
    : "quote24x7.internal";

  if (
    recipientDomain === ownDomain ||
    recipientDomain.endsWith(`.${ownDomain}`) ||
    recipientDomain === "zoho.com" ||
    recipientDomain.endsWith(".zoho.com") ||
    recipientDomain === "site24x7.com" ||
    recipientDomain.endsWith(".site24x7.com")
  ) {
    return {
      targetRecipient: cleanIntended,
      isBlocked: true,
      blockReason: `Recipient domain "${recipientDomain}" is forbidden (cannot send to own domain, zoho.com, or site24x7.com).`,
    };
  }

  // 2. Max 3 outbound per thread per day
  const existingMsgs = store.getMessages(threadId);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentOutbound = existingMsgs.filter(
    (m) => m.direction === "outbound" && new Date(m.occurredAt).getTime() >= oneDayAgo
  );
  if (recentOutbound.length >= 3) {
    return {
      targetRecipient: cleanIntended,
      isBlocked: true,
      blockReason: `Rate limit reached: Maximum 3 outbound emails per thread per day exceeded.`,
    };
  }

  // 3. Test mode check (optional TEST_ALLOWLIST filter if set)
  const isTestMode = !config.isLiveDispatchEnabled || isTestRuntime();
  if (isTestMode) {
    const allowlistEnv = process.env.TEST_ALLOWLIST?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
    if (allowlistEnv.length > 0 && !allowlistEnv.includes(cleanIntended)) {
      return {
        targetRecipient: cleanIntended,
        isBlocked: true,
        blockReason: `Test mode active: Recipient "${cleanIntended}" is not in the configured TEST_ALLOWLIST.`,
      };
    }
  }

  return { targetRecipient: cleanIntended, isBlocked: false };
}

async function dispatchEmail(input: DispatchInput): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();

  const isSendingPaused = store.getOutboundSendingPaused();
  const policy = validateOutboundPolicy(config, input.threadId, input.recipientEmail);
  const targetRecipient = policy.targetRecipient;

  if (targetRecipient.toLowerCase() === config.outboundFromEmail.toLowerCase()) {
    throw new Error(
      `Loop Prevention: Outbound recipient (${targetRecipient}) matches system sender address.`
    );
  }

  if (policy.isBlocked && !isSendingPaused) {
    const failedRecord: DeliveryRecord = {
      id: deliveryId,
      threadId: input.threadId,
      quoteId: input.quoteId ?? null,
      provider: "resend",
      providerMessageId: null,
      recipient: targetRecipient,
      subject: input.subject,
      status: "failed",
      attemptCount: 0,
      maxAttempts: 0,
      lastErrorCode: "POLICY_BLOCKED",
      lastErrorMessage: policy.blockReason || "Outbound policy rejection",
      nextRetryAt: null,
      retryEligible: false,
      createdAt: now,
      updatedAt: now,
      events: [
        {
          at: now,
          status: "failed",
          detail: `Outbound policy rejected: ${policy.blockReason}`,
        },
      ],
    };
    store.saveDelivery(failedRecord);

    return {
      success: false,
      providerMessageId: null,
      deliveryId,
      status: "failed",
      mode: "dry_run",
      error: `Outbound Policy Rejection: ${policy.blockReason}`,
      dispatchedTo: targetRecipient,
    };
  }

  const bodyContent = input.textContent + "\n" + (input.htmlContent ?? "");
  const check = runPreSendChecks(bodyContent, { isQuoteEmail: input.isQuoteEmail });
  const subjectCheck = runPreSendChecks(input.subject, { isQuoteEmail: true });

  const attachmentViolations: string[] = [];
  if (input.attachments) {
    for (const att of input.attachments) {
      const fnameMatch = att.filename.match(INTERNAL_ID_RE);
      if (fnameMatch) {
        attachmentViolations.push(`Internal ID exposed in attachment filename: "${fnameMatch[0]}"`);
      }
      if (att.content && (att.filename.endsWith(".pdf") || att.content.subarray(0, 5).toString() === "%PDF-")) {
        const pdfText = extractPdfText(att.content);
        const pdfIdMatch = pdfText.match(INTERNAL_ID_RE);
        if (pdfIdMatch) {
          attachmentViolations.push(`Internal ID exposed in PDF content: "${pdfIdMatch[0]}"`);
        }
      }
    }
  }

  if (!check.passed || !subjectCheck.passed || attachmentViolations.length > 0) {
    const allViolations = [...check.violations, ...subjectCheck.violations, ...attachmentViolations];
    const failedRecord: DeliveryRecord = {
      id: deliveryId,
      threadId: input.threadId,
      quoteId: input.quoteId ?? null,
      provider: "resend",
      providerMessageId: null,
      recipient: targetRecipient,
      subject: input.subject,
      status: "failed",
      attemptCount: 0,
      maxAttempts: 0,
      lastErrorCode: "FAILED_CHECK",
      lastErrorMessage: allViolations.join("; "),
      nextRetryAt: null,
      retryEligible: false,
      createdAt: now,
      updatedAt: now,
      events: [
        {
          at: now,
          status: "failed",
          detail: `Pre-send check rejected: ${allViolations.join("; ")}`,
        },
      ],
    };
    store.saveDelivery(failedRecord);

    return {
      success: false,
      providerMessageId: null,
      deliveryId,
      status: "failed",
      mode: "dry_run",
      error: `Pre-send check failed: ${allViolations.join("; ")}`,
      dispatchedTo: targetRecipient,
    };
  }

  const { messageId: _localMessageId, inReplyTo, references, headers: threadingHeaders } =
    buildThreadingHeaders(input.threadId, `${input.prefixTag}_${Date.now()}`);

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;
  let messageIdHeader: string | null = null;

  if (isSendingPaused) {
    status = "accepted";
    mode = "dry_run";
    providerMessageId = `paused_${Date.now()}`;
    errorMessage = "Automated outbound dispatch paused by operator kill switch";
  } else if ((config.isLiveDispatchEnabled && config.resendApiKey) || isFakeResendActive()) {
    try {
      const resend = getResendClient(config.resendApiKey ?? "");
      const res = await resend.emails.send({
        from: formatFromEmail(config.outboundFromEmail),
        to: targetRecipient,
        replyTo: formatFromEmail(config.inboundAddress || "quotes@quotes.joanathan.in"),
        subject: input.subject,
        text: input.textContent,
        html: input.htmlContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
        attachments: input.attachments,
      });

      if (res.error) {
        status = "failed";
        errorMessage = `${res.error.name}: ${res.error.message}`;
      } else if (res.data?.id) {
        providerMessageId = res.data.id;
        mode = "live";

        // === Item 2: Fetch the actual RFC Message-ID from Resend ===
        // Resend's emails.get() returns the RFC 2822 Message-ID as a top-level
        // `message_id` field on the response. Retry a few times so a transient
        // failure right after send does not permanently lose the real ID.
        let rfcMessageId: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const getRes = await resend.emails.get(res.data.id);
            const candidate = getRes.data?.message_id;
            if (!getRes.error && typeof candidate === "string" && candidate.trim()) {
              rfcMessageId = normalizeRfcMessageId(candidate);
              break;
            }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Store Resend's real RFC Message-ID as the outbound message's header ID so
        // later inbound thread resolution can match on it. Never store the Resend
        // API id (a UUID) here — that is not a valid RFC 2822 message-id.
        messageIdHeader = rfcMessageId;
      }
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  } else {
    providerMessageId = `dryrun_${Date.now()}`;
    mode = "dry_run";
  }

  const deliveryRecord: DeliveryRecord = {
    id: deliveryId,
    threadId: input.threadId,
    quoteId: input.quoteId ?? null,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject: input.subject,
    status: status === "accepted" ? "queued" : "failed",
    attemptCount: 1,
    maxAttempts: 3,
    lastErrorCode: status === "failed" ? "DISPATCH_ERROR" : null,
    lastErrorMessage: errorMessage ?? null,
    nextRetryAt: null,
    retryEligible: status === "failed",
    createdAt: now,
    updatedAt: now,
    events: [
      {
        at: now,
        status: status === "accepted" ? "queued" : "failed",
        detail:
          mode === "live"
            ? `Dispatched via Resend API (messageId: ${providerMessageId}${inReplyTo ? `, In-Reply-To: ${inReplyTo}` : ""})`
            : isSendingPaused
              ? "Queued in store: Automated outbound dispatch paused by operator kill switch"
              : `Dry-run simulated dispatch (${input.prefixTag})`,
      },
    ],
  };

  if (mode === "dry_run") {
    dryRunStore.saveDelivery(deliveryRecord);
  } else {
    store.saveDelivery(deliveryRecord);
  }

  const outboundMessage: EmailMessage = {
    id: `msg_out_${Date.now()}`,
    threadId: input.threadId,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: input.fromName ?? "Quote24x7 Assistant",
    toAddresses: [targetRecipient],
    subject: input.subject,
    bodyText: input.textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: input.attachments?.map((a) => ({
      name: a.filename,
      contentType: "application/pdf",
      sizeBytes: a.content.length,
      scanned: true,
    })) ?? [],
    messageIdHeader: messageIdHeader,
    inReplyTo: inReplyTo ?? null,
    references: references ?? null,
  };

  store.addMessage(outboundMessage);

  return {
    success: status === "accepted",
    providerMessageId,
    deliveryId,
    status,
    mode,
    error: errorMessage,
    dispatchedTo: targetRecipient,
  };
}

export function buildChangeSentences(
  currCoverage: CoverageRow[],
  prevCoverage: CoverageRow[]
): string[] {
  const units: Array<{ unit: string; label: string }> = [
    { unit: "host_monitor", label: "Servers" },
    { unit: "network_component", label: "Network devices" },
    { unit: "basic_monitor", label: "Websites" },
    { unit: "advanced_monitor", label: "Advanced monitors" },
    { unit: "applog_gb", label: "Logs" },
    { unit: "rum_pageview", label: "RUM pageviews" },
  ];

  const sentences: string[] = [];
  for (const { unit, label } of units) {
    const curr = currCoverage.find((c) => c.unit === unit)?.required ?? 0;
    const prev = prevCoverage.find((c) => c.unit === unit)?.required ?? 0;
    if (curr !== prev) {
      if (prev > 0 && curr === 0) {
        sentences.push(`${label}: removed.`);
      } else if (prev > 0 && curr > 0) {
        sentences.push(`${label}: ${prev} to ${curr}.`);
      } else if (prev === 0 && curr > 0) {
        sentences.push(`${label}: ${curr}.`);
      }
    }
  }
  return sentences;
}

export function getWhatItCoversText(item: QuoteLineItem, coverage: CoverageRow[]): string {
  if (item.ruleId === "RULE-BASE-PRICE") {
    const unitPriority: Record<string, number> = {
      host_monitor: 1,
      basic_monitor: 2,
      advanced_monitor: 3,
      network_component: 4,
      applog_gb: 5,
      rum_pageview: 6,
    };

    const parts = [...coverage]
      .filter((c) => c.included > 0)
      .sort((a, b) => (unitPriority[a.unit] ?? 99) - (unitPriority[b.unit] ?? 99))
      .map((c) => {
        if (c.unit === "host_monitor") return `${c.included} servers`;
        if (c.unit === "basic_monitor") return `${c.included} websites`;
        if (c.unit === "advanced_monitor") return `${c.included} advanced monitor${c.included > 1 ? "s" : ""}`;
        if (c.unit === "network_component") return `${c.included} network devices`;
        if (c.unit === "applog_gb") return `${c.included} GB logs`;
        if (c.unit === "rum_pageview") return `${c.included.toLocaleString("en-IN")} RUM pageviews`;
        return `${c.included} ${c.label}`;
      });
    return parts.length > 0 ? `Base plan: includes ${parts.join(", ")}` : "Base plan included entitlements";
  }

  const desc = item.description.toLowerCase();
  const purchased = item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1));

  if (desc.includes("host") || desc.includes("server") || item.unit === "host_monitor") {
    const cov = coverage.find((c) => c.unit === "host_monitor");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} more servers (${total} in total)`;
  }
  if (desc.includes("advanced") || item.unit === "advanced_monitor") {
    return `${purchased} more advanced monitors`;
  }
  if (desc.includes("log") || item.ruleId.includes("log") || item.unit === "applog_gb") {
    const cov = coverage.find((c) => c.unit === "applog_gb");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} GB more log ingestion per month (${total} GB in total)`;
  }
  if (desc.includes("network") || desc.includes("switch") || item.unit === "network_component") {
    const cov = coverage.find((c) => c.unit === "network_component");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased} more network devices (${total} in total)`;
  }
  if (desc.includes("rum") || desc.includes("pageview") || item.unit === "rum_pageview") {
    const cov = coverage.find((c) => c.unit === "rum_pageview");
    const total = cov?.total ?? (cov ? cov.included + purchased : purchased);
    return `${purchased.toLocaleString("en-IN")} more RUM pageviews per month (${total.toLocaleString("en-IN")} in total)`;
  }
  return `${purchased} more ${item.description}`;
}

/**
 * Deterministically renders the plain text and plain HTML quotation email from Golden Template.
 * Table columns: Item | Qty | What it covers | Per year.
 * Zero decimals, plain-word requirements, real coverage description, standard footer.
 */
export function renderQuoteEmail(input: {
  recipientName?: string | null;
  quote: Quote;
  threadId?: string;
  conversationalResponse?: string | null;
  latestMessageBody?: string | null;
  previousQuote?: Quote | null;
  isUpdate?: boolean;
  changeSentences?: string[] | null;
}): { textContent: string; htmlContent: string } {
  const shortRef = input.quote.shortRef || formatShortRef(input.quote.id);
  const nameRes = input.recipientName
    ? { name: input.recipientName }
    : resolveRecipientName(
        input.threadId ? store.getThread(input.threadId) : null,
        input.latestMessageBody
      );

  const greeting = nameRes.name && !/^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(nameRes.name)
    ? `Hi ${nameRes.name},`
    : "Hi there,";

  const bestValue = input.quote.options[0]!;
  const alternativeOption = input.quote.options[1];

  // Determine if this is an updated quote in the thread
  const priorQuotes = input.threadId ? store.getQuotesByThreadId(input.threadId) : [];
  const prevQuote =
    input.previousQuote ||
    priorQuotes.find((q) => q.id !== input.quote.id && (input.quote.version ? (q.version ?? 1) < input.quote.version : true));

  const isUpdate = Boolean(
    input.isUpdate ||
    (input.quote.version && input.quote.version > 1) ||
    Boolean(prevQuote)
  );

  let changeSentences = input.changeSentences || [];
  if (isUpdate && changeSentences.length === 0 && prevQuote) {
    const prevOption = prevQuote.options.find((o) => o.optionType === "best_value") ?? prevQuote.options[0];
    const currOption = bestValue;
    if (prevOption && currOption) {
      changeSentences = buildChangeSentences(currOption.coverage, prevOption.coverage);
    }
  }

  const changeLine = changeSentences.join(" ");

  // Plain-word requirement summary
  const understoodLines: string[] = [];
  if (bestValue?.coverage && bestValue.coverage.length > 0) {
    for (const row of bestValue.coverage) {
      if (row.required > 0) {
        const count = row.required.toLocaleString("en-IN");
        if (row.unit === "host_monitor") {
          understoodLines.push(`• ${count} servers / virtual machines`);
        } else if (row.unit === "network_component") {
          understoodLines.push(`• ${count} network devices (switches, firewalls)`);
        } else if (row.unit === "basic_monitor") {
          understoodLines.push(`• ${count} website availability checks`);
        } else if (row.unit === "advanced_monitor") {
          understoodLines.push(`• ${count} synthetic browser transactions`);
        } else if (row.unit === "applog_gb") {
          understoodLines.push(`• ${count} GB monthly log ingestion`);
        } else if (row.unit === "rum_pageview") {
          understoodLines.push(`• ${count} real user monitoring pageviews / month`);
        } else {
          understoodLines.push(`• ${count} ${row.label}`);
        }
      }
    }
  }
  if (understoodLines.length === 0) {
    understoodLines.push("• Sizing parameters provided in your inquiry");
  }

  const catalogue = loadActiveCatalogue();
  const plan = catalogue.plans.find((p) => p.id === bestValue?.planId);
  const planName = bestValue?.planName ?? "Recommended Plan";

  // No .00 decimals
  const totalAmount = formatMoney(bestValue?.total ?? 0, input.quote.currency, { showDecimals: false });
  const lineItems = bestValue?.lineItems ?? [];

  const rows = lineItems.map((item) => {
    const isBase = item.ruleId === "RULE-BASE-PRICE";
    const monthlyRate =
      plan?.priceMonthlyAnnualBilled ??
      plan?.basePrice ??
      (item.lineTotal ? Math.floor(item.lineTotal / 12) : 0);
    const monthlyStr = formatMoney(monthlyRate, input.quote.currency, { showDecimals: false });
    const name = isBase
      ? `${planName} base subscription (${monthlyStr} per month × 12)`
      : item.description;
    const purchased = item.purchasedUnits ?? item.quantity * (item.packSize ?? 1);
    const qty = isBase ? "1" : purchased.toLocaleString("en-IN");
    const covers = getWhatItCoversText(item, bestValue?.coverage ?? []);
    return {
      name,
      qty,
      covers,
      total: formatMoney(item.lineTotal, input.quote.currency, { showDecimals: false }),
    };
  });

  const sep = "--------------------------------------------------------------------------------";
  const textTableLines = [
    "Item | Qty | What it covers | Per year",
    sep,
    ...rows.map((r) => `${r.name} | ${r.qty} | ${r.covers} | ${r.total}`),
    sep,
    `Total | | | ${totalAmount}`,
  ];

  let comparisonLine: string | null = null;
  if (alternativeOption && bestValue.planId !== alternativeOption.planId) {
    comparisonLine = input.quote.comparisonLine ?? buildComparisonLine(bestValue, alternativeOption);
  } else if (input.quote.comparisonLine) {
    comparisonLine = input.quote.comparisonLine;
  }

  const pdfFilename = `Site24x7-estimate-${shortRef}.pdf`;

  const openingTextLines = isUpdate
    ? [
        "Thanks. I've updated the estimate.",
        ...(changeLine ? [changeLine] : []),
        "This replaces the earlier estimate.",
      ]
    : [
        "Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your estimate.",
      ];

  const textContent = [
    greeting,
    "",
    ...openingTextLines,
    "",
    "Summary of understood requirements:",
    ...understoodLines,
    "",
    `For your setup, the lowest-priced option is ${planName} at ${totalAmount} per year.`,
    "",
    textTableLines.join("\n"),
    "",
    "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.",
    ...(comparisonLine ? ["", comparisonLine] : []),
    "",
    "I haven't sized for custom APM instances, status pages, or extra alert credits. If you need any of these, let me know and I'll update the estimate.",
    "",
    `Your estimate document (PDF) is attached: ${pdfFilename}`,
    "",
    "Estimate valid 30 days. Costs in INR; local taxes extra; final price confirmed by Site24x7 at purchase.",
    "",
    "Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.",
    "",
    "Independent estimate based on Site24x7 India public pricing captured 2026-10-16. Not an official Zoho document.",
    "Quote24x7 Assistant",
    `Ref ${shortRef}`,
  ].join("\n").trim();

  const htmlRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td style="text-align:right;">${escapeHtml(r.qty)}</td><td>${escapeHtml(r.covers)}</td><td style="text-align:right;">${escapeHtml(r.total)}</td></tr>`,
    )
    .join("\n");

  const htmlUnderstoodList = understoodLines
    .map((l) => `<li>${escapeHtml(l.replace(/^•\s*/, ""))}</li>`)
    .join("");

  const htmlContent = [
    "<!DOCTYPE html>",
    "<html>",
    '<meta charset="utf-8">',
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:16px;">',
    `<p>${escapeHtml(greeting)}</p>`,
    ...(isUpdate
      ? [
          "<p>Thanks. I've updated the estimate.</p>",
          ...(changeLine ? [`<p>${escapeHtml(changeLine)}</p>`] : []),
          "<p>This replaces the earlier estimate.</p>",
        ]
      : [
          "<p>Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your estimate.</p>",
        ]),
    "<p><strong>Summary of understood requirements:</strong></p>",
    `<ul>${htmlUnderstoodList}</ul>`,
    `<p>For your setup, the lowest-priced option is <strong>${escapeHtml(planName)}</strong> at <strong>${escapeHtml(totalAmount)}</strong> per year.</p>`,
    '<table style="width:100%;border-collapse:collapse;">',
    '<thead><tr style="border-bottom:1px solid #999;">',
    '<th style="text-align:left;padding:6px 4px;">Item</th>',
    '<th style="text-align:right;padding:6px 4px;">Qty</th>',
    '<th style="text-align:left;padding:6px 4px;">What it covers</th>',
    '<th style="text-align:right;padding:6px 4px;">Per year</th>',
    "</tr></thead>",
    "<tbody>",
    htmlRows,
    '<tr style="border-top:1px solid #333;font-weight:bold;">',
    '<td colspan="3" style="padding:8px 4px;">Total</td>',
    `<td style="text-align:right;padding:8px 4px;">${escapeHtml(totalAmount)}</td>`,
    "</tr></tbody>",
    "</table>",
    "<p>Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.</p>",
    ...(comparisonLine ? [`<p><strong>Alternative:</strong> ${escapeHtml(comparisonLine)}</p>`] : []),
    "<p>I haven't sized for custom APM instances, status pages, or extra alert credits. If you need any of these, let me know and I'll update the estimate.</p>",
    `<p>Your estimate document (PDF) is attached: <em>${escapeHtml(pdfFilename)}</em></p>`,
    "<p>Estimate valid 30 days. Costs in INR; local taxes extra; final price confirmed by Site24x7 at purchase.</p>",
    "<p>Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.</p>",
    "<hr>",
    `<p style="font-size:12px;color:#666;">Independent estimate based on Site24x7 India public pricing captured 2026-10-16. Not an official Zoho document.<br>Quote24x7 Assistant<br>Ref ${escapeHtml(shortRef)}</p>`,
    "</body>",
    "</html>",
  ].join("\n");

  return { textContent, htmlContent };
}

export async function sendQuoteEmail(input: SendQuoteEmailInput): Promise<OutboundDispatchResult> {
  let subject = resolveThreadSubject(input.thread.subject);
  subject = subject.replace(/#?th_[a-zA-Z0-9_-]+/gi, "").replace(/#?qt_[a-zA-Z0-9_-]+/gi, "").trim();

  // Resolve signature name or display name; never "Procurement Contact" or "there"
  const storeMessages = store.getMessages(input.thread.id);
  const latestInbound = [...storeMessages].reverse().find((m) => m.direction === "inbound");
  const nameRes = resolveRecipientName(input.thread, latestInbound?.bodyText);
  const candidateName = input.recipientName || nameRes.name || input.thread.contactName || input.thread.contact_name || null;
  const resolvedName = (candidateName && !/^(?:Procurement Contact|Customer|Valued Customer|Unknown|there)$/i.test(candidateName))
    ? candidateName
    : null;

  const shortRef = input.quote.shortRef || formatShortRef(input.quote.id);
  const pdfFilename = `Site24x7-estimate-${shortRef}.pdf`;

  const { textContent, htmlContent } = renderQuoteEmail({
    recipientName: resolvedName,
    quote: input.quote,
    threadId: input.thread.id,
    conversationalResponse: input.conversationalResponse,
    latestMessageBody: latestInbound?.bodyText,
    previousQuote: input.previousQuote,
    isUpdate: input.isUpdate,
  });

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    htmlContent,
    attachments: [
      {
        filename: pdfFilename,
        content: input.pdfBuffer,
      },
    ],
    quoteId: input.quote.id,
    prefixTag: shortRef,
    isQuoteEmail: true,
  });
}

export function extractClarificationQuestions(questionText: string, maxQuestions = 3): string[] {
  const lines = questionText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanQuestions: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^(?:\d+[\.\)]|[-•*])\s*/, "").trim();
    if (cleaned.length > 0) {
      cleanQuestions.push(cleaned);
      if (cleanQuestions.length >= maxQuestions) break;
    }
  }

  if (cleanQuestions.length === 0) {
    cleanQuestions.push("Could you specify your estimated server, website, or network monitoring counts?");
  }

  return cleanQuestions;
}

/**
 * Deterministically renders the plain text and responsive HTML clarification email.
 */
export function renderClarificationEmail(input: {
  recipientName?: string | null;
  questionText: string;
  conversationalResponse?: string | null;
  threadId: string;
}): { textContent: string; htmlContent: string; wordCount: number } {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi there,";
  const questions = extractClarificationQuestions(input.questionText, 3);
  const numberedList = questions.map((q, idx) => `${idx + 1}. ${q}`).join("\n");

  const textContent = [
    greeting,
    "",
    "Thank you for contacting us about Site24x7. To configure the best-value plan and accurately size your monitoring requirements, could you please clarify:",
    "",
    numberedList,
    "",
    "Reply directly to this email with your counts, and we will prepare your quotation.",
    "",
    "Best regards,",
    "Quote24x7 Assistant",
  ].join("\n").trim();

  const words = textContent.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const htmlList = questions
    .map((q) => `<li style="margin-bottom: 8px;">${escapeHtml(q)}</li>`)
    .join("\n        ");

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .ref { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 4px; }
    .card { border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .card-title { font-size: 13px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    ol { margin: 0; padding-left: 20px; color: #1e293b; }
    .footer { font-size: 11px; color: #64748b; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header" style="border-bottom: 2px solid #0070ea; padding-bottom: 16px; margin-bottom: 24px;">
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0070ea; letter-spacing: 0.5px;">Clarification Needed</div>
    </div>

    <p>${escapeHtml(greeting)}</p>
    <p>Thank you for contacting us about Site24x7. To configure the best-value plan and accurately size your monitoring requirements, could you please clarify:</p>
    <div class="card">
      <div class="card-title">Questions</div>
      <ol>
        ${htmlList}
      </ol>
    </div>

    <p style="font-size: 14px; font-weight: 500; color: #0f172a;">
      Reply directly to this email with your counts, and we will prepare your quotation.
    </p>

    <div class="footer">
      Quote24x7 Assistant &mdash; Automated assistant using Site24x7 public India pricing
    </div>
  </div>
</body>
</html>`.trim();

  return { textContent, htmlContent, wordCount };
}

export async function sendClarificationEmail(
  input: SendClarificationEmailInput
): Promise<OutboundDispatchResult> {
  const subject = resolveThreadSubject(input.thread.subject);

  const { textContent, htmlContent } = renderClarificationEmail({
    recipientName: input.recipientName,
    questionText: input.questionText,
    conversationalResponse: input.conversationalResponse,
    threadId: input.thread.id,
  });

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    htmlContent,
    prefixTag: "clar",
  });
}

export async function sendNonSubstantiveReplyEmail(
  input: SendNonSubstantiveReplyEmailInput
): Promise<OutboundDispatchResult> {
  const subject = resolveThreadSubject(input.thread.subject);

  const textContent = `
Hi ${input.recipientName || "there"},

Thanks for reaching out. To put a quote together I just need to know your monitoring requirements (such as servers, websites/APIs, synthetic transactions, network devices, RUM pageviews, or log volume).

Simply reply to this email with your expected counts, and we'll calculate your configuration options.

Best regards,
Quote24x7 Assistant
https://quotes.joanathan.in/
  `.trim();

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    prefixTag: "ack",
  });
}

export async function sendFinalYieldEmail(
  input: SendFinalYieldEmailInput
): Promise<OutboundDispatchResult> {
  const subject = resolveThreadSubject(input.thread.subject);

  const missingList = input.missingUnits.length > 0
    ? input.missingUnits.map((u) => `• ${u}`).join("\n")
    : "• Specific monitoring counts (servers, websites, or network devices)";

  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for contacting us regarding Site24x7 monitoring.

To provide an accurate quotation without gaps, I still need your specific requirements for:
${missingList}

You can also explore plans and calculate custom configurations directly on the Site24x7 pricing calculator:
https://www.site24x7.in/pricing.html

If you reply with those counts I'll continue right away. You can also use Site24x7's price calculator or contact Site24x7 sales at sales@site24x7.com.

Best regards,
Quote24x7 Assistant
https://quotes.joanathan.in/
  `.trim();

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    prefixTag: "yield",
  });
}

export async function sendUnpriceableNotificationEmail(
  input: SendUnpriceableNotificationEmailInput
): Promise<OutboundDispatchResult> {
  const subject = resolveThreadSubject(input.thread.subject);

  const reasonList = input.rejectionReasons.map((r) => `• ${r}`).join("\n");

  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for contacting Quote24x7 regarding Site24x7 monitoring.

Our automated pricing system evaluated your requirements against active Site24x7 plans and add-on packs. However, we are unable to generate an automated quotation for your request due to the following:

${reasonList}

If your requirements can be adjusted or clarified, reply to this email and I will recalculate. You can also contact Site24x7 sales at sales@site24x7.com or use their price calculator.

We appreciate your patience and look forward to assisting you.

Best regards,
Quote24x7 Assistant
https://quotes.joanathan.in/
  `.trim();

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    prefixTag: "unp",
  });
}
