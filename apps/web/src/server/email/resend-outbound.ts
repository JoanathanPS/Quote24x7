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

  // Plain Text Version
  const textContent = `
Dear ${input.recipientName || "Valued Customer"},

Thank you for your interest in Site24x7. Based on your stated monitoring requirements, our pricing engine has calculated the following pricing options for your infrastructure:

RECOMMENDED OPTION (Best Value):
- Plan: ${bestValue?.planName ?? "Recommended Plan"}
- Total (${input.quote.billingPeriod}): ${bestValue ? formatMoney(bestValue.total, input.quote.currency) : "—"}
- Selection Note: ${bestValue?.rankReason ?? ""}

${lowestCost ? `LOWEST COMMITMENT OPTION:\n- Plan: ${lowestCost.planName}\n- Total (${input.quote.billingPeriod}): ${formatMoney(lowestCost.total, input.quote.currency)}\n` : ""}
${bestCoverage ? `MAXIMUM HEADROOM OPTION:\n- Plan: ${bestCoverage.planName}\n- Total (${input.quote.billingPeriod}): ${formatMoney(bestCoverage.total, input.quote.currency)}\n` : ""}

Please review the attached PDF quotation ("Quote24x7-Proposal-${input.quote.id}.pdf") for a comprehensive line-item breakdown, included allowances, and capacity fulfillment.

Reference Thread: #${input.thread.id} | Proposal Reference: #${input.quote.id}

IMPORTANT NOTICE:
This quotation is an automated preliminary estimate calculated from publicly verifiable Site24x7 pricing data. It is provided for planning and budgeting purposes and is not a legally binding offer by Zoho Corporation.

For official verification and procurement, please visit https://www.site24x7.in/

Warm regards,
Quote24x7 Automated Operations Team
  `.trim();

  // Responsive HTML Version
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1e; margin: 0; padding: 24px; background-color: #f7f7f9; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e4e8; padding: 32px; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0; }
    .ref { font-size: 12px; color: #6b7280; font-family: monospace; margin-top: 4px; }
    .option-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin: 16px 0; }
    .option-card.highlight { background: #eff6ff; border-color: #93c5fd; }
    .option-title { font-size: 14px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px; }
    .plan-name { font-size: 18px; font-weight: 700; color: #0f172a; margin: 4px 0; }
    .price { font-size: 22px; font-weight: 800; color: #2563eb; font-family: monospace; }
    .note { font-size: 13px; color: #475569; margin-top: 8px; }
    .disclaimer { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px; font-size: 12px; color: #92400e; margin-top: 24px; }
    .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">Quote24x7 Infrastructure Monitoring Quotation</h1>
      <div class="ref">Quotation Reference #${input.quote.id}  •  Billing: ${input.quote.billingPeriod}</div>
    </div>

    <p>Dear ${input.recipientName || "Valued Customer"},</p>
    <p>Thank you for inquiring about Site24x7 monitoring. Based on your stated infrastructure requirements, our pricing engine has calculated the following pricing options for your review:</p>

    <div class="option-card highlight">
      <div class="option-title">Recommended Option (Best Value)</div>
      <div class="plan-name">${bestValue?.planName ?? "Recommended Plan"}</div>
      <div class="price">${bestValue ? formatMoney(bestValue.total, input.quote.currency) : "—"}</div>
      <div class="note">${bestValue?.rankReason ?? ""}</div>
    </div>

    ${
      lowestCost
        ? `
    <div class="option-card">
      <div class="option-title">Lowest Commitment Option</div>
      <div class="plan-name">${lowestCost.planName}</div>
      <div class="price">${formatMoney(lowestCost.total, input.quote.currency)}</div>
      <div class="note">${lowestCost.rankReason}</div>
    </div>`
        : ""
    }

    ${
      bestCoverage
        ? `
    <div class="option-card">
      <div class="option-title">Maximum Headroom Option</div>
      <div class="plan-name">${bestCoverage.planName}</div>
      <div class="price">${formatMoney(bestCoverage.total, input.quote.currency)}</div>
      <div class="note">${bestCoverage.headroomNotes?.[0] || bestCoverage.rankReason}</div>
    </div>`
        : ""
    }

    <p>Please find the official proposal attached as <strong>Quote24x7-Proposal-${input.quote.id}.pdf</strong>, which details the itemized line items, allowances, and workload coverage matrix.</p>

    <div class="disclaimer">
      <strong>Non-Binding Notice:</strong> This quotation is an automated preliminary estimate calculated from publicly verifiable Site24x7 pricing data. It is generated for budgeting assistance only and does not constitute an official offer by Zoho Corporation.
    </div>

    <div class="footer">
      Official Site24x7 Procurement: <a href="https://www.site24x7.in/">https://www.site24x7.in/</a><br>
      Automated operations powered by Quote24x7 Engine v1.0.0.
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
            ? `Dispatched via Resend API (messageId: ${providerMessageId})`
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
    fromName: "Quote24x7 Automated Operations Team",
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
  const subject = `Re: ${cleanSubject} [Ref: #${input.thread.id}] - Sizing Information Needed`;

  const textContent = `
Dear ${input.recipientName || "Valued Customer"},

Thank you for reaching out to Quote24x7 regarding Site24x7 monitoring.

To ensure our pricing engine selects the most cost-effective plan and accurately calculates any necessary add-on packs, could you please clarify:

${input.questionText}

Reference: #${input.thread.id}

As soon as you reply with these details, we will immediately generate a full quotation with side-by-side plan comparisons and an official proposal PDF.

Warm regards,
Quote24x7 Automated Operations Team
https://www.site24x7.in/
  `.trim();

  let providerMessageId: string | null = null;
  let status: "accepted" | "failed" = "accepted";
  let mode: "live" | "dry_run" = "dry_run";
  let errorMessage: string | undefined;

  if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);
      const res = await resend.emails.send({
        from: config.outboundFromEmail,
        to: targetRecipient,
        subject,
        text: textContent,
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
            ? `Clarification dispatched via Resend (messageId: ${providerMessageId})`
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
    fromName: "Quote24x7 Automated Operations Team",
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

  if (config.isLiveDispatchEnabled && config.resendApiKey) {
    try {
      const resend = new Resend(config.resendApiKey);
      const res = await resend.emails.send({
        from: config.outboundFromEmail,
        to: targetRecipient,
        subject,
        text: textContent,
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
            ? `Unpriceable notification dispatched via Resend (messageId: ${providerMessageId})`
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
