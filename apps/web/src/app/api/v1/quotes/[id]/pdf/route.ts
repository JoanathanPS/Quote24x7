import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { renderQuotePdf } from "@/server/documents/pdf-renderer";
import type { OptionType } from "@/types/domain";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
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

  const { searchParams } = new URL(request.url);
  const option = (searchParams.get("option") as OptionType) || "best_value";
  const isInline =
    searchParams.get("view") === "true" ||
    searchParams.get("inline") === "true" ||
    searchParams.get("download") === "false";

  const thread = quote.threadId ? store.getThread(quote.threadId) : undefined;

  try {
    const pdfBuffer = await renderQuotePdf({
      quote,
      thread,
      selectedOptionType: option,
    });

    const filename = `Quote24x7-Proposal-${quote.id}.pdf`;
    const disposition = isInline
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Content-Length": pdfBuffer.length.toString(),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to render PDF";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
