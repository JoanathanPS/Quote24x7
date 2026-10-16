import zlib from "node:zlib";
import * as XLSX from "xlsx";
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
  /** Base64-encoded content for vision/multimodal processing (e.g. images, PDFs). */
  contentBase64?: string;
}

export interface ParseDocumentOptions {
  filename: string;
  contentType?: string;
  buffer: Buffer;
}

/**
 * Classifies document format from filename and MIME type.
 */
export function detectDocumentKind(filename: string, contentType?: string): DocumentFormatKind {
  const lowerName = (filename || "").toLowerCase();
  const lowerType = (contentType || "").toLowerCase();

  if (lowerName.endsWith(".pdf") || lowerType.includes("pdf")) {
    return "pdf";
  }

  if (
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".webp") ||
    lowerName.endsWith(".gif") ||
    lowerType.startsWith("image/")
  ) {
    return "image";
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerType.includes("spreadsheet") ||
    lowerType.includes("excel") ||
    lowerType.includes("openxmlformats-officedocument.spreadsheetml")
  ) {
    return "excel";
  }

  if (lowerName.endsWith(".csv") || lowerType.includes("csv")) {
    return "csv";
  }

  if (
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerType.includes("word") ||
    lowerType.includes("openxmlformats-officedocument.wordprocessingml")
  ) {
    return "word";
  }

  if (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".log") ||
    lowerName.endsWith(".md") ||
    lowerType.startsWith("text/")
  ) {
    return "text";
  }

  return "other";
}

/**
 * Extracts readable printable ASCII strings from raw binary buffers as a robust fallback.
 */
function extractAsciiStrings(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const matches = raw.match(/[\x20-\x7E]{4,}/g) || [];
  return matches.join(" ").replace(/\s+/g, " ").trim();
}

function decodePdfHexString(hex: string): string {
  try {
    const normalized = hex.length % 2 !== 0 ? `${hex}0` : hex;
    return Buffer.from(normalized, "hex").toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Decompresses and extracts text directly from PDF flate and text streams without native binary dependencies.
 * Supports literal text ((Text) Tj), hex-encoded vectors (<...> Tj), and array spacing ([(Text) 20 <Hex>] TJ).
 */
export function extractPdfStreamText(buffer: Buffer): string {
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
 * Extracts plain text from a Word .docx file by extracting document.xml from the ZIP container.
 */
function extractDocxText(buffer: Buffer): string {
  try {
    // A .docx file is a ZIP archive containing word/document.xml
    const latin1 = buffer.toString("latin1");
    // Look for word/document.xml local file header in ZIP
    const docXmlIndex = latin1.indexOf("word/document.xml");
    if (docXmlIndex !== -1) {
      // Find following stream compressed bytes
      const headerPos = latin1.lastIndexOf("PK\x03\x04", docXmlIndex);
      if (headerPos !== -1) {
        const startOfData = headerPos + 30 + buffer.readUInt16LE(headerPos + 26) + buffer.readUInt16LE(headerPos + 28);
        const compressedSize = buffer.readUInt32LE(headerPos + 18);
        if (compressedSize > 0 && startOfData + compressedSize <= buffer.length) {
          const compressed = buffer.subarray(startOfData, startOfData + compressedSize);
          try {
            const xml = zlib.inflateRawSync(compressed).toString("utf-8");
            // Extract text from <w:t> tags
            const textMatches = xml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
            const textContent = textMatches
              .map((m) => m.replace(/<[^>]+>/g, ""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (textContent) return textContent;
          } catch {
            // Fall through to ASCII scanner
          }
        }
      }
    }
  } catch {
    // Fall through to ASCII scanner
  }

  return extractAsciiStrings(buffer);
}

/**
 * Extracts plain text and structured content from email attachments:
 * - PDF documents (.pdf)
 * - Excel workbooks (.xlsx, .xls)
 * - CSV tables (.csv)
 * - Plain text (.txt, .log)
 * - Images (.png, .jpg, .webp) -> retains base64 for Multimodal Vision (Gemini)
 * - Word documents (.docx)
 */
export async function parseInboundDocument(
  options: ParseDocumentOptions
): Promise<ParsedInboundDocument> {
  const { filename, contentType = "application/octet-stream", buffer } = options;
  const kind = detectDocumentKind(filename, contentType);
  const sizeBytes = buffer.length;
  const now = new Date().toISOString();

  let text = "";
  let contentBase64: string | undefined;
  const metadata: ParsedInboundDocument["metadata"] = { parsedAt: now };

  try {
    switch (kind) {
      case "pdf": {
        text = extractPdfStreamText(buffer);
        metadata.pageCount = 1;
        // Retain base64 for potential multimodal validation if small enough (<5MB)
        if (sizeBytes > 0 && sizeBytes < 5_000_000) {
          contentBase64 = buffer.toString("base64");
        }
        break;
      }

      case "excel": {
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
        break;
      }

      case "csv": {
        text = buffer.toString("utf-8").trim();
        metadata.sheetNames = ["CSV Data"];
        break;
      }

      case "image": {
        // Encode base64 for Gemini vision model
        if (sizeBytes > 0 && sizeBytes < 10_000_000) {
          contentBase64 = buffer.toString("base64");
        }
        text = `[Image Attachment: "${filename}" (${kind.toUpperCase()}, ${(sizeBytes / 1024).toFixed(1)} KB)]`;
        break;
      }

      case "word": {
        text = extractDocxText(buffer);
        metadata.wordCount = text ? text.split(/\s+/).length : 0;
        break;
      }

      case "text":
      default: {
        const asUtf8 = buffer.toString("utf-8");
        // Verify if it is valid printable text
        if (/^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]*$/.test(asUtf8.substring(0, 500))) {
          text = asUtf8.trim();
        } else {
          text = extractAsciiStrings(buffer);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Failed to parse email attachment "${filename}" (${kind}):`, err);
    text = `[Attachment: ${filename} (${kind.toUpperCase()}) could not be fully parsed. Fallback text: ${extractAsciiStrings(buffer)}]`;
  }

  return {
    filename,
    contentType,
    sizeBytes,
    documentKind: kind,
    text,
    metadata,
    contentBase64,
  };
}
