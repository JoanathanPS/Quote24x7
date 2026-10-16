import zlib from "node:zlib";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
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
 * Decodes Adobe ASCII85 (Base85) stream data commonly produced by ReportLab and Ghostscript.
 */
function decodeAscii85(bytes: Uint8Array | Buffer): Buffer<ArrayBufferLike> {
  const str = Buffer.from(bytes).toString("latin1").replace(/\s+/g, "");
  const clean = str.replace(/^<~/, "").replace(/~>.*$/, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; ) {
    if (clean[i] === "z") {
      out.push(0, 0, 0, 0);
      i++;
      continue;
    }
    let chunk = clean.slice(i, i + 5);
    i += 5;
    const pad = 5 - chunk.length;
    while (chunk.length < 5) chunk += "u";
    let val = 0;
    for (let j = 0; j < 5; j++) {
      val = val * 85 + (chunk.charCodeAt(j) - 33);
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
  let cur: Buffer<ArrayBufferLike> = Buffer.from(bytes);
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
function extractPdfStreamText(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const texts: string[] = [];

  const streamRegex = /stream[\r\n]+([\s\S]*?)(?:[\r\n]+endstream|~>endstream|endstream)/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(content)) !== null) {
    const rawData = match[1];
    if (!rawData) continue;
    let streamData: Buffer<ArrayBufferLike> = Buffer.from(rawData, "latin1");

    if (rawData.startsWith("<~") || rawData.includes("~>")) {
      streamData = decodeAscii85(streamData);
    }

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
      const extracted = extractTextFromPdfStream(decompressed);
      if (extracted) {
        texts.push(extracted);
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
        let pageCount = 1;

        // 1. Try pdf-lib stream traversal (handles modern PDFs, multi-filter ASCII85 + Flate, ReportLab)
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

        // 2. Fallback to pdfParse if pdf-lib yielded no text
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

        // 3. Fallback to raw stream regex if both failed
        if (!pdfText) {
          pdfText = extractPdfStreamText(buffer);
        }

        metadata.pageCount = pageCount;
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
