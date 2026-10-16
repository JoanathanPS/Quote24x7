import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  parseInboundDocument,
  detectDocumentKind,
} from "./inbound-document-parser.ts";
import { processInboundEmail } from "../email/inbound-processor.ts";
import { store } from "../store/session-store.ts";

describe("Inbound Document Parser (Word, PDF, Excel)", () => {
  it("detects document kinds accurately from extensions and content types", () => {
    assert.equal(detectDocumentKind("rfp_spec.pdf"), "pdf");
    assert.equal(detectDocumentKind("specs.docx"), "word");
    assert.equal(detectDocumentKind("inventory.doc"), "word");
    assert.equal(detectDocumentKind("servers_list.xlsx"), "excel");
    assert.equal(detectDocumentKind("counts.xls"), "excel");
    assert.equal(detectDocumentKind("metrics.csv"), "excel");
    assert.equal(detectDocumentKind("notes.txt"), "text");
    assert.equal(detectDocumentKind("unknown.bin"), "other");
  });

  it("extracts text and tables from genuine Excel (.xlsx and .csv) spreadsheets", async () => {
    // Generate real XLSX binary using xlsx library
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Component", "Quantity Required", "Environment"],
      ["Production Linux Servers", "60", "AWS us-east-1"],
      ["Windows Active Directory Hosts", "20", "On-Premises"],
      ["Cisco Core Network Switches", "12", "Datacenter"],
      ["Synthetic REST API Transaction Monitors", "6", "Global"],
      ["Monthly RUM Web Traffic (Pageviews)", "1500000", "Public Web"],
      ["Centralized Log Management (GB/Month)", "40", "Security Compliance"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Infrastructure Fleet");
    const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);

    const parsed = await parseInboundDocument({
      filename: "client_fleet_sizing.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuffer,
    });

    assert.equal(parsed.documentKind, "excel");
    assert.ok(parsed.text.includes("Production Linux Servers"));
    assert.ok(parsed.text.includes("60"));
    assert.ok(parsed.text.includes("Cisco Core Network Switches"));
    assert.ok(parsed.text.includes("12"));
    assert.deepEqual(parsed.metadata.sheetNames, ["Infrastructure Fleet"]);
  });

  it("extracts text from genuine PDF documents", async () => {
    // Generate real PDF binary using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([600, 400]);
    const lines = [
      "Infrastructure Monitoring Requirements:",
      "- 25 Linux and Windows server hosts",
      "- 5 website uptime checks",
      "- 2 Java APM applications",
      "Monthly billing preferred.",
    ];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 350 - i * 16, size: 12, font });
    });
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    const parsed = await parseInboundDocument({
      filename: "monitoring_rfp_spec.pdf",
      contentType: "application/pdf",
      buffer: pdfBuffer,
    });

    assert.equal(parsed.documentKind, "pdf");
    assert.ok(parsed.text.includes("25 Linux and Windows server hosts"));
    assert.ok(parsed.text.includes("5 website uptime checks"));
    assert.equal(parsed.metadata.pageCount, 1);
  });

  it("extracts text from genuine Word (.docx) documents", async () => {
    // Generate a valid .docx zip archive
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Enterprise Technical Scope of Work</w:t></w:r></w:p>
    <w:p><w:r><w:t>We require 40 Linux servers, 10 network firewalls, and 3 website monitors.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    );
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );
    const docxBuffer = await zip.generateAsync({ type: "nodebuffer" });

    const parsed = await parseInboundDocument({
      filename: "technical_scope.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docxBuffer,
    });

    assert.equal(parsed.documentKind, "word");
    assert.ok(parsed.text.includes("Enterprise Technical Scope of Work"));
    assert.ok(parsed.text.includes("40 Linux servers, 10 network firewalls, and 3 website monitors."));
    assert.ok((parsed.metadata.wordCount ?? 0) > 5);
  });

  it("extracts text from CSV spreadsheets", async () => {
    const csvContent =
      "Metric,Count,Notes\nLinux Servers,45,CentOS and RHEL\nNetwork Devices,8,Juniper\nWebsites,4,E-commerce portals";
    const csvBuffer = Buffer.from(csvContent, "utf-8");

    const parsed = await parseInboundDocument({
      filename: "inventory.csv",
      contentType: "text/csv",
      buffer: csvBuffer,
    });

    assert.equal(parsed.documentKind, "excel");
    assert.ok(parsed.text.includes("Linux Servers,45"));
    assert.ok(parsed.text.includes("Network Devices,8"));
  });

  it("end-to-end: processes inbound email with attached Excel inventory to generate quote", async () => {
    await store.ensureInitializedAsync();

    // Create an Excel inventory buffer with 80 servers, 15 switches, 4 synthetic checks
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Metric Type", "Count"],
      ["Linux Servers", "80"],
      ["Network Switches", "15"],
      ["Synthetic Checks", "4"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer);

    const providerMessageId = `inbound_excel_test_${Date.now()}`;
    const result = await processInboundEmail({
      providerMessageId,
      from: `enterprise_buyer_${Date.now()}@financial.example.com`,
      fromName: "VP of Enterprise Infrastructure",
      to: ["quotes@quote24x7.internal"],
      subject: "Site24x7 Sizing Inquiry (See Attached Spreadsheet)",
      text: "Hello, please find our complete server and network inventory in the attached Excel document. We need a quotation.",
      attachments: [
        {
          filename: "enterprise_fleet.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          content: xlsxBuffer,
          sizeBytes: xlsxBuffer.length,
        },
      ],
    });

    assert.ok(result.threadId, "Thread was created");
    assert.equal(result.actionTaken, "quoted", "Quotation was generated directly from Excel contents");
    assert.ok(result.quote, "Quote object exists");

    // Verify the saved message records the attachment with extractedText and documentKind
    const threadMessages = store.getMessages(result.threadId);
    const inboundMsg = threadMessages.find((m) => m.providerMessageId === providerMessageId);
    assert.ok(inboundMsg, "Inbound message was recorded");
    assert.equal(inboundMsg.attachments.length, 1, "Attachment was stored");
    const att = inboundMsg.attachments[0]!;
    assert.equal(att.name, "enterprise_fleet.xlsx");
    assert.equal(att.documentKind, "excel");
    assert.ok(att.extractedText?.includes("Linux Servers,80"));
  });

  it("end-to-end: processes inbound email with attached Word document to generate quote", async () => {
    await store.ensureInitializedAsync();

    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Project Horizon Monitoring Sizing Spec</w:t></w:r></w:p>
    <w:p><w:r><w:t>Our scope includes 30 Linux servers, 5 Cisco switches, and 2 website checks. Annual billing.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    );
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );
    const docxBuffer = await zip.generateAsync({ type: "nodebuffer" });

    const providerMessageId = `inbound_word_test_${Date.now()}`;
    const result = await processInboundEmail({
      providerMessageId,
      from: `devops_lead_${Date.now()}@healthcorp.example.com`,
      fromName: "DevOps Lead",
      to: ["quotes@quote24x7.internal"],
      subject: "Word Document RFP Enclosed",
      text: "Please find the enclosed Word specification document for our monitoring quote.",
      attachments: [
        {
          filename: "Project_Horizon_Sizing.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: docxBuffer,
          sizeBytes: docxBuffer.length,
        },
      ],
    });

    assert.ok(result.threadId);
    assert.equal(result.actionTaken, "quoted", "Quotation was generated directly from Word doc contents");
    assert.ok(result.quote);
  });

  it("end-to-end: processes inbound email with attached PDF specification to generate quote", async () => {
    await store.ensureInitializedAsync();

    // Create a PDF with 25 Linux servers and 3 websites
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([600, 400]);
    const lines = [
      "Customer Technical Requirement Specification:",
      "Infrastructure inventory: 25 Linux servers",
      "Website uptime checks: 3 website URLs",
      "Annual commitment.",
    ];
    lines.forEach((line, i) => {
      page.drawText(line, { x: 50, y: 350 - i * 16, size: 12, font });
    });
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    const providerMessageId = `inbound_pdf_test_${Date.now()}`;
    const result = await processInboundEmail({
      providerMessageId,
      from: `lead_architect_${Date.now()}@cloudtech.example.com`,
      fromName: "Principal Cloud Architect",
      to: ["quotes@quote24x7.internal"],
      subject: "Quote Request - Architecture PDF Attached",
      text: "Hi team, our sizing requirements are enclosed in the attached PDF spec document.",
      attachments: [
        {
          filename: "architecture_spec.pdf",
          contentType: "application/pdf",
          content: pdfBuffer,
          sizeBytes: pdfBuffer.length,
        },
      ],
    });

    assert.ok(result.threadId);
    assert.equal(result.actionTaken, "quoted", "Quote generated from PDF");
    assert.ok(result.quote);
  });
});
