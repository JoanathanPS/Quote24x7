import { type NextRequest, NextResponse } from "next/server";
import { processInboundEmail, type InboundEmailPayload } from "@/server/email/inbound-processor";
import { verifyWebhookSignature, fetchInboundEmailContent } from "@/server/email/resend-inbound";
import { getAppConfig } from "@/server/config";
import { store } from "@/server/store/session-store";

/**
 * Inbound Email Webhook & Simulator API.
 * Accepts POST requests from email providers (e.g. Resend Inbound) or internal test simulators.
 *
 * Normalizes input format and executes:
 * 1. Webhook signature verification (Svix) when configured
 * 2. Inbound email content retrieval (when only email_id is received)
 * 3. Idempotency & loop protection check
 * 4. Deterministic requirement extraction & gap detection (with multi-turn merging)
 * 5. Exact pricing engine calculation (when complete) or clarification inquiry (when missing fields)
 * 6. Vector PDF quotation rendering
 * 7. Outbound transmission via Resend
 */
export async function POST(request: NextRequest) {
  try {
    const config = getAppConfig();
    const rawBody = await request.text();

    if (!rawBody || !rawBody.trim()) {
      return NextResponse.json(
        { error: "Invalid payload. Expected non-empty request body." },
        { status: 400 }
      );
    }

    const svixId = request.headers.get("svix-id") || request.headers.get("webhook-id");
    const svixTimestamp = request.headers.get("svix-timestamp") || request.headers.get("webhook-timestamp");
    const svixSignature = request.headers.get("svix-signature") || request.headers.get("webhook-signature");
    const isSimulated = request.headers.get("x-quote24x7-simulated") === "true";

    // Verify webhook signature if RESEND_WEBHOOK_SECRET is set and not marked internal simulated
    if (config.resendWebhookSecret && !isSimulated) {
      const verification = verifyWebhookSignature(rawBody, {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      });

      if (!verification.valid) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid or missing webhook signature.", detail: verification.error },
          { status: 401 }
        );
      }
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    // Support both direct simulator payload and Resend Inbound webhook format
    let from = "";
    let fromName: string | null = null;
    let to: string[] = [];
    let subject = "";
    let text = "";
    let providerMessageId = "";
    let rfcMessageId: string | null = null;
    let headers: Record<string, string> | null = null;

    // Resend Inbound webhook format: { type: "email.received", data: { ... } } or { data: { ... } }
    const eventData = (body.data && typeof body.data === "object") ? (body.data as Record<string, unknown>) : body;

    // Early idempotency check for Resend email_id before fetching full email content
    if (typeof eventData.email_id === "string" && store.isMessageProcessed(eventData.email_id.trim())) {
      return NextResponse.json({
        status: "processed",
        duplicate: true,
        actionTaken: "dropped_loop",
        message: `Message with ID "${eventData.email_id}" was already processed. Replay discarded.`,
      });
    }

    // If metadata-only email.received event (typical for Resend Inbound), fetch full email content
    if (body.type === "email.received" && typeof eventData.email_id === "string" && !eventData.text) {
      const fetched = await fetchInboundEmailContent(eventData.email_id);
      if (fetched) {
        from = fetched.from;
        fromName = fetched.fromName || null;
        to = fetched.to;
        subject = fetched.subject;
        text = fetched.text;
        providerMessageId = fetched.id;
        rfcMessageId = fetched.messageId || null;
        headers = fetched.headers || null;
      }
    }

    // Handle "from" if not already populated from fetchInboundEmailContent
    if (!from && typeof eventData.from === "string") {
      // Could be "Name <email@example.com>" or "email@example.com"
      const match = eventData.from.match(/^(.*?)\s*<([^>]+)>$/);
      if (match && match[1] && match[2]) {
        fromName = match[1].trim().replace(/^["']|["']$/g, "");
        from = match[2].trim();
      } else {
        from = eventData.from.trim();
      }
    }

    if (!fromName && eventData.fromName && typeof eventData.fromName === "string") {
      fromName = eventData.fromName.trim();
    }

    // Handle "to" if not already populated from fetchInboundEmailContent
    if (!to || to.length === 0) {
      if (Array.isArray(eventData.to)) {
        to = eventData.to.map((addr: unknown) => String(addr).trim());
      } else if (typeof eventData.to === "string") {
        to = [eventData.to.trim()];
      } else {
        to = ["quotes@quote24x7.internal"];
      }
    }

    // Handle subject & body if not already populated from fetchInboundEmailContent
    if (!subject) {
      subject = typeof eventData.subject === "string" ? eventData.subject.trim() : "Quote Request";
    }
    if (!text) {
      text = typeof eventData.text === "string" ? eventData.text : "";
    }
    const html = typeof eventData.html === "string" ? eventData.html : undefined;

    // If text is empty but html is provided, strip html tags for text
    if (!text && html) {
      text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }

    // Handle message identifier
    if (typeof eventData.providerMessageId === "string") {
      providerMessageId = eventData.providerMessageId.trim();
    } else if (typeof eventData.id === "string") {
      providerMessageId = eventData.id.trim();
    } else if (typeof eventData.email_id === "string") {
      providerMessageId = eventData.email_id.trim();
    } else {
      providerMessageId = `sim_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    if (!rfcMessageId && typeof eventData.message_id === "string") {
      rfcMessageId = eventData.message_id.trim();
    }
    if (!headers && eventData.headers && typeof eventData.headers === "object") {
      headers = eventData.headers as Record<string, string>;
    }

    if (!from) {
      return NextResponse.json(
        { error: "Missing required 'from' email address in payload." },
        { status: 400 }
      );
    }

    if (!text && !subject) {
      return NextResponse.json(
        { error: "Email body text or subject must be provided." },
        { status: 400 }
      );
    }

    const payload: InboundEmailPayload = {
      providerMessageId,
      messageId: rfcMessageId,
      from,
      fromName,
      to,
      subject,
      text,
      html,
      headers,
      receivedAt:
        typeof eventData.receivedAt === "string"
          ? eventData.receivedAt
          : typeof eventData.created_at === "string"
          ? eventData.created_at
          : new Date().toISOString(),
    };

    const result = await processInboundEmail(payload);

    return NextResponse.json({
      status: "processed",
      ...result,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Failed to process inbound email",
        detail: errorMsg,
      },
      { status: 500 }
    );
  }
}
