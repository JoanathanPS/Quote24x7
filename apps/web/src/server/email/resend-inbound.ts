import { Resend } from "resend";
import { getAppConfig } from "../config.ts";

export interface WebhookHeaders {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
}

export interface WebhookVerificationResult {
  valid: boolean;
  event?: unknown;
  error?: string;
}

/**
 * Cryptographically verifies incoming Resend webhook events using Svix headers.
 * If RESEND_WEBHOOK_SECRET is configured, any unverified or tampered payload is rejected.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders
): WebhookVerificationResult {
  const config = getAppConfig();
  const secret = config.resendWebhookSecret;

  if (!secret) {
    // Secret is not configured: in dev/test environment, return true with parsed JSON
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      return { valid: true, event: parsed };
    } catch {
      return { valid: false, error: "Invalid JSON body" };
    }
  }

  const id = headers.id?.trim();
  const timestamp = headers.timestamp?.trim();
  const signature = headers.signature?.trim();

  if (!id || !timestamp || !signature) {
    return {
      valid: false,
      error: "Missing required Svix webhook headers (id, timestamp, or signature).",
    };
  }

  try {
    const resend = new Resend(config.resendApiKey || "re_dummy");
    const verified = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id,
        timestamp,
        signature,
      },
      webhookSecret: secret,
    });
    return { valid: true, event: verified };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Webhook signature verification failed: ${message}` };
  }
}

export interface RetrievedInboundEmail {
  id: string;
  messageId?: string | null;
  from: string;
  fromName?: string | null;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string> | null;
  receivedAt?: string;
}

/**
 * Retrieves the complete content (text, HTML, headers) for a Resend inbound email ID.
 * Resend inbound webhooks send metadata only; this call fetches the full body.
 */
export async function fetchInboundEmailContent(
  emailId: string
): Promise<RetrievedInboundEmail | null> {
  const config = getAppConfig();

  if (!config.resendApiKey) {
    console.warn("Cannot fetch inbound email content: RESEND_API_KEY is not configured.");
    return null;
  }

  try {
    const resend = new Resend(config.resendApiKey);
    const { data, error } = await resend.emails.receiving.get(emailId);

    if (error || !data) {
      console.error(`Failed to retrieve inbound email content for ${emailId}:`, error);
      return null;
    }

    let fromAddress = data.from;
    let fromName: string | null = null;
    const match = data.from?.match(/^(.*?)\s*<([^>]+)>$/);
    if (match && match[1] && match[2]) {
      fromName = match[1].trim().replace(/^["']|["']$/g, "");
      fromAddress = match[2].trim();
    }

    const toAddresses = Array.isArray(data.to)
      ? data.to.map(String)
      : data.to
        ? [String(data.to)]
        : [];

    const textContent =
      data.text ||
      (data.html ? data.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

    const rfcMessageId =
      data.message_id ||
      data.headers?.["message-id"] ||
      `<${data.id}@resend.dev>`;

    return {
      id: data.id,
      messageId: rfcMessageId,
      from: fromAddress,
      fromName,
      to: toAddresses,
      subject: data.subject || "Quote Request",
      text: textContent,
      html: data.html || undefined,
      headers: data.headers || null,
      receivedAt: data.created_at || new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Exception while fetching inbound email ${emailId}:`, err);
    return null;
  }
}
