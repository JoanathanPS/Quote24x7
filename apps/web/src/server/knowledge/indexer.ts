import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
// @ts-expect-error pdf-parse subpath import avoids the index.js debug execution bug
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface DraftChunk {
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  sourceMetadata: Record<string, unknown>;
}

export interface ExtractionResult {
  success: boolean;
  pageCount: number | null;
  chunks: DraftChunk[];
  ocrRequired?: boolean;
  error?: string;
}

const TARGET_CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

/**
 * Splits continuous text into chunks with overlap, attempting to break at paragraphs or newlines.
 */
function chunkContinuousText(
  fullText: string,
  basePageNumber: number | null = null,
  sectionTitle: string | null = null,
  metadata: Record<string, unknown> = {}
): DraftChunk[] {
  const cleanText = fullText.replace(/\r\n/g, "\n").trim();
  if (!cleanText) return [];

  const chunks: DraftChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + TARGET_CHUNK_SIZE;

    if (endIndex < cleanText.length) {
      // Find clean break (double newline, single newline, period, or space)
      const slice = cleanText.substring(startIndex, endIndex);
      const lastDoubleNewline = slice.lastIndexOf("\n\n");
      const lastNewline = slice.lastIndexOf("\n");
      const lastPeriod = slice.lastIndexOf(". ");

      if (lastDoubleNewline > TARGET_CHUNK_SIZE / 2) {
        endIndex = startIndex + lastDoubleNewline + 2;
      } else if (lastNewline > TARGET_CHUNK_SIZE / 2) {
        endIndex = startIndex + lastNewline + 1;
      } else if (lastPeriod > TARGET_CHUNK_SIZE / 2) {
        endIndex = startIndex + lastPeriod + 2;
      }
    } else {
      endIndex = cleanText.length;
    }

    const chunkContent = cleanText.substring(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        chunkIndex: chunkIndex++,
        content: chunkContent,
        pageNumber: basePageNumber,
        sectionTitle,
        sourceMetadata: {
          ...metadata,
          charStart: startIndex,
          charEnd: endIndex,
        },
      });
    }

    if (endIndex >= cleanText.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - CHUNK_OVERLAP);
  }

  return chunks;
}

/**
 * Extracts and chunks text from PDF buffer.
 */
async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  let pageCount: number | null = null;
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    pageCount = pdfDoc.getPageCount();
  } catch {
    // If pdf-lib fails to read header, pdfParse might still parse text
  }

  try {
    const parsed = await pdfParse(buffer);
    const parsedPageCount = parsed.numpages || pageCount || 1;
    const rawText = parsed.text || "";

    // Scanned or image-only PDF detection
    const nonWhitespaceCount = rawText.replace(/\s+/g, "").length;
    const isImageOnly = nonWhitespaceCount < 30 && (pageCount ?? 1) >= 1;

    if (isImageOnly) {
      return {
        success: true,
        pageCount: parsedPageCount,
        chunks: [],
        ocrRequired: true,
        error: "Document appears to be a scanned image-only PDF. Searchable text is empty.",
      };
    }

    // Split text into chunks
    const draftChunks = chunkContinuousText(rawText, null, null, {
      totalDocPages: parsedPageCount,
    });

    // Renumber chunks
    const chunks = draftChunks.map((c, i) => ({ ...c, chunkIndex: i }));

    return {
      success: true,
      pageCount: parsedPageCount,
      chunks,
      ocrRequired: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      pageCount,
      chunks: [],
      error: `Failed to extract text from PDF: ${msg}`,
    };
  }
}

/**
 * Extracts and chunks text from DOCX buffer using mammoth.
 */
async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const { value: rawText } = await mammoth.extractRawText({ buffer });
    if (!rawText || rawText.trim().length === 0) {
      return {
        success: false,
        pageCount: null,
        chunks: [],
        error: "DOCX document contains no readable text.",
      };
    }

    const draftChunks = chunkContinuousText(rawText, null, "DOCX Document Content");
    return {
      success: true,
      pageCount: null,
      chunks: draftChunks.map((c, i) => ({ ...c, chunkIndex: i })),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      pageCount: null,
      chunks: [],
      error: `Failed to extract DOCX: ${msg}`,
    };
  }
}

/**
 * Extracts and chunks spreadsheets (XLSX, XLS, CSV) into readable tabular markdown.
 */
function extractSpreadsheet(buffer: Buffer, _filename: string): ExtractionResult {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const chunks: DraftChunk[] = [];
    let chunkIndex = 0;

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      // Convert sheet to array of rows
      const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (!rows || rows.length === 0) continue;

      // Extract header row if present
      const rawHeader = rows[0] || [];
      const header = rawHeader.map((h) => String(h || "").trim()).filter(Boolean);

      // Build structured markdown blocks for groups of rows (e.g. 25 rows per chunk)
      const CHUNK_ROWS = 25;
      for (let r = 1; r < rows.length; r += CHUNK_ROWS) {
        const rowSlice = rows.slice(r, r + CHUNK_ROWS);
        const textLines: string[] = [];

        textLines.push(`Sheet: [${sheetName}] (Rows ${r} to ${Math.min(r + CHUNK_ROWS - 1, rows.length - 1)})`);
        if (header.length > 0) {
          textLines.push(`Columns: ${header.join(" | ")}`);
        }
        textLines.push("---");

        for (const row of rowSlice) {
          const cells = (row as unknown[]).map((c) => String(c ?? "").trim());
          if (cells.some((c) => c.length > 0)) {
            textLines.push(cells.join(" | "));
          }
        }

        const blockContent = textLines.join("\n");
        if (blockContent.length > 0) {
          chunks.push({
            chunkIndex: chunkIndex++,
            content: blockContent,
            pageNumber: null,
            sectionTitle: `Sheet: ${sheetName}`,
            sourceMetadata: {
              sheetName,
              startRow: r,
              endRow: Math.min(r + CHUNK_ROWS - 1, rows.length - 1),
            },
          });
        }
      }
    }

    if (chunks.length === 0) {
      return {
        success: false,
        pageCount: null,
        chunks: [],
        error: "Spreadsheet contains no readable rows.",
      };
    }

    return {
      success: true,
      pageCount: workbook.SheetNames.length,
      chunks,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      pageCount: null,
      chunks: [],
      error: `Failed to extract spreadsheet: ${msg}`,
    };
  }
}

/**
 * Extracts and chunks plain text or Markdown.
 */
function extractPlainText(buffer: Buffer): ExtractionResult {
  try {
    const text = buffer.toString("utf-8");
    if (!text.trim()) {
      return {
        success: false,
        pageCount: null,
        chunks: [],
        error: "Text document is empty.",
      };
    }

    const draftChunks = chunkContinuousText(text);
    return {
      success: true,
      pageCount: 1,
      chunks: draftChunks.map((c, i) => ({ ...c, chunkIndex: i })),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      pageCount: null,
      chunks: [],
      error: `Failed to decode plain text: ${msg}`,
    };
  }
}

/**
 * Master extraction entry point. Dispatches to format-specific extractors based on file extension and MIME type.
 */
export async function extractDocumentContent(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ExtractionResult> {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (ext === "pdf" || mimeType === "application/pdf") {
    return extractPdf(buffer);
  }

  if (
    ext === "docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(buffer);
  }

  if (
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv" ||
    mimeType.includes("spreadsheet") ||
    mimeType === "text/csv"
  ) {
    return extractSpreadsheet(buffer, filename);
  }

  if (
    ext === "txt" ||
    ext === "md" ||
    ext === "markdown" ||
    mimeType.startsWith("text/")
  ) {
    return extractPlainText(buffer);
  }

  // Fallback try plain text
  return extractPlainText(buffer);
}
