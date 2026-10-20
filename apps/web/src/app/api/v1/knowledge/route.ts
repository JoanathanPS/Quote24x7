import { type NextRequest, NextResponse } from "next/server";
import {
  listKnowledgeDocuments,
  ingestKnowledgeDocument,
  findDuplicateDocument,
} from "@/server/knowledge/service";
import { computeSha256 } from "@/server/knowledge/storage";
import type { KnowledgeCategory } from "@/types/domain";

const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "markdown"]);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    const documents = await listKnowledgeDocuments({ category, status, search });
    return NextResponse.json({ documents });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const category = (formData.get("category") as KnowledgeCategory) || "other";
    const versionStr = formData.get("version") as string | null;
    const allowDuplicate = formData.get("allowDuplicate") === "true";
    const uploadedBy = (formData.get("uploadedBy") as string) || "operator";

    if (!file) {
      return NextResponse.json({ error: "No file provided in form data." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File size exceeds the 50MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).` },
        { status: 400 }
      );
    }

    const filename = file.name;
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error: `File type '.${ext}' is not supported. Supported types: PDF, DOCX, XLSX, XLS, CSV, TXT, MD.`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Duplicate detection by sha256
    const sha256 = computeSha256(buffer);
    const existing = await findDuplicateDocument(sha256);

    if (existing && !allowDuplicate) {
      return NextResponse.json(
        {
          isDuplicate: true,
          existingDocument: existing,
          error: `Duplicate content detected: Document "${existing.name}" (ID: ${existing.id}) has identical SHA-256 hash.`,
        },
        { status: 409 }
      );
    }

    const version = versionStr ? parseInt(versionStr, 10) : 1;

    const result = await ingestKnowledgeDocument({
      filename,
      buffer,
      mimeType: file.type || "application/octet-stream",
      category,
      version: isNaN(version) ? 1 : version,
      uploadedBy,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
