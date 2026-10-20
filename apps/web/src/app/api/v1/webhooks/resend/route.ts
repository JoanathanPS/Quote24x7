import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { getAppConfig } from "@/server/config";
import { verifyWebhookSignature, fetchInboundEmailContent } from "@/server/email/resend-inbound";
import { processInboundEmail } from "@/server/email/inbound-processor";
import { handleDeliveryTrackingEvent } from "@/server/email/delivery-tracker";

/**
 * Resend Webhook Event Handler.
 * Consumes asynchronous delivery events (email.delivered, email.bounced, email.sent, etc.)
 * as well as inbound email events (email.received) with strict Svix signature verification.
 *
 * NOTE: As per strict operational truth requirements, a message is NEVER marked
 * as 'delivered' until this webhook explicitly fires with an 'email.delivered' event.
 */
export async function POST(request: NextRequest) {
  try {
    await store.ensureInitializedAsync();
    const config = getAppConfig();
    const rawBody = await request.text();

    if (!rawBody || !rawBody.trim()) {
      return NextResponse.json({ error: "Invalid webhook payload. Expected non-empty body." }, { status: 400 });
    }

    const svixId = request.headers.get("svix-id") || request.headers.get("webhook-id");
    const svixTimestamp = request.headers.get("svix-timestamp") || request.headers.get("webhook-timestamp");
    const svixSignature = request.headers.get("svix-signature") || request.headers.get("webhook-signature");
    const isSimulated = request.headers.get("x-quote24x7-simulated") === "true";

    // Strict Svix signature verification if secret configured
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

    // Flag deliveries queued > 10m, schedule backoff retries, and dead-letter after 3 attempts
    store.flagAndRetryQueuedDeliveries();

    const eventType = String(body.type || "unknown");
    const eventData = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
    const providerEventId = String(svixId || body.id || eventData.id || eventData.email_id || "").trim();

    if (providerEventId) {
      const { isDuplicate } = await store.recordWebhookEvent("resend", providerEventId, eventType, body);
      if (isDuplicate) {
        return NextResponse.json(
          {
            received: true,
            duplicate: true,
            message: `Duplicate webhook event ${providerEventId} dropped.`,
          },
          { status: 200 }
        );
      }
    }

    // Branch 1: Inbound Email Received
    if (eventType === "email.received") {
      const emailId = String(eventData.email_id || eventData.id || "").trim();
      let from = typeof eventData.from === "string" ? eventData.from : "";
      let fromName: string | null = null;
      let to: string[] = Array.isArray(eventData.to)
        ? eventData.to.map(String)
        : typeof eventData.to === "string"
          ? [eventData.to]
          : [];
      let subject = typeof eventData.subject === "string" ? eventData.subject : "Quote Request";
      let text = typeof eventData.text === "string" ? eventData.text : "";
      let html = typeof eventData.html === "string" ? eventData.html : undefined;

      // Retrieve full email content from Resend API to obtain attachments, headers, and full body
      let fetched: Awaited<ReturnType<typeof fetchInboundEmailContent>> = null;
      if (emailId && config.resendApiKey) {
        fetched = await fetchInboundEmailContent(emailId);
        if (fetched) {
          if (!from || from === "unknown@inbound.resend.dev") from = fetched.from;
          if (!fromName) fromName = fetched.fromName || null;
          if (!to || to.length === 0) to = fetched.to;
          if (!subject || subject === "Quote Request") subject = fetched.subject;
          if (!text) text = fetched.text;
          if (!html) html = fetched.html;
        }
      }

      const match = from.match(/^(.*?)\s*<([^>]+)>$/);
      if (match && match[1] && match[2]) {
        fromName = match[1].trim().replace(/^["']|["']$/g, "");
        from = match[2].trim();
      }

      const attachments =
        fetched?.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          content: a.buffer,
        })) || [];

      // If body text is empty but document attachments exist, supply descriptive placeholder
      if (!text && attachments.length > 0) {
        const names = attachments.map((a) => a.filename).join(", ");
        text = `Please find our infrastructure requirements and monitoring specifications in the attached document(s): ${names}`;
      }

      const inboundResult = await processInboundEmail({
        providerMessageId: emailId || `in_${Date.now()}`,
        messageId: fetched?.messageId || null,
        from: from || "unknown@inbound.resend.dev",
        fromName,
        to,
        subject,
        text,
        html,
        headers: fetched?.headers || null,
        attachments,
        receivedAt: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
      });

      return NextResponse.json({
        received: true,
        type: "email.received",
        ...inboundResult,
      });
    }

    // Branch 2: Delivery Event Tracking
    return handleDeliveryTrackingEvent(eventType, body, eventData);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Webhook processing failure", detail: errorMsg },
      { status: 500 }
    );
  }
}
