import { type NextRequest, NextResponse } from "next/server";
import { getKnowledgeDocument } from "@/server/knowledge/service";
import { downloadFromStorage } from "@/server/knowledge/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const docData = await getKnowledgeDocument(id);

    if (!docData) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const { document } = docData;
    const buffer = await downloadFromStorage(document.storagePath);

    if (!buffer) {
      return NextResponse.json(
        { error: "Could not retrieve document binary file from storage." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const isDownload = searchParams.get("download") === "true";

    const disposition = isDownload
      ? `attachment; filename="${encodeURIComponent(document.name)}"`
      : `inline; filename="${encodeURIComponent(document.name)}"`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": document.mimeType || "application/octet-stream",
        "Content-Length": buffer.length.toString(),
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
