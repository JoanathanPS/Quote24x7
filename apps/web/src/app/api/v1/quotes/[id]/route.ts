import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

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

  return NextResponse.json(quote);
}
