import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { renderQuoteEmail, renderClarificationEmail, runPreSendChecks } from "@/server/email/resend-outbound";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const threadId = searchParams.get("threadId");
  const type = searchParams.get("type") || "quote";

  if (!threadId) {
    return NextResponse.json({ error: "threadId is required" }, { status: 400 });
  }

  await store.ensureInitializedAsync();
  const thread = store.getThread(threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  if (type === "clarification") {
    const questions = searchParams.get("questions") || "How many servers?";
    const rendered = renderClarificationEmail({
      recipientName: thread.senderName,
      questionText: questions,
      threadId: thread.id,
    });
    const check = runPreSendChecks(rendered.textContent + "\n" + rendered.htmlContent);
    return NextResponse.json({
      type: "clarification",
      threadId,
      wordCount: rendered.wordCount,
      preSendCheck: check,
      text: rendered.textContent,
      html: rendered.htmlContent,
    });
  }

  const quoteId = thread.quoteId;
  if (!quoteId) {
    return NextResponse.json({ error: "No quote associated with this thread" }, { status: 404 });
  }

  const quote = store.getQuote(quoteId);
  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const rendered = renderQuoteEmail({
    recipientName: thread.senderName,
    quote,
    threadId: thread.id,
  });
  const check = runPreSendChecks(rendered.textContent + "\n" + rendered.htmlContent, { isQuoteEmail: true });
  return NextResponse.json({
    type: "quote",
    threadId,
    quoteId,
    preSendCheck: check,
    text: rendered.textContent,
    html: rendered.htmlContent,
  });
}
