import { Resend } from "resend";
import type { DeliveryRecord, EmailMessage, EmailThread, Quote } from "@/types/domain";
import { getAppConfig, isTestRuntime, formatFromEmail } from "../config.ts";
import { store } from "../store/session-store.ts";
import { dryRunStore } from "../store/dryrun-store.ts";
import { formatMoney } from "../pricing/money.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";

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
 * Resolves standard RFC 2822 / 5322 In-Reply-To and References headers for email threading.
 * Gathers prior messages from the thread history to maintain email client conversation grouping.
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

  const headers: Record<string, string> = {
    "Message-ID": messageId,
  };

  const messages = store.getMessages(threadId);
  if (!messages || messages.length === 0) {
    return { messageId, headers };
  }

  const formatMsgId = (id: string): string => {
    const trimmed = id.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
    return `<${trimmed}>`;
  };

  // Predecessor message IDs: prioritize messageIdHeader if set, else format providerMessageId
  const validPredecessors = messages
    .filter(
      (m) =>
        Boolean(m.messageIdHeader || m.providerMessageId) &&
        !m.providerMessageId.startsWith("local_out_")
    )
    .map((m) => (m.messageIdHeader ? formatMsgId(m.messageIdHeader) : formatMsgId(m.providerMessageId)));

  // The latest inbound or prior message to reply directly to
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const immediateParent = lastInbound || messages[messages.length - 1];
  const inReplyTo = immediateParent
    ? immediateParent.messageIdHeader
      ? formatMsgId(immediateParent.messageIdHeader)
      : immediateParent.providerMessageId
        ? formatMsgId(immediateParent.providerMessageId)
        : undefined
    : undefined;

  const references = validPredecessors.length > 0 ? validPredecessors.join(" ") : inReplyTo;

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

function resolveOutboundRecipient(
  config: ReturnType<typeof getAppConfig>,
  threadId: string,
  intendedRecipient: string
): string {
  const policy = validateOutboundPolicy(config, threadId, intendedRecipient);
  if (policy.isBlocked) {
    throw new Error(`Outbound Policy Rejection: ${policy.blockReason}`);
  }
  return policy.targetRecipient;
}

async function dispatchEmail(input: DispatchInput): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();

  const targetRecipient = resolveOutboundRecipient(config, input.threadId, input.recipientEmail);

  if (targetRecipient.toLowerCase() === config.outboundFromEmail.toLowerCase()) {
    throw new Error(
      `Loop Prevention: Outbound recipient (${targetRecipient}) matches system sender address.`
    );
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

  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.threadId,
    `${input.prefixTag}_${Date.now()}`
  );

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const isSendingPaused = store.getOutboundSendingPaused();

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
    messageIdHeader: messageId,
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
 * Deterministically renders the plain text and responsive HTML quotation email.
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
  const planMonthlyRate =
    plan?.priceMonthlyAnnualBilled ??
    plan?.basePrice ??
    (bestValue?.lineItems?.[0]?.lineTotal
      ? Math.floor(bestValue.lineItems[0].lineTotal / 12)
      : 0);
  const totalAmount = formatMoney(bestValue?.total ?? 0, input.quote.currency);

  const planName = bestValue?.planName ?? "Recommended Plan";
  const cadenceString = `annual upfront, quoted as equivalent per-month rate of ${formatMoney(planMonthlyRate, input.quote.currency)} plus add-ons; total amount is ${totalAmount}`;

  const lineItems = bestValue?.lineItems ?? [];
  const textTableLines = [
    "Itemized Pricing Table:",
    "Item | Included Units | Purchased Units | Pack Size | Pack Count | Line Total",
    "--------------------------------------------------------------------------------",
    ...lineItems.map((item) => {
      const isBase = item.ruleId === "RULE-PLAN-BASE";
      const name = isBase ? `${planName} Base Subscription` : item.description;
      const includedUnits = isBase ? "Base entitlements" : (item.includedQuantity ?? 0).toLocaleString("en-IN");
      const purchasedUnits = (item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1))).toLocaleString("en-IN");
      const packSize = (item.packSize ?? 1).toLocaleString("en-IN");
      const packCount = String(item.quantity);
      const lineTotal = formatMoney(item.lineTotal, input.quote.currency);
      return `${name} | ${includedUnits} | ${purchasedUnits} | ${packSize} | ${packCount} | ${lineTotal}`;
    }),
    "--------------------------------------------------------------------------------",
    `Total: ${totalAmount}`,
  ];

  const calculationNote = "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.";

  let comparisonLine: string | null = null;
  if (lowestCost && lowestCost.planId !== bestValue?.planId) {
    const feature =
      bestValue?.whatItAdds && bestValue.whatItAdds.length > 0
        ? bestValue.whatItAdds[0]
        : "faster polling and additional check capacity";
    comparisonLine = `A lighter configuration on ${lowestCost.planName} would cost ${formatMoney(lowestCost.total, input.quote.currency)}, but leaves no headroom for ${feature}.`;
  }

  const pdfNotice = `Your official quotation document (PDF) is attached: Quote24x7-Proposal-${input.quote.id}.pdf`;
  const disclaimer = "Disclaimer: quotes generated against current Site24x7 India pricing and final checkout occurs via Zoho Store.";
  const prompt = "Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.";

  const textParts = [
    greeting,
    "",
    "Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your quotation.",
    "",
    "Summary of understood requirements:",
    ...understoodLines,
    "",
    `Selected plan: ${planName}`,
    `Billing: ${cadenceString}`,
    "",
    textTableLines.join("\n"),
    "",
    calculationNote,
    ...(comparisonLine ? ["", comparisonLine] : []),
    "",
    pdfNotice,
    "",
    disclaimer,
    "",
    prompt,
    "",
    "Best regards,",
    "Quote24x7 Assistant",
  ];

  const textContent = textParts.join("\n").trim();

  const htmlTableRows = lineItems
    .map((item) => {
      const isBase = item.ruleId === "RULE-PLAN-BASE";
      const name = isBase ? `${planName} Base Subscription` : item.description;
      const includedUnits = isBase ? "Base entitlements" : (item.includedQuantity ?? 0).toLocaleString("en-IN");
      const purchasedUnits = (item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1))).toLocaleString("en-IN");
      const packSize = (item.packSize ?? 1).toLocaleString("en-IN");
      const packCount = String(item.quantity);
      const lineTotal = formatMoney(item.lineTotal, input.quote.currency);

      return `      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; color: #0f172a; font-weight: ${isBase ? "600" : "normal"};">${escapeHtml(name)}</td>
        <td style="padding: 10px; color: #64748b; text-align: right;">${escapeHtml(includedUnits)}</td>
        <td style="padding: 10px; color: #0f172a; text-align: right;">${escapeHtml(purchasedUnits)}</td>
        <td style="padding: 10px; color: #64748b; text-align: right;">${escapeHtml(packSize)}</td>
        <td style="padding: 10px; color: #0f172a; text-align: right;">${escapeHtml(packCount)}</td>
        <td style="padding: 10px; color: #0f172a; text-align: right; font-weight: 600;">${escapeHtml(lineTotal)}</td>
      </tr>`;
    })
    .join("\n");

  const htmlUnderstoodList = understoodLines
    .map((l) => `<li style="margin-bottom: 4px;">${escapeHtml(l.replace(/^•\s*/, ""))}</li>`)
    .join("\n");

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 24px; background-color: #f8fafc; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
    .ref { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 4px; }
    .requirements-box { background: #f8fafc; border-left: 4px solid #2563eb; border-radius: 4px; padding: 14px 18px; margin: 18px 0; }
    .table-container { margin: 20px 0; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background-color: #f1f5f9; padding: 10px; color: #334155; font-weight: 600; border-bottom: 2px solid #cbd5e1; }
    .note { font-size: 12px; color: #64748b; margin-top: 8px; font-style: italic; }
    .comparison-box { background: #fefce8; border-left: 4px solid #eab308; border-radius: 4px; padding: 12px 16px; margin: 18px 0; font-size: 13px; color: #713f12; }
    .attachment-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px 16px; font-size: 13px; color: #1e40af; margin: 20px 0; }
    .disclaimer { font-size: 11px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px; line-height: 1.5; }
    .reply-prompt { font-size: 14px; font-weight: 500; color: #0f172a; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header" style="border-bottom: 2px solid #0070ea; padding-bottom: 16px; margin-bottom: 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="left" valign="middle">
            <a href="https://quotes.joanathan.in/" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="https://quotes.joanathan.in/logo.png" alt="Quote24x7" width="160" height="auto" style="display: block; max-width: 160px; height: auto; border: 0;" />
            </a>
          </td>
          <td align="right" valign="middle">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0070ea; letter-spacing: 0.5px;">Commercial Proposal</div>
            <div class="ref" style="margin-top: 2px;">Proposal #${escapeHtml(input.quote.id)}</div>
          </td>
        </tr>
      </table>
    </div>

    <p>${escapeHtml(greeting)}</p>
    <p>Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, here is your quotation.</p>

    <div class="requirements-box">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #1e40af; letter-spacing: 0.5px; margin-bottom: 6px;">Summary of Understood Requirements</div>
      <ul style="margin: 0; padding-left: 18px; color: #334155; font-size: 13px;">
${htmlUnderstoodList}
      </ul>
    </div>

    <div style="margin: 18px 0;">
      <div style="font-size: 15px; font-weight: 700; color: #0f172a;">Selected Plan: ${escapeHtml(planName)}</div>
      <div style="font-size: 13px; color: #475569; margin-top: 4px;"><strong>Billing:</strong> ${escapeHtml(cadenceString)}</div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="text-align: left;">Line Item</th>
            <th style="text-align: right;">Included Units</th>
            <th style="text-align: right;">Purchased Units</th>
            <th style="text-align: right;">Pack Size</th>
            <th style="text-align: right;">Pack Count</th>
            <th style="text-align: right;">Line Total</th>
          </tr>
        </thead>
        <tbody>
${htmlTableRows}
          <tr style="border-top: 2px solid #0f172a; font-weight: 700; background-color: #f8fafc;">
            <td colspan="5" style="padding: 12px 10px;">Total</td>
            <td style="padding: 12px 10px; text-align: right; color: #2563eb; font-size: 15px;">${escapeHtml(totalAmount)}</td>
          </tr>
        </tbody>
      </table>
      <div class="note">${escapeHtml(calculationNote)}</div>
    </div>

${
  comparisonLine
    ? `    <div class="comparison-box">
      <strong>Alternative Comparison:</strong> ${escapeHtml(comparisonLine)}
    </div>`
    : ""
}

    <div class="attachment-box">
      <strong>PDF Attached:</strong> ${escapeHtml(pdfNotice)}
    </div>

    <div class="reply-prompt">
      ${escapeHtml(prompt)}
    </div>

    <div class="disclaimer">
      ${escapeHtml(disclaimer)}
    </div>
  </div>
</body>
</html>`.trim();

  return { textContent, htmlContent };
}

export async function sendQuoteEmail(input: SendQuoteEmailInput): Promise<OutboundDispatchResult> {
  const cleanSub = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSub} - Proposal Ref #${input.quote.id} [Ref: #${input.thread.id}]`;

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
        filename: `Quote24x7-Proposal-${input.quote.id}.pdf`,
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
  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Clarification Needed`;

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
  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}]`;

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
  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Information Needed`;

  const missingList = input.missingUnits.length > 0
    ? input.missingUnits.map((u) => `• ${u}`).join("\n")
    : "• Specific monitoring counts (servers, websites, or network devices)";

  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for contacting us regarding Site24x7 monitoring.

To provide an accurate quotation without gaps, our team still needs your specific requirements for:
${missingList}

You can also explore plans and calculate custom configurations directly on the Site24x7 pricing calculator:
https://www.site24x7.in/pricing.html

We have parked this inquiry for sales engineering review. If your requirements change or you have these counts available, simply reply to this email and we will be happy to assist.

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
  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Custom Pricing Notice`;

  const reasonList = input.rejectionReasons.map((r) => `• ${r}`).join("\n");

  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for contacting Quote24x7 regarding Site24x7 monitoring.

Our automated pricing engine evaluated your requirements against active Site24x7 plans and add-on packs. However, we are unable to generate an automated quotation for your request due to the following constraint(s):

${reasonList}

What happens next:
1. Your request has been escalated to our team for manual sizing and custom volume pricing.
2. If your requirements can be adjusted or clarified, you may reply directly to this email to trigger an updated calculation.

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
