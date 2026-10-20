import zlib from "node:zlib";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
// @ts-expect-error pdf-parse subpath import avoids the index.js debug execution bug
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { DocumentFormatKind } from "@/types/domain";

export const MAX_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
export const MAX_EXTRACTED_TEXT_LENGTH = 20_000; // 20k characters cap for LLM safety

export interface ParsedInboundDocument {
  filename: string;
  contentType: string;
  sizeBytes: number;
  documentKind: DocumentFormatKind;
  text: string;
  unparsed?: boolean;
  unparsedReason?: string;
  isImageOnlyPdf?: boolean;
  metadata: {
    pageCount?: number;
    sheetNames?: string[];
    wordCount?: number;
    parsedAt: string;
  };
  /** Base64-encoded content for vision/multimodal processing (e.g. images). */
  contentBase64?: string;
}

export interface ParseDocumentOptions {
  filename: string;
  contentType?: string;
  buffer: Buffer;
}

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "txt",
  "log",
  "md",
  "png",
  "jpg",
  "jpeg",
  "webp",
]);

/**
 * Checks if the file extension or MIME type is on our safe intake allowlist.
 */
export function isAllowedAttachment(filename: string, contentType?: string): boolean {
  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";
  if (ALLOWED_EXTENSIONS.has(ext)) return true;

  const ct = (contentType || "").toLowerCase();
  if (
    ct.includes("pdf") ||
    ct.includes("word") ||
    ct.includes("officedocument") ||
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct.includes("csv") ||
    ct.startsWith("text/") ||
    ct.startsWith("image/")
  ) {
    return true;
  }

  return false;
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
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerType.includes("word") ||
    lowerType.includes("openxmlformats-officedocument.wordprocessingml")
  ) {
    return "word";
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
 * Decodes Adobe ASCII85 (Base85) stream data commonly produced by ReportLab and Ghostscript.
 */
function decodeAscii85(bytes: Uint8Array | Buffer): Buffer {
  const str = Buffer.from(bytes).toString("latin1").replace(/\s+/g, "");
  const clean = str.replace(/^<~/, "").replace(/~>.*$/, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; ) {
    if (clean[i] === "z") {
      out.push(0, 0, 0, 0);
      i++;
      continue;
    }
    const chunk = clean.slice(i, i + 5);
    i += 5;
    const pad = 5 - chunk.length;
    let padded = chunk;
    while (padded.length < 5) padded += "u";
    let val = 0;
    for (let j = 0; j < 5; j++) {
      val = val * 85 + (padded.charCodeAt(j) - 33);
    }
    for (let j = 0; j < 4 - pad; j++) {
      out.push((val >> (24 - j * 8)) & 0xff);
    }
  }
  return Buffer.from(out);
}

/**
 * Decodes standard PDF escape sequences in literal strings.
 */
function decodePdfString(s: string): string {
  return s
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\(.)/g, "$1");
}

/**
 * Extracts readable lines of text from a decoded PDF content stream.
 * Parses text blocks (BT ... ET) and text operators (Tj, ', ", and TJ arrays).
 */
function extractTextFromPdfStream(streamText: string): string {
  const lines: string[] = [];
  const btRegex = /BT[\s\S]*?ET/g;
  const blocks = streamText.match(btRegex) || [streamText];

  for (const block of blocks) {
    let currentLine = "";
    const opRegex = /(?:(?:\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]+>)\s*(?:Tj|'|")|\[(?:[^\[\]\\]|\\.)*\]\s*TJ)/g;
    const ops = block.match(opRegex) || [];
    for (const op of ops) {
      if (op.includes("TJ")) {
        const inner = op.slice(op.indexOf("[") + 1, op.lastIndexOf("]"));
        const parts = inner.match(/\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F]+>|-?\d+(?:\.\d+)?/g) || [];
        for (const p of parts) {
          if (p.startsWith("(")) {
            currentLine += decodePdfString(p.slice(1, -1));
          } else if (p.startsWith("<")) {
            const h = p.slice(1, -1).replace(/\s+/g, "");
            currentLine += decodePdfHexString(h);
          } else if (parseFloat(p) < -150) {
            currentLine += " ";
          }
        }
      } else {
        const parenMatch = op.match(/\(([\s\S]*?)\)\s*(?:Tj|'|")/);
        const hexMatch = op.match(/<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/);
        if (parenMatch && parenMatch[1] !== undefined) {
          currentLine += decodePdfString(parenMatch[1]);
        } else if (hexMatch && hexMatch[1] !== undefined) {
          const h = hexMatch[1].replace(/\s+/g, "");
          currentLine += decodePdfHexString(h);
        }
      }
      currentLine += " ";
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }
  }
  return lines.join("\n");
}

/**
 * Decodes a raw stream buffer based on its PDF filter specifications.
 */
function decodePdfStream(bytes: Uint8Array, filterObj?: unknown): string {
  let cur: Buffer = Buffer.from(bytes);
  let filters: string[] = [];
  if (filterObj instanceof PDFArray) {
    filters = filterObj.asArray().map((f) => f.toString());
  } else if (filterObj) {
    filters = [filterObj.toString()];
  }
  for (const f of filters) {
    if (f === "/ASCII85Decode" || f === "ASCII85Decode") {
      cur = decodeAscii85(cur);
    } else if (f === "/FlateDecode" || f === "FlateDecode") {
      try {
        cur = zlib.inflateSync(cur);
      } catch {
        try {
          cur = zlib.inflateRawSync(cur);
        } catch {
          // ignore decompression failure
        }
      }
    }
  }
  return cur.toString("latin1");
}

/**
 * Traverses PDF indirect objects using pdf-lib to decode streams and extract text.
 */
async function extractPdfWithPdfLib(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = doc.getPageCount();
  const allText: string[] = [];

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamObj = obj as any;
    if (typeof streamObj.getContents === "function") {
      const filter = streamObj.dict?.get(PDFName.of("Filter"));
      const textStream = decodePdfStream(streamObj.getContents(), filter);
      const extracted = extractTextFromPdfStream(textStream);
      if (extracted) allText.push(extracted);
    }
  }

  return {
    text: allText.join("\n").replace(/[^\x20-\x7E\n]/g, " ").replace(/ +/g, " ").trim(),
    pageCount,
  };
}

/**
 * Decompresses and extracts readable text directly from PDF flate and text streams as a raw fallback.
 * Supports ASCII85, Flate, literal text (Tj) and hex-encoded font vectors (<...> Tj / TJ).
 */
export function extractPdfStreamText(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const texts: string[] = [];

  const streamRegex = /stream[\r\n]+([\s\S]*?)(?:[\r\n]+endstream|~>endstream|endstream)/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(content)) !== null) {
    const rawData = match[1];
    if (!rawData) continue;

    let decompressed: string | null = null;
    const streamBuf = Buffer.from(rawData, "latin1");

    // Try flate inflate
    try {
      decompressed = zlib.inflateSync(streamBuf).toString("latin1");
    } catch {
      try {
        decompressed = zlib.inflateRawSync(streamBuf).toString("latin1");
      } catch {
        try {
          // Try ASCII85 decode followed by flate inflate
          const a85 = decodeAscii85(streamBuf);
          decompressed = zlib.inflateSync(a85).toString("latin1");
        } catch {
          // Stream is uncompressed or unsupported filter
          decompressed = rawData;
        }
      }
    }

    if (decompressed) {
      const extracted = extractTextFromPdfStream(decompressed);
      if (extracted) {
        texts.push(extracted);
      }
    }
  }

  return texts.join("\n").replace(/[^\x20-\x7E\n]/g, " ").replace(/ +/g, " ").trim();
}

/**
 * Extracts plain text and structured content from email attachments:
 * - PDF documents (.pdf) -> pdf-lib stream traversal -> pdf-parse -> raw zlib stream regex -> ASCII scanner
 * - Word documents (.docx, .doc) -> mammoth -> ASCII scanner
 * - Excel workbooks (.xlsx, .xls) -> SheetJS multi-sheet CSV tables
 * - CSV tables (.csv) -> raw UTF-8 text
 * - Plain text (.txt, .log, .md) -> UTF-8 text
 * - Images (.png, .jpg, .webp) -> retains base64 for Multimodal Vision (Gemini)
 */
export async function parseInboundDocument(
  options: ParseDocumentOptions
): Promise<ParsedInboundDocument> {
  const { filename, buffer } = options;
  const sizeBytes = buffer ? buffer.length : 0;
  const contentType = options.contentType || "application/octet-stream";
  const kind = detectDocumentKind(filename, contentType);
  const now = new Date().toISOString();

  // Safety Check 1: Empty file
  if (!buffer || sizeBytes === 0) {
    return {
      filename,
      contentType,
      sizeBytes: 0,
      documentKind: kind,
      text: "",
      unparsed: true,
      unparsedReason: "File is empty (0 bytes)",
      metadata: { parsedAt: now },
    };
  }

  // Safety Check 2: Oversized file (>15MB)
  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      filename,
      contentType,
      sizeBytes,
      documentKind: kind,
      text: `[Attachment "${filename}" exceeds maximum allowable size limit (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > 15MB)]`,
      unparsed: true,
      unparsedReason: "Exceeds maximum allowable size limit (15MB)",
      metadata: { parsedAt: now },
    };
  }

  // Safety Check 3: File type allowlist
  if (!isAllowedAttachment(filename, contentType)) {
    return {
      filename,
      contentType,
      sizeBytes,
      documentKind: "other",
      text: `[Attachment "${filename}" (${contentType}) has an unsupported file format]`,
      unparsed: true,
      unparsedReason: `Unsupported file format: ${filename}`,
      metadata: { parsedAt: now },
    };
  }

  let text = "";
  let contentBase64: string | undefined;
  let unparsed = false;
  let unparsedReason: string | undefined;
  let isImageOnlyPdf = false;
  const metadata: ParsedInboundDocument["metadata"] = { parsedAt: now };

  try {
    switch (kind) {
      case "pdf": {
        let pdfText = "";
        let pageCount = 1;

        // 1. Primary: pdf-lib stream traversal (handles ReportLab, GhostScript, multi-filter)
        try {
          const pdfLibResult = await extractPdfWithPdfLib(buffer);
          if (pdfLibResult.text.trim()) {
            pdfText = pdfLibResult.text.trim();
          }
          if (pdfLibResult.pageCount > 0) {
            pageCount = pdfLibResult.pageCount;
          }
        } catch {
          // pdf-lib traversal failed or was encrypted; fallback to pdfParse
        }

        // 2. Secondary fallback: pdfParse subpath import
        if (!pdfText) {
          try {
            const parser =
              typeof pdfParse === "function"
                ? pdfParse
                : (pdfParse as unknown as { default: typeof pdfParse }).default;

            const data = await parser(buffer);
            if (data && data.text && data.text.trim()) {
              pdfText = data.text.replace(/\r\n/g, "\n").trim();
              pageCount = data.numpages || pageCount;
            }
          } catch {
            // pdfParse threw
          }
        }

        // 3. Tertiary fallback: raw Node.js zlib stream regex
        if (!pdfText) {
          pdfText = extractPdfStreamText(buffer);
        }

        metadata.pageCount = pageCount;

        // If after extraction layers no text was found, the PDF is likely a scanned bitmap/image
        if (!pdfText.trim()) {
          isImageOnlyPdf = true;
          unparsed = true;
          unparsedReason = "PDF contains no extractable text layer (scanned or image-only PDF)";
          text = `[Document Attachment "${filename}": Scanned image-only PDF with no text layer. Operator review required.]`;
        } else {
          text = pdfText;
        }

        // Retain base64 for potential multimodal validation if <5MB
        if (sizeBytes < 5_000_000) {
          contentBase64 = buffer.toString("base64");
        }
        break;
      }

      case "word": {
        if (filename.toLowerCase().endsWith(".docx")) {
          try {
            const result = await mammoth.extractRawText({ buffer });
            text = (result.value || "").replace(/\r\n/g, "\n").trim();
          } catch (mammothErr) {
            text = extractAsciiStrings(buffer);
            if (!text) {
              unparsed = true;
              unparsedReason = "Failed to parse Word (.docx) archive";
            }
          }
        } else {
          // Legacy .doc format
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
        // Retain base64 for Gemini vision model
        if (sizeBytes < 10_000_000) {
          contentBase64 = buffer.toString("base64");
        }
        text = `[Image Attachment: "${filename}" (${kind.toUpperCase()}, ${(sizeBytes / 1024).toFixed(1)} KB)]`;
        break;
      }

      case "text":
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
  } catch {
    // Soft error handling: never throw, never crash webhook, never log file contents
    unparsed = true;
    unparsedReason = `Corrupt or unreadable ${kind} document`;
    text = `[Document Attachment: "${filename}" (${kind.toUpperCase()}) could not be fully parsed. Fallback text: ${extractAsciiStrings(buffer)}]`;
  }

  // Safety Cap 4: Cap extracted text length to MAX_EXTRACTED_TEXT_LENGTH before reaching LLM
  if (text.length > MAX_EXTRACTED_TEXT_LENGTH) {
    text = text.slice(0, MAX_EXTRACTED_TEXT_LENGTH) + "\n\n[... Truncated: attachment content exceeded limit ...]";
  }

  return {
    filename,
    contentType,
    sizeBytes,
    documentKind: kind,
    text,
    unparsed,
    unparsedReason,
    isImageOnlyPdf,
    metadata,
    contentBase64,
  };
}
