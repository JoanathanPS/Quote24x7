import { type NextRequest, NextResponse } from "next/server";
import { reprocessKnowledgeDocument } from "@/server/knowledge/service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await reprocessKnowledgeDocument(id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to reprocess document." },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
