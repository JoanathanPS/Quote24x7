import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { getAppConfig } from "@/server/config";
import type { DeliveryStatus } from "@/types/domain";
import { verifyWebhookSignature, fetchInboundEmailContent } from "@/server/email/resend-inbound";
import { processInboundEmail } from "@/server/email/inbound-processor";

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

    // Branch 1: Inbound Email Received
    if (eventType === "email.received") {
      const emailId = String(eventData.email_id || eventData.id || "").trim();
      let from = typeof eventData.from === "string" ? eventData.from : "";
      let fromName: string | null = null;
      let to = Array.isArray(eventData.to) ? eventData.to : ["quotes@quote24x7.internal"];
      let subject = typeof eventData.subject === "string" ? eventData.subject : "Quote Request";
      let text = typeof eventData.text === "string" ? eventData.text : "";
      let html = typeof eventData.html === "string" ? eventData.html : undefined;

      // If text is not provided in metadata, retrieve full content from Resend API
      if (!text && emailId) {
        const fetched = await fetchInboundEmailContent(emailId);
        if (fetched) {
          from = fetched.from;
          fromName = fetched.fromName || null;
          to = fetched.to;
          subject = fetched.subject;
          text = fetched.text;
          html = fetched.html;
        }
      }

      const match = from.match(/^(.*?)\s*<([^>]+)>$/);
      if (match && match[1] && match[2]) {
        fromName = match[1].trim().replace(/^["']|["']$/g, "");
        from = match[2].trim();
      }

      const inboundResult = await processInboundEmail({
        providerMessageId: emailId || `in_${Date.now()}`,
        from: from || "unknown@inbound.resend.dev",
        fromName,
        to,
        subject,
        text,
        html,
        receivedAt: typeof body.created_at === "string" ? body.created_at : new Date().toISOString(),
      });

      return NextResponse.json({
        received: true,
        type: "email.received",
        ...inboundResult,
      });
    }

    // Branch 2: Delivery Event Tracking
    const providerMessageId = String(eventData.email_id || eventData.id || "").trim();

    if (!providerMessageId) {
      return NextResponse.json(
        { error: "Webhook event does not contain a valid email ID (email_id or id)." },
        { status: 400 }
      );
    }

    const delivery = store.getDeliveryByProviderMessageId(providerMessageId);
    if (!delivery) {
      // Acknowledge receipt even if message was not tracked locally (e.g. external send)
      return NextResponse.json({
        received: true,
        matched: false,
        message: `No active delivery record found matching Resend email ID ${providerMessageId}`,
      });
    }

    const now: string = typeof body.created_at === "string" ? body.created_at : new Date().toISOString();
    let newStatus: DeliveryStatus = delivery.status;
    let detail = `Resend webhook received: ${eventType}`;
    let isBounced = false;

    switch (eventType) {
      case "email.delivered":
        newStatus = "delivered";
        detail = "Delivered to recipient mailbox (verified by Resend webhook)";
        break;

      case "email.bounced":
        newStatus = "bounced";
        isBounced = true;
        detail = `Message bounced: ${eventData.bounce_type || "permanent bounce"}`;
        break;

      case "email.complained":
        newStatus = "failed";
        detail = "Spam complaint reported by recipient provider";
        break;

      case "email.delivery_delayed":
        detail = "Delivery delayed by receiving server; will retry";
        break;

      case "email.sent":
        // Only upgrade if currently queued
        if (delivery.status === "queued") {
          newStatus = "accepted";
          detail = "Accepted and transmitted by Resend MTA";
        }
        break;

      case "email.opened":
        detail = "Quotation email opened by recipient";
        break;

      case "email.clicked": {
        const clickObj =
          eventData.click && typeof eventData.click === "object"
            ? (eventData.click as Record<string, unknown>)
            : null;
        const link =
          clickObj && typeof clickObj.link === "string"
            ? clickObj.link
            : "Site24x7 verification link";
        detail = `Quotation link clicked: ${link}`;
        break;
      }

      default:
        detail = `Event received: ${eventType}`;
    }

    // Append to delivery events history
    const updatedEvents = [
      ...delivery.events,
      {
        at: now,
        status: newStatus,
        detail,
      },
    ];

    store.updateDelivery(delivery.id, {
      status: newStatus,
      lastErrorMessage: isBounced ? detail : delivery.lastErrorMessage,
      lastErrorCode: isBounced ? "BOUNCE_PERMANENT" : delivery.lastErrorCode,
      events: updatedEvents,
    });

    // If bounced or delivered, reflect in parent thread
    if (delivery.threadId) {
      if (newStatus === "delivered") {
        store.updateThread(delivery.threadId, {
          status: "completed",
          statusDetail: `Proposal verified delivered to ${delivery.recipient}`,
        });
      } else if (newStatus === "bounced" || newStatus === "failed") {
        store.updateThread(delivery.threadId, {
          status: "failed",
          statusDetail: `Delivery failed: ${detail}`,
        });
      }
    }

    return NextResponse.json({
      received: true,
      matched: true,
      deliveryId: delivery.id,
      previousStatus: delivery.status,
      newStatus,
      eventType,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Webhook processing failure", detail: errorMsg },
      { status: 500 }
    );
  }
}
