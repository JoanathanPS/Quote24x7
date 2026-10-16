import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import zlib from "node:zlib";
import {
  detectDocumentKind,
  parseInboundDocument,
  extractPdfStreamText,
} from "./inbound-document-parser.ts";

test("detectDocumentKind accurately identifies email attachment types", () => {
  assert.equal(detectDocumentKind("specs.pdf", "application/pdf"), "pdf");
  assert.equal(detectDocumentKind("inventory.xlsx"), "excel");
  assert.equal(detectDocumentKind("servers.csv", "text/csv"), "csv");
  assert.equal(detectDocumentKind("architecture.png", "image/png"), "image");
  assert.equal(detectDocumentKind("dashboard.jpg", "image/jpeg"), "image");
  assert.equal(detectDocumentKind("spec.docx"), "word");
  assert.equal(detectDocumentKind("notes.txt", "text/plain"), "text");
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
  // 1x1 transparent PNG buffer
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
