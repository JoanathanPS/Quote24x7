import { type NextRequest, NextResponse } from "next/server";
import {
  processInboundEmail,
  type InboundEmailPayload,
  type InboundAttachmentPayload,
} from "@/server/email/inbound-processor";
import { verifyWebhookSignature, fetchInboundEmailContent } from "@/server/email/resend-inbound";
import { getAppConfig } from "@/server/config";
import { store } from "@/server/store/session-store";

/**
 * Inbound Email Webhook & Multi-Format Ingestion API.
 * Accepts POST requests from email providers (e.g. Resend Inbound), internal simulators,
 * or direct multi-part form file uploads (Word .docx, PDF .pdf, Excel .xlsx/.csv).
 *
 * Supported formats:
 * - Plain text email inquiries
 * - Word documents (.docx, .doc)
 * - PDF documents (.pdf)
 * - Excel spreadsheets (.xlsx, .xls, .csv)
 */
export async function POST(request: NextRequest) {
  try {
    await store.ensureInitializedAsync();
    const config = getAppConfig();
    const contentTypeHeader = request.headers.get("content-type") || "";
    const isSimulated = request.headers.get("x-quote24x7-simulated") === "true";

    let from = "";
    let fromName: string | null = null;
    let to: string[] = [];
    let subject = "";
    let text = "";
    let html: string | undefined;
    let providerMessageId = "";
    let rfcMessageId: string | null = null;
    let headers: Record<string, string> | null = null;
    let receivedAt = new Date().toISOString();
    const attachments: InboundAttachmentPayload[] = [];

    // -------------------------------------------------------------------------
    // A. Multi-part form data (File uploads from UI: Word, PDF, Excel)
    // -------------------------------------------------------------------------
    if (contentTypeHeader.includes("multipart/form-data")) {
      const formData = await request.formData();

      from = (formData.get("from") as string) || "operator.inbound@company.example.com";
      fromName = (formData.get("fromName") as string) || null;
      subject = (formData.get("subject") as string) || "Quote Request with Document Specification";
      text = (formData.get("text") as string) || "";
      const toVal = formData.get("to");
      if (typeof toVal === "string" && toVal.trim()) {
        to = [toVal.trim()];
      } else {
        to = [];
      }

      // Collect file attachments
      const allFiles: File[] = [];
      const fileKeys = ["file", "files", "attachment", "attachments", "document", "spreadsheet"];
      for (const key of fileKeys) {
        const entries = formData.getAll(key);
        for (const entry of entries) {
          if (entry instanceof File && entry.size > 0) {
            allFiles.push(entry);
          }
        }
      }

      for (const file of allFiles) {
        const arrayBuf = await file.arrayBuffer();
        attachments.push({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          content: Buffer.from(arrayBuf),
          sizeBytes: file.size,
        });
      }

      providerMessageId = `inbound_upload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    } else {
      // -----------------------------------------------------------------------
      // B. JSON Body (Resend Webhook or JSON API with base64 / text attachments)
      // -----------------------------------------------------------------------
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
          if (fetched.attachments && fetched.attachments.length > 0) {
            attachments.push(...fetched.attachments);
          }
        }
      }

      // Handle "from"
      if (!from && typeof eventData.from === "string") {
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

      // Handle "to"
      if (!to || to.length === 0) {
        if (Array.isArray(eventData.to)) {
          to = eventData.to.map((addr: unknown) => String(addr).trim());
        } else if (typeof eventData.to === "string") {
          to = [eventData.to.trim()];
        } else {
          to = ["quotes@quote24x7.internal"];
        }
      }

      // Handle subject & body
      if (!subject) {
        subject = typeof eventData.subject === "string" ? eventData.subject.trim() : "Quote Request";
      }
      if (!text) {
        text = typeof eventData.text === "string" ? eventData.text : "";
      }
      html = typeof eventData.html === "string" ? eventData.html : undefined;

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

      if (typeof eventData.receivedAt === "string") {
        receivedAt = eventData.receivedAt;
      } else if (typeof eventData.created_at === "string") {
        receivedAt = eventData.created_at;
      }

      // Extract JSON attachments if present
      if (Array.isArray(eventData.attachments)) {
        for (const item of eventData.attachments as Array<Record<string, unknown>>) {
          if (typeof item.filename === "string") {
            attachments.push({
              filename: item.filename,
              contentType: typeof item.contentType === "string" ? item.contentType : undefined,
              content: typeof item.content === "string" ? item.content : undefined,
              sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : undefined,
            });
          }
        }
      }
    }

    if (!from) {
      return NextResponse.json(
        { error: "Missing required 'from' email address in payload." },
        { status: 400 }
      );
    }

    // If body text is empty but document attachments exist, supply descriptive placeholder
    if (!text && attachments.length > 0) {
      const names = attachments.map((a) => a.filename).join(", ");
      text = `Please find our infrastructure requirements and monitoring specifications in the attached document(s): ${names}`;
    }

    if (!text && !subject) {
      return NextResponse.json(
        { error: "Email body text, subject, or attached documents must be provided." },
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
      receivedAt,
      attachments,
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
