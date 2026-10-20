import { Resend } from "resend";
import type { DeliveryRecord, EmailMessage, EmailThread, Quote } from "@/types/domain";
import { getAppConfig, isTestRuntime, formatFromEmail } from "../config.ts";
import { store } from "../store/session-store.ts";
import { dryRunStore } from "../store/dryrun-store.ts";
import { formatMoney } from "../pricing/money.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildComparisonLine } from "../pricing/engine.ts";
import { dedupe, extractMessageIds, normalizeRfcMessageId } from "./rfc-message-id.ts";

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
const INTERNAL_ID_RE = /\b(th_|qt_)\w+/;
const UNFORMATTED_LARGE_INT_RE = /(?<!₹|INR\s|#)(?<![\d,.])(?<!\.)\b\d{5,}\b(?![\d,])(?!\s*(?:paise|cents))/;
const NON_QUOTE_HTML_FORBIDDEN = /<img\b|<button\b|background-color\s*:/i;

export interface PreSendCheckResult {
  passed: boolean;
  violations: string[];
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

  const idMatch = content.match(INTERNAL_ID_RE);
  if (idMatch && !options?.isQuoteEmail) {
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
  const cleaned = originalSubject.replace(/^(?:re|fwd):\s*/gi, "").trim();
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
  if (!check.passed || !subjectCheck.passed) {
    const allViolations = [...check.violations, ...subjectCheck.violations];
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
  } else if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);
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

/**
 * Deterministically renders the plain text and plain HTML quotation email.
 * Table columns: Item | Qty | What it covers | Per year.
 * HTML uses only p, br, ul, ol, li, strong, a, table — no logo, banner or coloured boxes.
 */
export function renderQuoteEmail(input: {
  recipientName?: string | null;
  quote: Quote;
  threadId: string;
  conversationalResponse?: string | null;
}): { textContent: string; htmlContent: string } {
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi there,";
  const bestValue =
    input.quote.options.find((o) => o.optionType === "best_value") ?? input.quote.options[0];
  const lowestCost = input.quote.options.find((o) => o.optionType === "lowest_cost");

  const understoodLines: string[] = [];
  if (bestValue?.coverage && bestValue.coverage.length > 0) {
    for (const row of bestValue.coverage) {
      if (row.required > 0) {
        understoodLines.push(`• ${row.label}: ${row.required.toLocaleString("en-IN")}`);
      }
    }
  }
  if (understoodLines.length === 0) {
    understoodLines.push("• Sizing parameters provided in your inquiry");
  }

  const catalogue = loadActiveCatalogue();
  const plan = catalogue.plans.find((p) => p.id === bestValue?.planId);
  const planName = bestValue?.planName ?? "Recommended Plan";
  const totalAmount = formatMoney(bestValue?.total ?? 0, input.quote.currency);
  const lineItems = bestValue?.lineItems ?? [];

  const rows = lineItems.map((item) => {
    const isBase = item.ruleId === "RULE-BASE-PRICE";
    const monthlyRate =
      plan?.priceMonthlyAnnualBilled ??
      plan?.basePrice ??
      (item.lineTotal ? Math.floor(item.lineTotal / 12) : 0);
    const name = isBase
      ? `${planName} plan (${formatMoney(monthlyRate, input.quote.currency)}/mo x 12months)`
      : item.description;
    const purchased = item.purchasedUnits ?? item.quantity * (item.packSize ?? 1);
    const qty = isBase ? "1" : purchased.toLocaleString("en-IN");
    const packSize = item.packSize ?? 1;
    const covers = isBase
      ? "Base entitlements"
      : `${packSize.toLocaleString("en-IN")} per pack x ${item.quantity}`;
    return { name, qty, covers, total: formatMoney(item.lineTotal, input.quote.currency) };
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
  if (lowestCost && bestValue && lowestCost.planId !== bestValue.planId) {
    comparisonLine = buildComparisonLine(lowestCost, bestValue);
  }

  const pdfFilename = `Site24x7-estimate-${input.quote.id}.pdf`;

  const textContent = [
    greeting,
    "",
    "Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your quotation.",
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
    `Your official quotation document (PDF) is attached: ${pdfFilename}`,
    "",
    "Estimate valid 30 days. Costs in INR; local taxes extra; final price confirmed by Site24x7 at purchase.",
    "",
    "Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.",
    "",
    "Quote24x7 Assistant",
    `Ref ${input.quote.id}`,
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
    "<p>Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your quotation.</p>",
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
    `<p>Your official quotation document (PDF) is attached: <em>${escapeHtml(pdfFilename)}</em></p>`,
    "<p>Estimate valid 30 days. Costs in INR; local taxes extra; final price confirmed by Site24x7 at purchase.</p>",
    "<p>Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.</p>",
    "<hr>",
    `<p style="font-size:12px;color:#666;">Quote24x7 Assistant<br>Ref ${escapeHtml(input.quote.id)}</p>`,
    "</body>",
    "</html>",
  ].join("\n");

  return { textContent, htmlContent };
}

export async function sendQuoteEmail(input: SendQuoteEmailInput): Promise<OutboundDispatchResult> {
  const subject = resolveThreadSubject(input.thread.subject);

  const { textContent, htmlContent } = renderQuoteEmail({
    recipientName: input.recipientName,
    quote: input.quote,
    threadId: input.thread.id,
    conversationalResponse: input.conversationalResponse,
  });

  return dispatchEmail({
    threadId: input.thread.id,
    recipientEmail: input.recipientEmail,
    subject,
    textContent,
    htmlContent,
    attachments: [
      {
        filename: `Site24x7-estimate-${input.quote.id}.pdf`,
        content: input.pdfBuffer,
      },
    ],
    quoteId: input.quote.id,
    prefixTag: input.quote.id,
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
