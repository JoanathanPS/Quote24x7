import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { renderQuotePdf } from "./pdf-renderer.ts";
import type { Quote, EmailThread } from "@/types/domain";

describe("PDF Renderer (Invoice / Quotation Generator)", () => {
  const baseQuote: Quote = {
    id: "Q-TEST-001",
    threadId: "th-test-001",
    requirementProfileId: "prof-001",
    catalogueVersionId: "demo-in-2026-10",
    catalogueVersion: "demo-in-2026-10",
    calculationVersion: "v1.2.0",
    currency: "INR",
    billingPeriod: "monthly",
    market: "IN",
    options: [
      {
        id: "opt-1",
        quoteId: "Q-TEST-001",
        optionType: "best_value",
        planId: "plan_professional",
        planName: "Site24x7 Professional Enterprise Operations Tier",
        subtotal: 874000,
        taxTotal: 0,
        total: 874000,
        valid: true,
        unavailabilityReason: null,
        headroomNotes: [],
        rankReason:
          "Includes 5 servers out of the box plus comprehensive network, synthetics, and APM metrics with standard SLA coverage for enterprise production infrastructure.",
        lineItems: [
          {
            id: "li-1",
            ruleId: "rule_base_license",
            sourceId: "plan_professional",
            description: "Site24x7 Professional Plan Base License with 5 Servers & 1 APM",
            quantity: 1,
            unit: "license",
            unitPrice: 399000,
            lineTotal: 399000,
            includedQuantity: 5,
          },
          {
            id: "li-2",
            ruleId: "rule_server_pack",
            sourceId: "addon_server_pack_10",
            description: "Additional Linux and Windows Server Monitoring Multi-Node Extension Pack (10 servers)",
            quantity: 2,
            unit: "10-pack",
            unitPrice: 237500,
            lineTotal: 475000,
            includedQuantity: 0,
          },
        ],
        coverage: [
          {
            unit: "host_monitor",
            label: "Linux & Windows Servers",
            required: 25,
            included: 5,
            viaAddOns: 20,
            total: 25,
            satisfied: true,
          },
        ],
      },
      {
        id: "opt-2",
        quoteId: "Q-TEST-001",
        optionType: "lowest_cost",
        planId: "plan_lite",
        planName: "Site24x7 Lite Starter",
        subtotal: 798000,
        taxTotal: 0,
        total: 798000,
        valid: true,
        unavailabilityReason: null,
        headroomNotes: [],
        rankReason: "Minimizes baseline expenditure while satisfying raw server headcount requirements.",
        lineItems: [
          {
            id: "li-3",
            ruleId: "rule_base_license",
            sourceId: "plan_lite",
            description: "Site24x7 Lite Base (Includes 2 Servers)",
            quantity: 1,
            unit: "license",
            unitPrice: 199000,
            lineTotal: 199000,
            includedQuantity: 2,
          },
        ],
        coverage: [
          {
            unit: "host_monitor",
            label: "Linux & Windows Servers",
            required: 25,
            included: 2,
            viaAddOns: 23,
            total: 25,
            satisfied: true,
          },
        ],
      },
    ],
    assumptions: [
      "Quotation is based on 25 servers deployed in Indian datacenters.",
      "Monthly billing with auto-renewal until cancelled.",
    ],
    exclusions: [
      "Third-party SMS gateway delivery fees.",
      "Custom on-premise installation and hardware appliance hosting.",
    ],
    pricingStatus: "demo_unverified",
    calculationTrace: [],
    integrityChecks: [],
    documents: [],
    expiresAt: null,
    optionCountNote: null,
    status: "validated",
    createdAt: "2026-10-15T12:00:00.000Z",
  };

  const sampleThread: EmailThread = {
    id: "th-test-001",
    provider: "resend",
    providerThreadId: "th-resend-test",
    senderEmail: "infrastructure.lead@cloudcorp-enterprises.example.com",
    senderName: "Alexander Bartholomew Montgomery-Smythe III",
    organisation: "CloudCorp Global Enterprise Infrastructure & DevOps Solutions Private Limited",
    subject: "Urgent: Infrastructure Monitoring Quote for 25 Servers",
    status: "completed",
    requestType: "quote",
    createdAt: "2026-10-15T11:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    lastMessageAt: "2026-10-15T12:00:00.000Z",
    messageCount: 2,
    quoteId: "Q-TEST-001",
    quoteTotal: 874000,
    currency: "INR",
    statusDetail: null,
  };

  it("renders a valid vector PDF buffer with correct headers and magic bytes", async () => {
    const pdfBuffer = await renderQuotePdf({
      quote: baseQuote,
      thread: sampleThread,
      selectedOptionType: "best_value",
    });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.ok(pdfBuffer.length > 3000, `Buffer should be substantial, got ${pdfBuffer.length}`);
    const magic = pdfBuffer.subarray(0, 5).toString("ascii");
    assert.equal(magic, "%PDF-");

    const loadedDoc = await PDFDocument.load(pdfBuffer);
    assert.ok(loadedDoc.getPageCount() >= 1, "Should have at least 1 page");
  });

  it("handles extreme text length without crash or overflow (word wrapping test)", async () => {
    const extremeQuote: Quote = {
      ...baseQuote,
      id: "Q-EXTREME-OVERLAY-TEST-999999999999999999999999",
      options: [
        {
          ...baseQuote.options[0]!,
          planName:
            "Ultra Advanced Extended High-Availability Multi-Region Enterprise Fleet Management Platform With Integrated Real-Time Telemetry and Autonomous Remediation Engine",
          rankReason:
            "This enterprise configuration has been calculated following the deepest optimization protocol, specifically addressing composite synthetic checks, multi-cloud VPC ingress metrics, deep database query profiling, and high-volume transaction tracing across all 5 distributed Kubernetes clusters across APAC and EMEA geographies.",
          lineItems: [
            {
              id: "li-long-1",
              ruleId: "rule_synthetic_addon",
              sourceId: "addon_super_long_sku_name_which_previously_would_collide_with_price_column",
              description:
                "Comprehensive End-to-End Synthetic Monitoring Agent Pack with 50 Global Location Nodes, SSL Certificate Monitoring, DNS Resolution Tracking, REST API Multi-Step Transaction Sequences, and Real-Time WebSocket Telemetry Probes",
              quantity: 50,
              unit: "continuous-node-pack",
              unitPrice: 1250000,
              lineTotal: 62500000,
              includedQuantity: 0,
            },
          ],
        },
      ],
      assumptions: [
        "A very long assumption line that previously might have bled over the page bottom margin: The customer agrees that all telemetry data transmitted to the cloud collection endpoints adheres to the standardized OpenTelemetry protocol version 1.25 and does not exceed the agreed 50,000 span events per second rate limit during steady-state operations.",
      ],
    };

    const pdfBuffer = await renderQuotePdf({
      quote: extremeQuote,
      thread: sampleThread,
      selectedOptionType: "best_value",
    });

    assert.ok(pdfBuffer.length > 3000);
    const loadedDoc = await PDFDocument.load(pdfBuffer);
    assert.ok(loadedDoc.getPageCount() >= 1);
  });

  it("automatically paginates into multiple pages when line items exceed one page", async () => {
    // Generate 35 line items to force multi-page layout
    const manyLineItems = Array.from({ length: 35 }, (_, idx) => ({
      id: `li-multi-${idx + 1}`,
      ruleId: "rule_server_addon",
      sourceId: `sku_item_${idx + 1}`,
      description: `Production Infrastructure Add-On Component #${idx + 1} with custom metric collector and 1-minute polling interval`,
      quantity: idx + 1,
      unit: "pack",
      unitPrice: 100000,
      lineTotal: (idx + 1) * 100000,
      includedQuantity: 0,
    }));

    const paginatedQuote: Quote = {
      ...baseQuote,
      options: [
        {
          ...baseQuote.options[0]!,
          lineItems: manyLineItems,
        },
      ],
    };

    const pdfBuffer = await renderQuotePdf({
      quote: paginatedQuote,
      thread: sampleThread,
      selectedOptionType: "best_value",
    });

    const loadedDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = loadedDoc.getPageCount();
    assert.ok(pageCount >= 2, `Expected at least 2 pages for 35 line items, got ${pageCount}`);
  });

  it("renders non-default selected option tier (lowest_cost)", async () => {
    const pdfBuffer = await renderQuotePdf({
      quote: baseQuote,
      thread: sampleThread,
      selectedOptionType: "lowest_cost",
    });

    assert.ok(pdfBuffer.length > 3000);
    const loadedDoc = await PDFDocument.load(pdfBuffer);
    assert.ok(loadedDoc.getPageCount() >= 1);
  });

  it("handles missing thread information gracefully", async () => {
    const pdfBuffer = await renderQuotePdf({
      quote: baseQuote,
      thread: undefined,
    });

    assert.ok(pdfBuffer.length > 3000);
    const loadedDoc = await PDFDocument.load(pdfBuffer);
    assert.ok(loadedDoc.getPageCount() >= 1);
  });
});
