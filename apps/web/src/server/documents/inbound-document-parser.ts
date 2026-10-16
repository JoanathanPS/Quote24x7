import zlib from "node:zlib";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
// @ts-expect-error pdf-parse subpath import avoids the index.js debug execution bug
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { DocumentFormatKind } from "@/types/domain";

export interface ParsedInboundDocument {
  filename: string;
  contentType: string;
  sizeBytes: number;
  documentKind: DocumentFormatKind;
  text: string;
  metadata: {
    pageCount?: number;
    sheetNames?: string[];
    wordCount?: number;
    parsedAt: string;
  };
}

export interface ParseDocumentOptions {
  filename: string;
  contentType?: string;
  buffer: Buffer;
}

/**
 * Detects the document kind from filename and MIME type.
 */
export function detectDocumentKind(filename: string, contentType?: string): DocumentFormatKind {
  const lowerName = (filename || "").toLowerCase();
  const lowerType = (contentType || "").toLowerCase();

  if (lowerName.endsWith(".pdf") || lowerType.includes("pdf")) {
    return "pdf";
  }

  if (
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerType.includes("word") ||
    lowerType.includes("officedocument.wordprocessingml")
  ) {
    return "word";
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".csv") ||
    lowerType.includes("spreadsheet") ||
    lowerType.includes("excel") ||
    lowerType.includes("text/csv")
  ) {
    return "excel";
  }

  if (lowerName.endsWith(".txt") || lowerType.includes("text/plain")) {
    return "text";
  }

  return "other";
}

/**
 * Fallback scanner for extracting readable text runs from raw binary buffers.
 */
function extractAsciiStrings(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const matches = raw.match(/[\x20-\x7E]{4,}/g) || [];
  return matches.join(" ").replace(/\s+/g, " ").trim();
}

function decodePdfHexString(hex: string): string {
  try {
    const normalized = hex.length % 2 !== 0 ? hex + "0" : hex;
    return Buffer.from(normalized, "hex").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Decompresses and extracts readable text directly from PDF flate and text streams.
 * Supports both literal text (Tj) and hex-encoded font vectors (<...> Tj / TJ).
 */
function extractPdfStreamText(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const texts: string[] = [];

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(content)) !== null) {
    const rawData = match[1];
    if (!rawData) continue;
    const streamData = Buffer.from(rawData, "latin1");

    let decompressed = "";
    try {
      decompressed = zlib.inflateSync(streamData).toString("latin1");
    } catch {
      try {
        decompressed = zlib.inflateRawSync(streamData).toString("latin1");
      } catch {
        decompressed = streamData.toString("latin1");
      }
    }

    if (decompressed) {
      // 1. Literal strings: (Text) Tj
      const tjMatches = decompressed.match(/\((.*?)\)\s*Tj/g) || [];
      for (const tj of tjMatches) {
        const clean = tj.replace(/^\(|\)\s*Tj$/g, "");
        if (clean.trim()) texts.push(clean);
      }

      // 2. Hex-encoded strings: <3235...> Tj
      const hexTjMatches = decompressed.match(/<([0-9a-fA-F]+)>\s*Tj/g) || [];
      for (const htj of hexTjMatches) {
        const hex = htj.replace(/[<>\s]|Tj/g, "");
        const decoded = decodePdfHexString(hex);
        if (decoded.trim()) texts.push(decoded.trim());
      }

      // 3. Array text: [(Text) 20 <Hex>] TJ
      const arrayTjMatches = decompressed.match(/\[(.*?)\]\s*TJ/g) || [];
      for (const atj of arrayTjMatches) {
        const inside = atj.slice(1, atj.lastIndexOf("]"));
        const tokens = inside.match(/\(.*?\)|<[0-9a-fA-F]+>/g) || [];
        const lineParts: string[] = [];
        for (const token of tokens) {
          if (token.startsWith("(")) {
            lineParts.push(token.slice(1, -1));
          } else if (token.startsWith("<")) {
            lineParts.push(decodePdfHexString(token.slice(1, -1)));
          }
        }
        const combined = lineParts.join("").trim();
        if (combined) texts.push(combined);
      }
    }
  }

  if (texts.length > 0) {
    return texts.join("\n").replace(/[^\x20-\x7E\n]/g, " ").replace(/ +/g, " ").trim();
  }

  return extractAsciiStrings(buffer);
}

/**
 * Extracts plain text and structured content from PDF, Word (.docx/.doc),
 * and Excel (.xlsx/.xls/.csv) attachments.
 */
export async function parseInboundDocument(
  options: ParseDocumentOptions
): Promise<ParsedInboundDocument> {
  const { filename, contentType = "application/octet-stream", buffer } = options;
  const kind = detectDocumentKind(filename, contentType);
  const sizeBytes = buffer.length;
  const now = new Date().toISOString();

  let text = "";
  const metadata: ParsedInboundDocument["metadata"] = { parsedAt: now };

  try {
    switch (kind) {
      case "pdf": {
        let pdfText = "";
        try {
          const parser =
            typeof pdfParse === "function"
              ? pdfParse
              : (pdfParse as unknown as { default: typeof pdfParse }).default;

          const data = await parser(buffer);
          if (data && data.text && data.text.trim()) {
            pdfText = data.text.replace(/\r\n/g, "\n").trim();
            metadata.pageCount = data.numpages || 1;
          }
        } catch {
          // pdf-parse threw or could not decompress; fallback to native stream extraction
        }

        if (!pdfText) {
          pdfText = extractPdfStreamText(buffer);
          metadata.pageCount = 1;
        }

        text = pdfText;
        break;
      }

      case "word": {
        if (filename.toLowerCase().endsWith(".docx")) {
          const result = await mammoth.extractRawText({ buffer });
          text = (result.value || "").replace(/\r\n/g, "\n").trim();
        } else {
          // Legacy .doc or alternate format
          try {
            const result = await mammoth.extractRawText({ buffer });
            text = (result.value || "").trim();
          } catch {
            text = extractAsciiStrings(buffer);
          }
        }
        metadata.wordCount = text ? text.split(/\s+/).length : 0;
        break;
      }

      case "excel": {
        if (filename.toLowerCase().endsWith(".csv") || contentType.includes("csv")) {
          text = buffer.toString("utf-8").trim();
          metadata.sheetNames = ["Sheet1"];
        } else {
          const workbook = XLSX.read(buffer, { type: "buffer" });
          const sheetNames = workbook.SheetNames || [];
          metadata.sheetNames = sheetNames;

          const sheetsContent: string[] = [];
          for (const name of sheetNames) {
            const sheet = workbook.Sheets[name];
            if (!sheet) continue;
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            if (csv && csv.trim()) {
              sheetsContent.push(`--- Sheet: ${name} ---\n${csv.trim()}`);
            }
          }
          text = sheetsContent.join("\n\n");
        }
        break;
      }

      case "text": {
        text = buffer.toString("utf-8").trim();
        break;
      }

      default: {
        const asUtf8 = buffer.toString("utf-8");
        if (/^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]*$/.test(asUtf8.substring(0, 500))) {
          text = asUtf8.trim();
        } else {
          text = extractAsciiStrings(buffer);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Failed to parse document attachment "${filename}" (${kind}):`, err);
    text = `[Document Attachment: ${filename} (${kind.toUpperCase()}) could not be fully parsed. Fallback text extracted: ${extractAsciiStrings(buffer)}]`;
  }

  return {
    filename,
    contentType,
    sizeBytes,
    documentKind: kind,
    text,
    metadata,
  };
}
