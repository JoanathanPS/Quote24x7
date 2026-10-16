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

export interface RetrievedAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
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
  attachments?: RetrievedAttachment[];
}

/**
 * Retrieves the complete content (text, HTML, headers, and attachments) for a Resend inbound email ID.
 * Resend inbound webhooks send metadata only; this call fetches the full body and downloads any attachments.
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

    // Fetch and download any email attachments from signed download URLs
    const fetchedAttachments: RetrievedAttachment[] = [];
    try {
      const attListRes = await resend.emails.receiving.attachments.list({ emailId });
      const rawData = attListRes.data;
      const attItems: Array<{ id?: string; filename?: string; content_type?: string; size?: number; download_url?: string }> =
        Array.isArray(rawData)
          ? rawData
          : rawData && typeof rawData === "object" && "data" in rawData && Array.isArray((rawData as { data: unknown }).data)
            ? ((rawData as { data: unknown[] }).data as Array<{ id?: string; filename?: string; content_type?: string; size?: number; download_url?: string }>)
            : [];
      for (const item of attItems) {
        if (item.download_url) {
          try {
            const fileRes = await fetch(item.download_url, { signal: AbortSignal.timeout(10_000) });
            if (fileRes.ok) {
              const arrayBuf = await fileRes.arrayBuffer();
              fetchedAttachments.push({
                filename: item.filename || `attachment_${item.id}`,
                contentType: item.content_type || "application/octet-stream",
                sizeBytes: item.size || arrayBuf.byteLength,
                buffer: Buffer.from(arrayBuf),
              });
            }
          } catch (fileErr) {
            console.error(`Failed to download attachment ${item.id} (${item.filename}):`, fileErr);
          }
        }
      }
    } catch (attErr) {
      console.warn(`Could not list attachments for inbound email ${emailId}:`, attErr);
    }

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
      attachments: fetchedAttachments,
    };
  } catch (err) {
    console.error(`Exception while fetching inbound email ${emailId}:`, err);
    return null;
  }
}

