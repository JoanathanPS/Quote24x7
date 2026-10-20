import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeSha256, uploadToStorage, downloadFromStorage, deleteFromStorage } from "./storage.ts";
import { extractDocumentContent } from "./indexer.ts";
import {
  ingestKnowledgeDocument,
  findDuplicateDocument,
  deleteKnowledgeDocument,
} from "./service.ts";
import { searchKnowledgeBase, findCitationsForLineItem } from "./retriever.ts";
import { enrichQuoteWithKnowledgeCitations } from "../pricing/quote-builder.ts";
import type { Quote } from "@/types/domain";

describe("Knowledge Library System", () => {

  test("computeSha256 generates consistent SHA256 digests", () => {
    const buf1 = Buffer.from("Site24x7 Enterprise Plan Pricing");
    const buf2 = Buffer.from("Site24x7 Enterprise Plan Pricing");
    const buf3 = Buffer.from("Site24x7 Professional Plan Pricing");

    const hash1 = computeSha256(buf1);
    const hash2 = computeSha256(buf2);
    const hash3 = computeSha256(buf3);

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
  });

  test("uploadToStorage and downloadFromStorage persist and retrieve binaries", async () => {
    const testPath = "test-docs/sample-pricing.txt";
    const sampleContent = Buffer.from("Site24x7 Pro Tier: ₹3,000/mo includes 20 basic monitors.");

    const uploadRes = await uploadToStorage(testPath, sampleContent, "text/plain");
    assert.equal(uploadRes.success, true);

    const downloaded = await downloadFromStorage(testPath);
    assert.ok(downloaded);
    assert.equal(downloaded.toString("utf-8"), sampleContent.toString("utf-8"));

    const deleted = await deleteFromStorage(testPath);
    assert.equal(deleted, true);
  });

  test("extractDocumentContent parses plain text and markdown into chunked blocks", async () => {
    const markdownContent = Buffer.from(
      "# Site24x7 Monitoring Entitlements\n\n" +
      "## Basic Monitors\n" +
      "Basic monitors include HTTP, HTTPS, Ping, DNS, and SSL certificate checks.\n\n" +
      "## Advanced Monitors\n" +
      "Advanced monitors cover Web Page Speed, Real Browser Synthetic Transactions, and REST API monitoring.\n"
    );

    const result = await extractDocumentContent(markdownContent, "entitlements.md", "text/markdown");
    assert.equal(result.success, true);
    assert.ok(result.chunks.length > 0);
    assert.ok(result.chunks[0]?.content.includes("Site24x7 Monitoring Entitlements"));
  });

  test("extractDocumentContent parses CSV spreadsheet into structured tabular chunks", async () => {
    const csvContent = Buffer.from(
      "Plan,Monthly INR,Annual INR,Basic Monitors,Advanced Monitors\n" +
      "Lite,600,7200,5,1\n" +
      "Professional,3000,36000,20,5\n" +
      "Enterprise,7500,90000,50,10\n"
    );

    const result = await extractDocumentContent(csvContent, "site24x7_plans.csv", "text/csv");
    assert.equal(result.success, true);
    assert.ok(result.chunks.length > 0);
    assert.ok(result.chunks[0]?.content.includes("Columns: Plan | Monthly INR"));
    assert.ok(result.chunks[0]?.content.includes("Professional | 3000 | 36000"));
  });

  test("ingestKnowledgeDocument indexes document, chunks, and detects duplicates", async () => {
    const docBuffer = Buffer.from(
      "=== Official Site24x7 2026 Rate Card ===\n" +
      "Enterprise Plus Plan: Starting at INR 15,000 per month.\n" +
      "Includes 100 Basic Monitors, 25 Advanced Synthetic Monitors, and 500 RUM pageviews.\n" +
      "Additional Advanced Monitor packs: INR 1,500 per pack of 10 monitors.\n"
    );

    const filename = "rate_card_2026.txt";
    const { document, chunksCount, error } = await ingestKnowledgeDocument({
      filename,
      buffer: docBuffer,
      mimeType: "text/plain",
      category: "pricing",
      version: 1,
      uploadedBy: "test-admin",
    });

    assert.equal(error, undefined);
    assert.equal(document.name, filename);
    assert.equal(document.category, "pricing");
    assert.equal(document.status, "ready");
    assert.ok(chunksCount > 0);

    // Verify duplicate detection
    const duplicate = await findDuplicateDocument(document.sha256);
    assert.ok(duplicate);
    assert.equal(duplicate.id, document.id);

    // Search for indexed content
    const searchHits = await searchKnowledgeBase("Enterprise Plus Advanced Synthetic", {
      category: "pricing",
    });
    assert.ok(searchHits.length > 0);
    assert.equal(searchHits[0]?.documentId, document.id);
    assert.ok(searchHits[0]?.content.includes("Enterprise Plus Plan"));

    // Clean up
    await deleteKnowledgeDocument(document.id);
  });

  test("findCitationsForLineItem returns verified citation when document matches", async () => {
    // Ingest a policy document
    const policyBuffer = Buffer.from(
      "Site24x7 High Availability SLA Policy\n" +
      "Guarantees 99.95% monitoring uptime for all active probe locations globally.\n" +
      "All Enterprise plans receive priority 24/7 phone support and enterprise SLA guarantees.\n"
    );

    const { document } = await ingestKnowledgeDocument({
      filename: "sla_policy.txt",
      buffer: policyBuffer,
      mimeType: "text/plain",
      category: "policies",
      version: 1,
    });

    const citation = await findCitationsForLineItem({
      field: "sla_guarantee",
      name: "High Availability SLA Policy",
      category: "policies",
    });

    assert.ok(citation);
    assert.equal(citation.documentId, document.id);
    assert.equal(citation.verificationStatus, "verified");

    // Clean up
    await deleteKnowledgeDocument(document.id);
  });

  test("enrichQuoteWithKnowledgeCitations populates source citations on a quote", async () => {
    const dummyQuote: Quote = {
      id: "qt_test_100",
      threadId: "th_test",
      requirementProfileId: "prof_test",
      catalogueVersionId: "cat_2026",
      catalogueVersion: "2026.04",
      calculationVersion: "1.0",
      status: "validated",
      pricingStatus: "authorized",
      market: "IN",
      currency: "INR",
      billingPeriod: "annual",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      options: [
        {
          id: "opt_1",
          quoteId: "qt_test_100",
          optionType: "best_value",
          planId: "plan_professional",
          planName: "Professional",
          rankReason: "Best fit",
          subtotal: 3600000,
          taxTotal: null,
          total: 3600000,
          valid: true,
          unavailabilityReason: null,
          lineItems: [
            {
              id: "li_1",
              ruleId: "RULE-PLAN-BASE",
              description: "Professional Annual Subscription",
              quantity: 1,
              unit: "subscription",
              unitPrice: 3600000,
              lineTotal: 3600000,
              includedQuantity: null,
              sourceId: "plan_professional",
            },
          ],
          coverage: [],
          headroomNotes: [],
        },
      ],
      assumptions: [],
      exclusions: [],
      calculationTrace: [],
      integrityChecks: [],
      documents: [],
      optionCountNote: null,
    };

    const enriched = await enrichQuoteWithKnowledgeCitations(dummyQuote);
    assert.ok(enriched.sourceCitations);
    assert.ok(enriched.sourceCitations.length >= 2); // Plan + Line item
    assert.equal(enriched.sourceCitations[0]?.quoteId, "qt_test_100");
  });
});
