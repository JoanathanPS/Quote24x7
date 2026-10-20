import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  detectDocumentKind,
  parseInboundDocument,
  extractPdfStreamText,
  isAllowedAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_EXTRACTED_TEXT_LENGTH,
} from "./inbound-document-parser.ts";
import { processInboundEmail } from "../email/inbound-processor.ts";
import { store } from "../store/session-store.ts";

test("detectDocumentKind accurately identifies email attachment types", () => {
  assert.equal(detectDocumentKind("specs.pdf", "application/pdf"), "pdf");
  assert.equal(detectDocumentKind("inventory.xlsx"), "excel");
  assert.equal(detectDocumentKind("servers.csv", "text/csv"), "csv");
  assert.equal(detectDocumentKind("architecture.png", "image/png"), "image");
  assert.equal(detectDocumentKind("dashboard.jpg", "image/jpeg"), "image");
  assert.equal(detectDocumentKind("spec.docx"), "word");
  assert.equal(detectDocumentKind("legacy.doc", "application/msword"), "word");
  assert.equal(detectDocumentKind("notes.txt", "text/plain"), "text");
  assert.equal(detectDocumentKind("unknown.bin", "application/octet-stream"), "other");
});

test("isAllowedAttachment allowlist validation", () => {
  assert.equal(isAllowedAttachment("spec.pdf"), true);
  assert.equal(isAllowedAttachment("spec.docx"), true);
  assert.equal(isAllowedAttachment("inventory.xlsx"), true);
  assert.equal(isAllowedAttachment("inventory.csv"), true);
  assert.equal(isAllowedAttachment("notes.txt"), true);
  assert.equal(isAllowedAttachment("screenshot.png"), true);
  assert.equal(isAllowedAttachment("photo.jpg"), true);

  // Disallowed extensions / executables
  assert.equal(isAllowedAttachment("malicious.exe"), false);
  assert.equal(isAllowedAttachment("script.sh"), false);
  assert.equal(isAllowedAttachment("exploit.bat"), false);
  assert.equal(isAllowedAttachment("payload.dll"), false);
});

test("parseInboundDocument parses plain text and CSV attachments", async () => {
  const textBuffer = Buffer.from("Need monitoring for 45 Linux servers and 10 network devices.", "utf-8");
  const parsedText = await parseInboundDocument({
    filename: "requirements.txt",
    contentType: "text/plain",
    buffer: textBuffer,
  });

  assert.equal(parsedText.documentKind, "text");
  assert.ok(parsedText.text.includes("45 Linux servers"));

  const csvBuffer = Buffer.from("Hostname,OS,Role\nsrv-01,Linux,Web\nsrv-02,Linux,DB\nsrv-03,Windows,App", "utf-8");
  const parsedCsv = await parseInboundDocument({
    filename: "hosts.csv",
    contentType: "text/csv",
    buffer: csvBuffer,
  });

  assert.equal(parsedCsv.documentKind, "csv");
  assert.ok(parsedCsv.text.includes("srv-01"));
});

test("parseInboundDocument parses Excel spreadsheets into structured text", async () => {
  const workbook = XLSX.utils.book_new();
  const data = [
    ["Component", "Count", "Notes"],
    ["Linux EC2 Servers", 60, "Production instances"],
    ["Network Switches", 12, "Cisco core switches"],
    ["Synthetic Monitors", 5, "Critical payment checkout flows"],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Infrastructure");
  const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const parsedExcel = await parseInboundDocument({
    filename: "infrastructure_sizing.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excelBuffer,
  });

  assert.equal(parsedExcel.documentKind, "excel");
  assert.ok(parsedExcel.text.includes("Linux EC2 Servers"));
  assert.ok(parsedExcel.text.includes("60"));
  assert.ok(parsedExcel.text.includes("Network Switches"));
  assert.ok(parsedExcel.text.includes("12"));
});

test("parseInboundDocument extracts image attachments with base64 payload for vision", async () => {
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  const parsedImage = await parseInboundDocument({
    filename: "aws_console_screenshot.png",
    contentType: "image/png",
    buffer: pngHeader,
  });

  assert.equal(parsedImage.documentKind, "image");
  assert.ok(parsedImage.contentBase64);
  assert.ok(parsedImage.text.includes("aws_console_screenshot.png"));
});

test("extractPdfStreamText extracts literal and hex PDF strings cleanly", () => {
  const streamContent = "BT /F1 12 Tf (30 Production Servers) Tj ET\nBT <4C696E757820564D73> Tj ET";
  const deflated = zlib.deflateSync(Buffer.from(streamContent, "latin1"));
  const mockPdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + deflated.length + " >>\nstream\n"),
    deflated,
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);

  const extracted = extractPdfStreamText(mockPdf);
  assert.ok(extracted.includes("30 Production Servers"));
  assert.ok(extracted.includes("Linux VMs"));
});

test("PDF extraction: handles vector text layers and detects image-only PDFs cleanly", async () => {
  // 1. Text-layer PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.addPage([600, 400]);
  page.drawText("Production Fleet: 75 Linux instances, 15 firewalls", {
    x: 50,
    y: 350,
    size: 12,
    font,
  });
  const pdfBytes = await pdfDoc.save();

  const parsed = await parseInboundDocument({
    filename: "production_fleet.pdf",
    contentType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  });

  assert.equal(parsed.documentKind, "pdf");
  assert.ok(parsed.text.includes("75 Linux instances"));
  assert.equal(parsed.unparsed, false);

  // 2. Empty / scanned image-only PDF (blank page with no text operators)
  const emptyPdfDoc = await PDFDocument.create();
  emptyPdfDoc.addPage([600, 400]);
  const emptyPdfBytes = await emptyPdfDoc.save();

  const parsedBlank = await parseInboundDocument({
    filename: "scanned_doc.pdf",
    contentType: "application/pdf",
    buffer: Buffer.from(emptyPdfBytes),
  });

  assert.equal(parsedBlank.isImageOnlyPdf, true);
  assert.equal(parsedBlank.unparsed, true);
  assert.ok(parsedBlank.unparsedReason?.includes("scanned or image-only"));
});

test("Safety Checks: empty, oversized, corrupt, and unsupported files fail soft", async () => {
  // 1. Empty file (0 bytes)
  const emptyRes = await parseInboundDocument({
    filename: "empty.pdf",
    contentType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  assert.equal(emptyRes.unparsed, true);
  assert.equal(emptyRes.unparsedReason, "File is empty (0 bytes)");

  // 2. Oversized file (>15MB)
  const hugeBuf = Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1024);
  const hugeRes = await parseInboundDocument({
    filename: "huge_inventory.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: hugeBuf,
  });
  assert.equal(hugeRes.unparsed, true);
  assert.ok(hugeRes.unparsedReason?.includes("Exceeds maximum allowable size limit"));

  // 3. Unsupported file type (executable)
  const exeBuf = Buffer.from("MZ mock executable", "utf-8");
  const exeRes = await parseInboundDocument({
    filename: "run.exe",
    contentType: "application/x-msdownload",
    buffer: exeBuf,
  });
  assert.equal(exeRes.unparsed, true);
  assert.ok(exeRes.unparsedReason?.includes("Unsupported file format"));

  // 4. Corrupt binary pretending to be PDF
  const corruptBuf = Buffer.from("%PDF-1.4 garbage truncated stream non-valid", "utf-8");
  const corruptRes = await parseInboundDocument({
    filename: "corrupt.pdf",
    contentType: "application/pdf",
    buffer: corruptBuf,
  });
  assert.equal(corruptRes.unparsed, true);

  // 5. Text length cap enforcement
  const giantText = "A".repeat(MAX_EXTRACTED_TEXT_LENGTH + 5000);
  const giantRes = await parseInboundDocument({
    filename: "giant.txt",
    contentType: "text/plain",
    buffer: Buffer.from(giantText, "utf-8"),
  });
  assert.ok(giantRes.text.length <= MAX_EXTRACTED_TEXT_LENGTH + 100);
  assert.ok(giantRes.text.includes("Truncated: attachment content exceeded limit"));
});

test("End-to-end: inbound email with Excel (.xlsx) inventory generates quotation", async () => {
  await store.clearAll();

  // Create an Excel inventory buffer with complete infrastructure specifications
  const wb = XLSX.utils.book_new();
  const wsData = [
    ["Component", "Count"],
    ["Linux servers", "80"],
    ["Network switches", "15"],
    ["Advanced monitors", "4"],
    ["Websites", "5"],
    ["RUM pageviews", "0"],
    ["AppLogs volume", "0 GB"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  const wbBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const xlsxBuffer = Buffer.isBuffer(wbBuffer) ? wbBuffer : Buffer.from(wbBuffer as ArrayBuffer);

  const providerMessageId = `e2e_xlsx_${Date.now()}`;
  const result = await processInboundEmail({
    providerMessageId,
    from: `enterprise_lead_${Date.now()}@financialcorp.example.com`,
    fromName: "Infrastructure Director",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Quotation request with attached fleet inventory",
    text: "Hello team, please find our complete server and network count in the attached spreadsheet.",
    attachments: [
      {
        filename: "fleet_inventory.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content: xlsxBuffer,
        sizeBytes: xlsxBuffer.length,
      },
    ],
  });

  assert.ok(result.threadId);
  assert.equal(result.actionTaken, "quoted", "Direct quotation generated from Excel inventory");
  assert.ok(result.quote, "Quote was created");

  // Verify attachment was stored on the message with extracted text
  const msgs = store.getMessages(result.threadId);
  const inboundMsg = msgs.find((m) => m.providerMessageId === providerMessageId);
  assert.ok(inboundMsg);
  assert.equal(inboundMsg.attachments.length, 1);
  assert.equal(inboundMsg.attachments[0]?.name, "fleet_inventory.xlsx");
  assert.equal(inboundMsg.attachments[0]?.documentKind, "excel");
  assert.ok(inboundMsg.attachments[0]?.extractedText?.includes("Linux servers,80"));
});

test("processInboundEmail deduplicates duplicate attachments when receiving both downloaded buffer and 0-byte stub", async () => {
  const providerMessageId = `msg_dedup_test_${Date.now()}`;
  const pdfBuffer = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstream\nWe need 40 servers and 10 network devices\nendstream\ntrailer\n<< >>\n%%EOF"
  );

  const result = await processInboundEmail({
    providerMessageId,
    from: `dedup_tester_${Date.now()}@corp.example.com`,
    fromName: "Tester",
    to: ["quotes@quotes.joanathan.in"],
    subject: "Quotation request with duplicate attachment stubs",
    text: "Please find our requirements attached.",
    attachments: [
      {
        filename: "Case-1-Production-Infrastructure.pdf",
        contentType: "application/pdf",
        content: pdfBuffer,
        sizeBytes: pdfBuffer.length,
      },
      // Duplicate 0-byte stub that Resend webhook metadata previously caused
      {
        filename: "Case-1-Production-Infrastructure.pdf",
        contentType: "application/pdf",
        content: undefined,
        sizeBytes: 0,
      },
    ],
  });

  assert.ok(result.threadId);
  const msgs = store.getMessages(result.threadId);
  const inboundMsg = msgs.find((m) => m.providerMessageId === providerMessageId);
  assert.ok(inboundMsg);
  // Verify exactly 1 attachment is kept and the 0-byte ghost is dropped
  assert.equal(inboundMsg.attachments.length, 1);
  assert.equal(inboundMsg.attachments[0]?.name, "Case-1-Production-Infrastructure.pdf");
  assert.equal(inboundMsg.attachments[0]?.sizeBytes, pdfBuffer.length);
  assert.ok((inboundMsg.attachments[0]?.sizeBytes || 0) > 0);
});

