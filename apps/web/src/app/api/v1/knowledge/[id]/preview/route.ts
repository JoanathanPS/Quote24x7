import { type NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { getKnowledgeDocument } from "@/server/knowledge/service";
import { downloadFromStorage } from "@/server/knowledge/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const docData = await getKnowledgeDocument(id);

    if (!docData) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    const { document, chunks } = docData;
    const buffer = await downloadFromStorage(document.storagePath);

    if (!buffer) {
      return NextResponse.json(
        { error: "Could not retrieve document file from storage." },
        { status: 404 }
      );
    }

    const ext = document.fileExtension.toLowerCase();

    // 1. PDF
    if (ext === "pdf" || document.mimeType === "application/pdf") {
      return NextResponse.json({
        type: "pdf",
        name: document.name,
        pageCount: document.pageCount,
        rawUrl: `/api/v1/knowledge/${document.id}/raw`,
        chunks,
      });
    }

    // 2. DOCX
    if (
      ext === "docx" ||
      document.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      try {
        const { value: html } = await mammoth.convertToHtml({ buffer });
        return NextResponse.json({
          type: "docx",
          name: document.name,
          html: html || "<p><em>Document contains no readable text.</em></p>",
          chunks,
        });
      } catch (err) {
        return NextResponse.json({
          type: "docx",
          name: document.name,
          html: `<p class="text-danger">Failed to render DOCX layout: ${String(err)}</p>`,
          chunks,
        });
      }
    }

    // 3. Spreadsheet (XLSX, XLS, CSV)
    if (
      ext === "xlsx" ||
      ext === "xls" ||
      ext === "csv" ||
      document.mimeType.includes("spreadsheet") ||
      document.mimeType === "text/csv"
    ) {
      try {
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheets = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) return { name: sheetName, headers: [], rows: [] };
          const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          const rawHeaders = (rawRows[0] || []).map((h) => String(h ?? "").trim());
          const rows = rawRows.slice(1).map((r) =>
            (r || []).map((c) => String(c ?? "").trim())
          );
          return {
            name: sheetName,
            headers: rawHeaders,
            rows,
          };
        });

        return NextResponse.json({
          type: "spreadsheet",
          name: document.name,
          sheets,
          chunks,
        });
      } catch (err) {
        return NextResponse.json({
          type: "error",
          name: document.name,
          error: `Failed to parse spreadsheet: ${String(err)}`,
          chunks,
        });
      }
    }

    // 4. Plain Text or Markdown
    if (ext === "txt" || ext === "md" || ext === "markdown" || document.mimeType.startsWith("text/")) {
      const text = buffer.toString("utf-8");
      return NextResponse.json({
        type: ext === "md" || ext === "markdown" ? "markdown" : "text",
        name: document.name,
        content: text,
        chunks,
      });
    }

    // 5. Fallback
    return NextResponse.json({
      type: "unsupported",
      name: document.name,
      mimeType: document.mimeType,
      error: `File format '.${ext}' does not support inline preview.`,
      rawUrl: `/api/v1/knowledge/${document.id}/raw?download=true`,
      chunks,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
