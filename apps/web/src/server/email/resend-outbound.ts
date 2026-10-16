import { Resend } from "resend";
import type { DeliveryRecord, EmailMessage, EmailThread, Quote } from "@/types/domain";
import { getAppConfig, isTestRuntime, formatFromEmail } from "../config.ts";
import { store } from "../store/session-store.ts";
import { dryRunStore } from "../store/dryrun-store.ts";
import { formatMoney } from "../pricing/money.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";

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

/**
 * Resend Outbound Email Service.
 * Transmits commercial quotation proposals with attached PDF documents,
 * or clarification inquiries when material requirements are missing.
 */
/**
 * Deterministically renders the plain text and responsive HTML quotation email.
 * Adheres strictly to Phase 8 specifications:
 * - Polite greeting with buyer's name.
 * - Summary of understood requirements.
 * - Selected plan name, billing cadence: 'annual upfront, quoted as equivalent per-month rate of X paise plus add-ons; total billed today is Y'.
 * - Itemized table: Plan base + each add-on (name, included units, purchased units, pack size, pack count, line total).
 * - Transparent calculation note: 'Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.'
 * - Comparison line (when applicable): 'A lighter configuration on <Alternative Plan> would cost <Z>, but leaves no headroom for <feature>.'
 * - Mention official quotation PDF is attached ("Quote24x7-Proposal-${input.quote.id}.pdf").
 * - Disclaimer: quotes generated against current Site24x7 India pricing and final checkout occurs via Zoho Store.
 * - Prompt: 'Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.'
 * - Both plain text and responsive HTML versions.
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

  // 1. Summary of understood requirements
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

  // 2. Selected plan name & billing cadence
  const catalogue = loadActiveCatalogue();
  const plan = catalogue.plans.find((p) => p.id === bestValue?.planId);
  const planMonthlyPaise =
    plan?.priceMonthlyAnnualBilled ??
    plan?.basePrice ??
    (bestValue?.lineItems?.[0]?.lineTotal
      ? Math.floor(bestValue.lineItems[0].lineTotal / 12)
      : 0);
  const totalBilledToday = formatMoney(bestValue?.total ?? 0, input.quote.currency);

  const planName = bestValue?.planName ?? "Recommended Plan";
  const cadenceString = `annual upfront, quoted as equivalent per-month rate of ${planMonthlyPaise} paise plus add-ons; total billed today is ${totalBilledToday}`;

  // 3. Itemized table (Plan base + each add-on: name, included units, purchased units, pack size, pack count, line total)
  const lineItems = bestValue?.lineItems ?? [];
  const textTableLines = [
    "Itemized Pricing Table:",
    "Item | Included Units | Purchased Units | Pack Size | Pack Count | Line Total",
    "--------------------------------------------------------------------------------",
    ...lineItems.map((item) => {
      const isBase = item.ruleId === "RULE-PLAN-BASE";
      const name = isBase ? `${planName} Base Subscription` : item.description;
      const includedUnits = isBase ? "Base entitlements" : String(item.includedQuantity ?? 0);
      const purchasedUnits = String(item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1)));
      const packSize = String(item.packSize ?? 1);
      const packCount = String(item.quantity);
      const lineTotal = formatMoney(item.lineTotal, input.quote.currency);
      return `${name} | ${includedUnits} | ${purchasedUnits} | ${packSize} | ${packCount} | ${lineTotal}`;
    }),
    "--------------------------------------------------------------------------------",
    `Total Billed Today: ${totalBilledToday}`,
  ];

  // 4. Transparent calculation note
  const calculationNote = "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.";

  // 5. Comparison line (when applicable)
  let comparisonLine: string | null = null;
  if (lowestCost && lowestCost.planId !== bestValue?.planId) {
    const feature =
      bestValue?.whatItAdds && bestValue.whatItAdds.length > 0
        ? bestValue.whatItAdds[0]
        : "faster polling and additional check capacity";
    comparisonLine = `A lighter configuration on ${lowestCost.planName} would cost ${formatMoney(lowestCost.total, input.quote.currency)}, but leaves no headroom for ${feature}.`;
  }

  // 6. Mention official quotation PDF is attached
  const pdfNotice = `Your official quotation document (PDF) is attached: Quote24x7-Proposal-${input.quote.id}.pdf`;

  // 7. Disclaimer
  const disclaimer = "Disclaimer: quotes generated against current Site24x7 India pricing and final checkout occurs via Zoho Store.";

  // 8. Prompt
  const prompt = "Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.";

  // Build Plain Text Content
  const textParts = [
    greeting,
    "",
    "Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, we have prepared a tailored quotation.",
    "",
    "Summary of understood requirements:",
    ...understoodLines,
    "",
    `Selected plan: ${planName}`,
    `Billing cadence: ${cadenceString}`,
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

  // Build HTML Content
  const htmlTableRows = lineItems
    .map((item) => {
      const isBase = item.ruleId === "RULE-PLAN-BASE";
      const name = isBase ? `${planName} Base Subscription` : item.description;
      const includedUnits = isBase ? "Base entitlements" : String(item.includedQuantity ?? 0);
      const purchasedUnits = String(item.purchasedUnits ?? (item.quantity * (item.packSize ?? 1)));
      const packSize = String(item.packSize ?? 1);
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
    <p>Thank you for contacting us about Site24x7 monitoring. Based on your stated requirements, we have prepared a tailored quotation.</p>

    <div class="requirements-box">
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #1e40af; letter-spacing: 0.5px; margin-bottom: 6px;">Summary of Understood Requirements</div>
      <ul style="margin: 0; padding-left: 18px; color: #334155; font-size: 13px;">
${htmlUnderstoodList}
      </ul>
    </div>

    <div style="margin: 18px 0;">
      <div style="font-size: 15px; font-weight: 700; color: #0f172a;">Selected Plan: ${escapeHtml(planName)}</div>
      <div style="font-size: 13px; color: #475569; margin-top: 4px;"><strong>Billing Cadence:</strong> ${escapeHtml(cadenceString)}</div>
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
            <td colspan="5" style="padding: 12px 10px;">Total Billed Today</td>
            <td style="padding: 12px 10px; text-align: right; color: #2563eb; font-size: 15px;">${escapeHtml(totalBilledToday)}</td>
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
      📎 <strong>PDF Attached:</strong> ${escapeHtml(pdfNotice)}
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

/**
 * Resend Outbound Email Service.
 * Transmits commercial quotation proposals with attached PDF documents,
 * or clarification inquiries when material requirements are missing.
 */
export async function sendQuoteEmail(input: SendQuoteEmailInput): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();

  // Safety checks & Loop Prevention
  const targetRecipient = resolveOutboundRecipient(config, input.thread.id, input.recipientEmail);

  if (targetRecipient.toLowerCase() === config.outboundFromEmail.toLowerCase()) {
    throw new Error(
      `Loop Prevention: Outbound recipient (${targetRecipient}) matches system sender address.`
    );
  }

  const cleanSub = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSub} - Proposal Ref #${input.quote.id} [Ref: #${input.thread.id}]`;
  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.thread.id,
    input.quote.id
  );

  const { textContent, htmlContent } = renderQuoteEmail({
    recipientName: input.recipientName,
    quote: input.quote,
    threadId: input.thread.id,
    conversationalResponse: input.conversationalResponse,
  });


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
    // Real Resend Dispatch
    try {
      const resend = new Resend(config.resendApiKey);

      const res = await resend.emails.send({
        from: formatFromEmail(config.outboundFromEmail),
        to: targetRecipient,
        replyTo: formatFromEmail(config.inboundAddress || "quotes@quotes.joanathan.in"),
        subject,
        text: textContent,
        html: htmlContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
        attachments: [
          {
            filename: `Quote24x7-Proposal-${input.quote.id}.pdf`,
            content: input.pdfBuffer,
          },
        ],
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
    // Dry Run / Demo Mode (Resend key missing or ALLOW_EXTERNAL_DISPATCH not true)
    providerMessageId = `dryrun_${Date.now()}`;
    mode = "dry_run";
  }

  // Record Delivery in store
  const deliveryRecord: DeliveryRecord = {
    id: deliveryId,
    threadId: input.thread.id,
    quoteId: input.quote.id,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject,
    status: status === "accepted" ? "queued" : "failed", // Marked queued until webhook confirms accepted/delivered
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
              : `Dry-run simulated dispatch (ALLOW_EXTERNAL_DISPATCH is not true)`,
      },
    ],
  };

  if (mode === "dry_run") {
    dryRunStore.saveDelivery(deliveryRecord);
  } else {
    store.saveDelivery(deliveryRecord);
  }

  // Record outbound message in thread timeline
  const outboundMessage: EmailMessage = {
    id: `msg_out_${Date.now()}`,
    threadId: input.thread.id,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: "Quote24x7 Assistant",
    toAddresses: [targetRecipient],
    subject,
    bodyText: textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: [
      {
        name: `Quote24x7-Proposal-${input.quote.id}.pdf`,
        contentType: "application/pdf",
        sizeBytes: input.pdfBuffer.length,
        scanned: true,
      },
    ],
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
 * Adheres strictly to Phase 8 specifications:
 * - Polite greeting with buyer's name if known.
 * - At most 3 numbered questions (e.g. 1., 2., 3.). No prices anywhere in the body.
 * - Strict limit under 120 words.
 * - Both plain text and responsive HTML versions.
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
    "Reply directly to this email with your counts, and we will prepare your customized quotation.",
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
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 24px; background-color: #f8fafc; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
    .ref { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 4px; }
    .card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .card-title { font-size: 13px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    ol { margin: 0; padding-left: 20px; color: #1e293b; }
    .footer { font-size: 11px; color: #64748b; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
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
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0070ea; letter-spacing: 0.5px;">Sizing Clarification</div>
            <div class="ref" style="margin-top: 2px;">Conversation #${escapeHtml(input.threadId)}</div>
          </td>
        </tr>
      </table>
    </div>

    <p>${escapeHtml(greeting)}</p>
    <p>Thank you for contacting us about Site24x7. To configure the best-value plan and accurately size your monitoring requirements, could you please clarify:</p>
    <div class="card">
      <div class="card-title">Sizing Questions</div>
      <ol>
        ${htmlList}
      </ol>
    </div>

    <p style="font-size: 14px; font-weight: 500; color: #0f172a;">
      Reply directly to this email with your counts, and we will prepare your customized quotation.
    </p>

    <div class="footer">
      Quote24x7 Assistant • Automated assistant using Site24x7's public India pricing
    </div>
  </div>
</body>
</html>`.trim();

  return { textContent, htmlContent, wordCount };
}

/**
 * Transmits a clarification inquiry when requirements are missing.
 */
export async function sendClarificationEmail(
  input: SendClarificationEmailInput
): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();
  const targetRecipient = resolveOutboundRecipient(config, input.thread.id, input.recipientEmail);

  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Quick Sizing Clarification`;

  const { textContent, htmlContent } = renderClarificationEmail({
    recipientName: input.recipientName,
    questionText: input.questionText,
    conversationalResponse: input.conversationalResponse,
    threadId: input.thread.id,
  });

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.thread.id,
    `clar_${Date.now()}`
  );

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
        subject,
        text: textContent,
        html: htmlContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
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
    threadId: input.thread.id,
    quoteId: null,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject,
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
            ? `Clarification dispatched via Resend (messageId: ${providerMessageId}${inReplyTo ? `, In-Reply-To: ${inReplyTo}` : ""})`
            : isSendingPaused
              ? "Queued in store: Automated outbound dispatch paused by operator kill switch"
              : "Clarification email queued in demo mode",
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
    threadId: input.thread.id,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: "Quote24x7 Assistant",
    toAddresses: [targetRecipient],
    subject,
    bodyText: textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: [],
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
 * Transmits a short polite message for non-substantive inquiries (e.g. "hi", "thanks", "ok").
 * Does not consume a clarification round and does not increment nonproductive streak.
 */
export async function sendNonSubstantiveReplyEmail(
  input: SendNonSubstantiveReplyEmailInput
): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();
  const targetRecipient = resolveOutboundRecipient(config, input.thread.id, input.recipientEmail);

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

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.thread.id,
    `ack_${Date.now()}`
  );
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
        subject,
        text: textContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
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
    threadId: input.thread.id,
    quoteId: null,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject,
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
            ? `Non-substantive acknowledgment dispatched via Resend (messageId: ${providerMessageId}${inReplyTo ? `, In-Reply-To: ${inReplyTo}` : ""})`
            : "Non-substantive acknowledgment queued in demo mode",
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
    threadId: input.thread.id,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: "Quote24x7 Assistant",
    toAddresses: [targetRecipient],
    subject,
    bodyText: textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: [],
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
 * Transmits the final yield email when clarification rounds are exhausted or after
 * 2 consecutive non-productive buyer replies. Parks the thread and links to calculator.
 */
export async function sendFinalYieldEmail(
  input: SendFinalYieldEmailInput
): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();
  const targetRecipient = resolveOutboundRecipient(config, input.thread.id, input.recipientEmail);

  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Sizing Information Needed`;

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

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.thread.id,
    `yield_${Date.now()}`
  );
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
        subject,
        text: textContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
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
    threadId: input.thread.id,
    quoteId: null,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject,
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
            ? `Final yield email dispatched via Resend (messageId: ${providerMessageId}${inReplyTo ? `, In-Reply-To: ${inReplyTo}` : ""})`
            : "Final yield email queued in demo mode",
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
    threadId: input.thread.id,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: "Quote24x7 Assistant",
    toAddresses: [targetRecipient],
    subject,
    bodyText: textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: [],
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
 * Transmits a notification when requirements cannot be satisfied by active catalogue plans
 * or verified prices are missing, escalating to manual review.
 */
export async function sendUnpriceableNotificationEmail(
  input: SendUnpriceableNotificationEmailInput
): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();
  const targetRecipient = resolveOutboundRecipient(config, input.thread.id, input.recipientEmail);

  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Sizing & Custom Pricing Notice`;

  const reasonList = input.rejectionReasons.map((r) => `• ${r}`).join("\n");

  const textContent = `
Dear ${input.recipientName || "Valued Customer"},

Thank you for contacting Quote24x7 regarding Site24x7 monitoring.

Our automated pricing engine evaluated your requirements against active Site24x7 plans and add-on packs. However, we are unable to generate an automated quotation for your request due to the following constraint(s):

${reasonList}

Reference: #${input.thread.id}

What happens next:
1. Your request has been escalated to our Enterprise Solutions team for manual sizing and custom volume pricing.
2. If your requirements can be adjusted or clarified, you may reply directly to this email to trigger an updated calculation.

We appreciate your patience and look forward to assisting you.

Warm regards,
Quote24x7 Operations & Solutions Team
https://quotes.joanathan.in/
  `.trim();

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { messageId, inReplyTo, references, headers: threadingHeaders } = buildThreadingHeaders(
    input.thread.id,
    `unp_${Date.now()}`
  );

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
        subject,
        text: textContent,
        headers: Object.keys(threadingHeaders).length > 0 ? threadingHeaders : undefined,
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
    threadId: input.thread.id,
    quoteId: null,
    provider: "resend",
    providerMessageId,
    recipient: targetRecipient,
    subject,
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
            ? `Unpriceable notification dispatched via Resend (messageId: ${providerMessageId}${inReplyTo ? `, In-Reply-To: ${inReplyTo}` : ""})`
            : isSendingPaused
              ? "Queued in store: Automated outbound dispatch paused by operator kill switch"
              : "Unpriceable notification email queued in demo mode",
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
    threadId: input.thread.id,
    providerMessageId: providerMessageId ?? `local_out_${Date.now()}`,
    direction: "outbound",
    fromAddress: config.outboundFromEmail,
    fromName: "Quote24x7 Operations & Solutions Team",
    toAddresses: [targetRecipient],
    subject,
    bodyText: textContent,
    occurredAt: now,
    deliveryId,
    securityNotes: [],
    attachments: [],
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
