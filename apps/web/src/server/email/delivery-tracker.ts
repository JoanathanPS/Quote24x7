import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import type { DeliveryStatus } from "@/types/domain";
import {
  upsertMessageIdAliasToSupabase,
  updateMessageRfcIdInSupabase,
} from "@/server/db/supabase";
import { normalizeRfcMessageId } from "./rfc-message-id";

/**
 * Handles Resend delivery webhook events (email.delivered, email.bounced, email.sent, etc.)
 * Updates both the DeliveryRecord and the associated EmailThread.
 */
export function handleDeliveryTrackingEvent(
  eventType: string,
  body: Record<string, unknown>,
  eventData: Record<string, unknown>
): NextResponse {
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

  // Idempotent persistence of Resend's real RFC Message-ID (and any client-echoed
  // alias we want to register) on every status event, not just email.sent.
  // Doing it here means the durable record lands as soon as Resend tells us,
  // independent of whether the post-send GET /emails/:id call also succeeded.
  const rfcMessageIdRaw = typeof eventData.message_id === "string" ? eventData.message_id : null;
  const rfcMessageId = rfcMessageIdRaw ? normalizeRfcMessageId(rfcMessageIdRaw) : null;
  if (providerMessageId && rfcMessageId) {
    store.bindMessageIdToProviderId(rfcMessageId, providerMessageId, delivery.threadId);
    updateMessageRfcIdInSupabase({
      providerMessageId,
      rfcMessageId,
      threadId: delivery.threadId,
    }).catch((err) => console.warn(`[email.sent] could not persist rfc id:`, err));
    upsertMessageIdAliasToSupabase({
      aliasMessageId: rfcMessageId,
      canonicalMessageId: rfcMessageId,
      threadId: delivery.threadId,
      source: "auto",
    }).catch((err) => console.warn(`[email.sent] could not upsert alias:`, err));
  }

  return NextResponse.json({
    received: true,
    matched: true,
    deliveryId: delivery.id,
    previousStatus: delivery.status,
    newStatus,
    eventType,
  });
}
