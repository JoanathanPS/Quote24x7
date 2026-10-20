import { type NextRequest, NextResponse } from "next/server";
import {
  getKnowledgeDocument,
  deleteKnowledgeDocument,
  setDocumentStatus,
} from "@/server/knowledge/service";
import type { KnowledgeCategory, KnowledgeDocumentStatus } from "@/types/domain";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await getKnowledgeDocument(id);

    if (!result) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const success = await deleteKnowledgeDocument(id);

    if (!success) {
      return NextResponse.json({ error: "Failed to delete document or document not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Document deleted successfully." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body as {
      status?: KnowledgeDocumentStatus;
      category?: KnowledgeCategory;
    };

    if (status) {
      const updated = await setDocumentStatus(id, status);
      if (!updated) {
        return NextResponse.json({ error: "Document not found." }, { status: 404 });
      }
    }

    const doc = await getKnowledgeDocument(id);
    return NextResponse.json(doc);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
