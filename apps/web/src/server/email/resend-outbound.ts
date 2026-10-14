import { Resend } from "resend";
import type { DeliveryRecord, EmailMessage, EmailThread, Quote } from "@/types/domain";
import { getAppConfig } from "../config.ts";
import { store } from "../store/session-store.ts";
import { formatMoney } from "../pricing/money.ts";

export interface SendQuoteEmailInput {
  thread: EmailThread;
  quote: Quote;
  pdfBuffer: Buffer;
  recipientEmail: string;
  recipientName?: string | null;
}

export interface SendClarificationEmailInput {
  thread: EmailThread;
  questionText: string;
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
export function buildThreadingHeaders(threadId: string): {
  inReplyTo?: string;
  references?: string;
  headers: Record<string, string>;
} {
  const messages = store.getMessages(threadId);
  if (!messages || messages.length === 0) {
    return { headers: {} };
  }

  const formatMsgId = (id: string): string => {
    const trimmed = id.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
    return `<${trimmed}>`;
  };

  // Predecessor message IDs (exclude internal unpersisted placeholder IDs)
  const validPredecessors = messages
    .filter((m) => Boolean(m.providerMessageId) && !m.providerMessageId.startsWith("local_out_"))
    .map((m) => formatMsgId(m.providerMessageId));

  // The latest inbound or prior message to reply directly to
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const immediateParent = lastInbound || messages[messages.length - 1];
  const inReplyTo = immediateParent?.providerMessageId
    ? formatMsgId(immediateParent.providerMessageId)
    : undefined;

  const references = validPredecessors.length > 0 ? validPredecessors.join(" ") : inReplyTo;

  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references) headers["References"] = references;

  return { inReplyTo, references, headers };
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
  const targetRecipient = (config.testRecipientEmail || input.recipientEmail).trim();

  if (targetRecipient.toLowerCase() === config.outboundFromEmail.toLowerCase()) {
    throw new Error(
      `Loop Prevention: Outbound recipient (${targetRecipient}) matches system sender address.`
    );
  }

  const bestValue =
    input.quote.options.find((o) => o.optionType === "best_value") ?? input.quote.options[0];
  const lowestCost = input.quote.options.find((o) => o.optionType === "lowest_cost");
  const bestCoverage = input.quote.options.find((o) => o.optionType === "best_coverage");

  const cleanSub = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSub} - Proposal Ref #${input.quote.id} [Ref: #${input.thread.id}]`;

  // Safe Public Proposal URL handling
  const isPublicUrl = config.isPublicAppUrl;
  const proposalUrl = isPublicUrl ? `${config.appBaseUrl}/proposals/${input.quote.id}` : null;
  if (!isPublicUrl) {
    console.warn(
      `[resend-outbound] Configured appBaseUrl is not a public hostname ("${config.appBaseUrl}"). Omitting raw localhost portal link from quotation email to ${targetRecipient}.`
    );
  }

  const { inReplyTo, headers: threadingHeaders } = buildThreadingHeaders(input.thread.id);

  // Plain Text Version (Humanized, clear, no internal jargon)
  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for reaching out about your Site24x7 monitoring setup. Based on your stated infrastructure requirements, we've tailored a custom configuration to fully cover your workload.

RECOMMENDED CONFIGURATION (Best Value):
• Plan: ${bestValue?.planName ?? "Recommended Plan"}
• Total (${input.quote.billingPeriod}): ${bestValue ? formatMoney(bestValue.total, input.quote.currency) : "—"}
• Sizing Note: ${bestValue?.rankReason ?? "Optimized for your required capacity with minimal excess."}
${lowestCost ? `\nLOWEST COMMITMENT OPTION:\n• Plan: ${lowestCost.planName}\n• Total (${input.quote.billingPeriod}): ${formatMoney(lowestCost.total, input.quote.currency)}\n• Note: ${lowestCost.rankReason}\n` : ""}${bestCoverage ? `\nMAXIMUM HEADROOM OPTION:\n• Plan: ${bestCoverage.planName}\n• Total (${input.quote.billingPeriod}): ${formatMoney(bestCoverage.total, input.quote.currency)}\n• Note: ${bestCoverage.headroomNotes?.[0] || bestCoverage.rankReason}\n` : ""}
${
  proposalUrl
    ? `INTERACTIVE PROPOSAL & PURCHASE HANDOFF:
You can review the full interactive proposal online, explore capacity allowances, or proceed to order activation here:
${proposalUrl}`
    : `ONLINE PROPOSAL & CAPACITY BREAKDOWN:
Your official itemized breakdown, capacity allowances, and pricing terms are attached in the accompanying quotation document ("Quote24x7-Proposal-${input.quote.id}.pdf").`
}

OFFICIAL PDF QUOTATION:
We have also attached your official quotation PDF ("Quote24x7-Proposal-${input.quote.id}.pdf") containing the itemized component packs, included allowances, and transparent unit rates for your procurement and budgeting records.

NEXT STEPS:
If you would like to adjust any server counts or add optional services, simply reply directly to this email or click "Proceed to Purchase Handoff" on your online proposal.

Best regards,
Quote24x7 Assistant
https://www.site24x7.in/
  `.trim();

  // Responsive HTML Version (Clean, professional, humanized)
  const htmlContent = `
<!DOCTYPE html>
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
    .card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .card.highlight { background: #eff6ff; border-color: #93c5fd; }
    .card-tag { font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; }
    .plan-name { font-size: 18px; font-weight: 700; color: #0f172a; margin: 6px 0 2px 0; }
    .price { font-size: 24px; font-weight: 800; color: #2563eb; font-family: monospace; margin-bottom: 8px; }
    .note { font-size: 13px; color: #475569; }
    .btn-container { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
    .attachment-box { background: #f1f5f9; border-radius: 6px; padding: 12px 16px; font-size: 13px; color: #334155; margin-top: 20px; }
    .disclaimer { font-size: 11px; color: #64748b; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Site24x7 Monitoring Proposal</h1>
      <div class="ref">Proposal Reference #${input.quote.id}  •  Billing: ${input.quote.billingPeriod}</div>
    </div>

    <p>Hi ${input.recipientName || "there"},</p>
    <p>Thank you for reaching out about your Site24x7 monitoring setup. Based on your stated infrastructure requirements, we've designed a tailored configuration to cover your workload.</p>

    <div class="card highlight">
      <div class="card-tag">Recommended Configuration (Best Value)</div>
      <div class="plan-name">${bestValue?.planName ?? "Recommended Plan"}</div>
      <div class="price">${bestValue ? formatMoney(bestValue.total, input.quote.currency) : "—"} <span style="font-size: 13px; font-weight: normal; color: #64748b;">/${input.quote.billingPeriod}</span></div>
      <div class="note">${bestValue?.rankReason ?? "Optimized for your required capacity with minimal excess."}</div>
    </div>

    ${
      proposalUrl
        ? `
    <div class="btn-container">
      <a href="${proposalUrl}" class="btn" target="_blank">View Interactive Proposal Online →</a>
    </div>`
        : `
    <div class="attachment-box" style="margin: 20px 0; background: #eff6ff; border: 1px solid #bfdbfe;">
      📄 <strong>Itemized Quotation Attached:</strong> Complete capacity breakdown and transparent pricing are detailed in the attached PDF: <code>Quote24x7-Proposal-${input.quote.id}.pdf</code>.
    </div>`
    }

    ${
      lowestCost
        ? `
    <div class="card">
      <div class="card-tag" style="color: #475569;">Lowest Commitment Option</div>
      <div class="plan-name">${lowestCost.planName}</div>
      <div class="price" style="font-size: 18px; color: #0f172a;">${formatMoney(lowestCost.total, input.quote.currency)} <span style="font-size: 12px; font-weight: normal; color: #64748b;">/${input.quote.billingPeriod}</span></div>
      <div class="note">${lowestCost.rankReason}</div>
    </div>`
        : ""
    }

    ${
      bestCoverage
        ? `
    <div class="card">
      <div class="card-tag" style="color: #475569;">Maximum Headroom Option</div>
      <div class="plan-name">${bestCoverage.planName}</div>
      <div class="price" style="font-size: 18px; color: #0f172a;">${formatMoney(bestCoverage.total, input.quote.currency)} <span style="font-size: 12px; font-weight: normal; color: #64748b;">/${input.quote.billingPeriod}</span></div>
      <div class="note">${bestCoverage.headroomNotes?.[0] || bestCoverage.rankReason}</div>
    </div>`
        : ""
    }

    <div class="attachment-box">
      📎 <strong>Attached:</strong> <code>Quote24x7-Proposal-${input.quote.id}.pdf</code> (official quotation breakdown with itemized packs and unit rates).
    </div>

    <p style="font-size: 13px; color: #475569; margin-top: 20px;">
      To proceed or request any adjustments, simply reply directly to this email or use the purchase handoff option in your online proposal.
    </p>

    <div class="disclaimer">
      <strong>Notice:</strong> This proposal is calculated from public Site24x7 pricing benchmarks for planning and procurement. Final activation is fulfilled via official Site24x7 sales channels.
    </div>
  </div>
</body>
</html>
  `.trim();

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  // Real Resend Dispatch
  if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);

      const res = await resend.emails.send({
        from: config.outboundFromEmail,
        to: targetRecipient,
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
            : `Dry-run simulated dispatch (ALLOW_EXTERNAL_DISPATCH is not true)`,
      },
    ],
  };

  store.saveDelivery(deliveryRecord);

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
 * Transmits a clarification inquiry when requirements are missing.
 */
export async function sendClarificationEmail(
  input: SendClarificationEmailInput
): Promise<OutboundDispatchResult> {
  const config = getAppConfig();
  const deliveryId = `del_${Date.now()}`;
  const now = new Date().toISOString();
  const targetRecipient = (config.testRecipientEmail || input.recipientEmail).trim();

  const cleanSubject = input.thread.subject.replace(/^(?:re|fwd):\s*/i, "").trim();
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Quick Sizing Clarification`;

  // Parse questions into clean list
  const formattedQuestions = input.questionText
    .split("\n")
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .map((q) => (q.startsWith("•") || q.startsWith("-") || /^\d+\./.test(q) ? q : `• ${q}`))
    .join("\n");

  const textContent = `
Hi ${input.recipientName || "there"},

Thank you for reaching out regarding Site24x7 monitoring.

To ensure our pricing engine configures the best-value plan and accurately provisions any necessary add-on capacity for your infrastructure, could you please clarify:

${formattedQuestions}

Simply reply directly to this email with your counts or estimates, and we will immediately calculate your configuration options and send over your quotation.

Best regards,
Quote24x7 Assistant
https://www.site24x7.in/
  `.trim();

  const htmlQuestions = input.questionText
    .split("\n")
    .map((q) => q.trim().replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, ""))
    .filter((q) => q.length > 0)
    .map((q) => `<li style="margin-bottom: 8px;">${q}</li>`)
    .join("");

  const htmlContent = `
<!DOCTYPE html>
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
    ul { margin: 0; padding-left: 20px; color: #1e293b; }
    .footer { font-size: 11px; color: #64748b; margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Site24x7 Sizing Clarification</h1>
      <div class="ref">Conversation #${input.thread.id}</div>
    </div>

    <p>Hi ${input.recipientName || "there"},</p>
    <p>Thank you for reaching out regarding Site24x7 monitoring. To configure the best-value plan and accurately provision any required add-on capacity for your infrastructure, could you clarify a few details?</p>

    <div class="card">
      <div class="card-title">Sizing Questions</div>
      <ul>
        ${htmlQuestions}
      </ul>
    </div>

    <p style="font-size: 14px; font-weight: 500; color: #0f172a;">
      Simply reply directly to this email with your counts, and we'll immediately calculate your configuration options and generate your proposal.
    </p>

    <div class="footer">
      Quote24x7 Autonomous Operations • <a href="https://www.site24x7.in/">https://www.site24x7.in/</a>
    </div>
  </div>
</body>
</html>
  `.trim();

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { inReplyTo, headers: threadingHeaders } = buildThreadingHeaders(input.thread.id);

  if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);
      const res = await resend.emails.send({
        from: config.outboundFromEmail,
        to: targetRecipient,
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
            : "Clarification email queued in demo mode",
      },
    ],
  };

  store.saveDelivery(deliveryRecord);

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
  const targetRecipient = (config.testRecipientEmail || input.recipientEmail).trim();

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
https://www.site24x7.in/
  `.trim();

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  const { inReplyTo, headers: threadingHeaders } = buildThreadingHeaders(input.thread.id);

  if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);
      const res = await resend.emails.send({
        from: config.outboundFromEmail,
        to: targetRecipient,
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
            : "Unpriceable notification email queued in demo mode",
      },
    ],
  };

  store.saveDelivery(deliveryRecord);

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
