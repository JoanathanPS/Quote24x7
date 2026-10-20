import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { renderQuotePdf } from "@/server/documents/pdf-renderer";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await store.ensureInitializedAsync();
  const { id } = await params;
  const quote = store.getQuote(id);
  if (!quote) {
    return NextResponse.json(
      { error: `Quote not found: ${id}` },
      { status: 404 },
    );
  }

  const thread = store.getThread(quote.threadId);
  const pdfBuffer = await renderQuotePdf({ quote, thread });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote_${id}.pdf"`,
    },
  });
}
