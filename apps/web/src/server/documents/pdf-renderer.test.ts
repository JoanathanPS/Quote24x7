import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { renderQuotePdf } from "./pdf-renderer.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { emptyDemand } from "../pricing/engine.ts";
import type { EmailThread, RequirementProfile } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";

function extractPdfText(buffer: Buffer): string {
  let fullText = buffer.toString("latin1");
  let pos = 0;
  while ((pos = fullText.indexOf("stream", pos)) !== -1) {
    let start = pos + 6;
    if (fullText[start] === "\r") start++;
    if (fullText[start] === "\n") start++;
    const end = fullText.indexOf("endstream", start);
    if (end !== -1) {
      let realEnd = end;
      if (fullText[realEnd - 1] === "\n") realEnd--;
      if (fullText[realEnd - 1] === "\r") realEnd--;
      const slice = buffer.subarray(start, realEnd);
      let inflated = "";
      try {
        inflated = zlib.inflateSync(slice).toString("latin1");
      } catch {
        try {
          inflated = zlib.unzipSync(slice).toString("latin1");
        } catch {
          // non-deflate stream
        }
      }
      if (inflated) {
        const decoded = inflated.replace(/<([0-9A-Fa-f]+)>/g, (_, hex) => {
          return Buffer.from(hex, "hex").toString("latin1");
        });
        fullText += "\n" + decoded;
      }
      pos = end + 9;
    } else {
      pos = start;
    }
  }
  return fullText;
}

const catalogue = loadActiveCatalogue();

function makeProfile(): RequirementProfile {
  return {
    id: "prof_pdf_test",
    threadId: "th_pdf_test",
    version: 1,
    supersedesProfileId: null,
    createdAt: "2026-10-16T10:00:00.000Z",
    extractorModel: "test",
    extractorRunId: null,
    fields: [],
    summary: "Test profile for PDF generation",
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };
}

function makeThread(): EmailThread {
  return {
    id: "th_pdf_test",
    provider: "resend",
    providerThreadId: "msg_test_123",
    senderEmail: "infra.lead@enterprise-client.in",
    senderName: "Rajesh Verma",
    organisation: "Enterprise Client India Pvt Ltd",
    subject: "Quotation for 25 Servers",
    status: "pricing",
    requestType: "quote",
    createdAt: "2026-10-16T10:00:00.000Z",
    updatedAt: "2026-10-16T10:00:00.000Z",
    lastMessageAt: "2026-10-16T10:00:00.000Z",
    messageCount: 1,
    quoteId: "qt_pdf_test_1",
    quoteTotal: null,
    currency: "INR",
    statusDetail: null,
  };
}

test("Phase 9 - PDF Generation: Render PDF, assert byte size > 5KB, no NaN or undefined", async () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 25,
    basic_monitor: 1,
  };

  const { quote } = buildQuote({
    quoteId: "qt_pdf_test_1",
    threadId: "th_pdf_test",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const thread = makeThread();
  const pdfBuffer = await renderQuotePdf({ quote, thread, selectedOptionType: "best_value" });

  // 1. Assert byte size > 5KB
  assert.ok(pdfBuffer.length > 5120, `PDF size (${pdfBuffer.length} bytes) must be > 5KB`);

  // 2. Parse text back from PDF buffer
  const pdfText = extractPdfText(pdfBuffer);

  // 3. Assert no 'NaN' or 'undefined' in the document
  assert.equal(pdfText.includes("NaN"), false, "Document must not contain 'NaN'");
  assert.equal(pdfText.includes("undefined"), false, "Document must not contain 'undefined'");

  // 4. Header metadata verification
  assert.ok(pdfText.includes("ESTIMATE"), "Must contain title ESTIMATE");
  assert.ok(pdfText.includes(quote.id), "Must contain quote ID");
  assert.ok(pdfText.includes(thread.id), "Must contain thread ID");
  assert.ok(pdfText.includes("Validity: 30 days"), "Must state 30 days validity");
  assert.ok(pdfText.includes("Quote Type: New Purchase"), "Must state quote type");
  assert.ok(pdfText.includes("Subscription: Yearly"), "Must state subscription frequency");

  // 5. Customer details verification
  assert.ok(pdfText.includes("Rajesh Verma"), "Must contain customer name");
  assert.ok(pdfText.includes("Enterprise Client India Pvt Ltd"), "Must contain organisation");
  assert.ok(pdfText.includes("infra.lead@enterprise-client.in"), "Must contain email");

  // 6. Required column headers
  assert.ok(pdfText.includes("Item"), "Must contain 'Item' column");
  assert.ok(pdfText.includes("Included"), "Must contain 'Included' column");
  assert.ok(pdfText.includes("Purchased"), "Must contain 'Purchased' column");
  assert.ok(pdfText.includes("Pack size"), "Must contain 'Pack size' column");
  assert.ok(pdfText.includes("Packs"), "Must contain 'Packs' column");
  assert.ok(pdfText.includes("Annual (INR)"), "Must contain 'Annual (INR)' column");

  // 7. Verify all line items and numbers match engine output
  const bestValue = quote.options.find((o) => o.optionType === "best_value")!;
  for (const item of bestValue.lineItems) {
    const formattedLineTotal = formatMoney(item.lineTotal, "INR").replace(/₹/g, "INR ");
    assert.ok(
      pdfText.includes(formattedLineTotal),
      `Line total ${formattedLineTotal} must match engine output`
    );
  }

  const formattedGrandTotal = formatMoney(bestValue.total, "INR").replace(/₹/g, "INR ");
  assert.ok(
    pdfText.includes(formattedGrandTotal),
    `Grand total ${formattedGrandTotal} must match engine output`
  );

  // 8. Transparent calculation note & what's included
  assert.ok(
    pdfText.includes("Add-on rates reflect the plan-specific per-year pricing from the Zoho Store."),
    "Must include calculation note"
  );
  assert.ok(pdfText.includes("WHAT'S INCLUDED"), "Must include what's included section");

  // 9. Terms & conditions from quote.png verbatim
  assert.ok(
    pdfText.includes("Validity prices are open for acceptance for 30 days from quote date"),
    "Must include quote.png validity clause"
  );
  assert.ok(
    pdfText.includes("Payment Terms 100% due to ZOHO Corp after downloading the software with an official software key that is provided by ZOHO Corp"),
    "Must include quote.png payment terms"
  );
  assert.ok(
    pdfText.includes("Cost is in INR unless specified. Local Taxes extra as applicable"),
    "Must include quote.png tax terms"
  );
  assert.ok(
    pdfText.includes("https://www.site24x7.com/privacypolicy.html"),
    "Must include privacy policy link from quote.png"
  );

  // 10. Required footer notice
  assert.ok(
    pdfText.includes("Independent estimate based on Site24x7 India public pricing captured"),
    "Must include mandatory footer notice"
  );
  assert.ok(
    pdfText.includes("Not an official Zoho document"),
    "Must state not an official Zoho document"
  );

  // 11. Banned elements check (Phase 9 and 11 rule 15)
  assert.equal(
    pdfText.includes("WORKLOAD CAPACITY FULFILLMENT MATRIX"),
    false,
    "Capacity matrix must be completely dropped"
  );
  assert.equal(
    pdfText.includes("Capacity Points"),
    false,
    "Capacity points abstraction must not exist in document"
  );
  assert.equal(
    pdfText.includes("Valued Customer"),
    false,
    "Document must never contain 'Valued Customer'"
  );
  assert.equal(
    pdfText.includes("..."),
    false,
    "Document must not contain '...' truncation"
  );
  assert.equal(
    pdfText.includes("[x]"),
    false,
    "Document must not contain '[x]'"
  );
});

test("Phase 9 - Deterministic PDF bytes for identical input", async () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 15,
    network_component: 5,
    rum_pageview: 500000,
  };

  const { quote } = buildQuote({
    quoteId: "qt_pdf_determ_1",
    threadId: "th_pdf_determ",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: "2026-10-16T12:00:00.000Z",
  });

  const thread = makeThread();

  const buffer1 = await renderQuotePdf({ quote, thread });
  const buffer2 = await renderQuotePdf({ quote, thread });

  assert.equal(buffer1.length, buffer2.length, "Byte length must match exactly");
  assert.deepEqual(buffer1, buffer2, "Rendered PDF bytes must be bit-for-bit deterministic");
});

test("Phase 9 - PDF Generation across multiple test quotes", async () => {
  const testCases = [
    { name: "Minimal demand", demand: { ...emptyDemand(), host_monitor: 1 } },
    {
      name: "Complex demand",
      demand: {
        ...emptyDemand(),
        host_monitor: 50,
        basic_monitor: 20,
        advanced_monitor: 4,
        network_component: 10,
        rum_pageview: 2000000,
        applog_gb: 50,
      },
    },
  ];

  for (const tc of testCases) {
    const { quote } = buildQuote({
      quoteId: `qt_${Date.now()}_tc`,
      threadId: "th_test_tc",
      profile: makeProfile(),
      demand: tc.demand,
      catalogue,
      createdAt: "2026-10-16T12:00:00.000Z",
    });

    const buf = await renderQuotePdf({ quote });
    assert.ok(buf.length > 5120, `PDF for ${tc.name} must be > 5KB (was ${buf.length})`);

    const text = extractPdfText(buf);
    assert.equal(text.includes("NaN"), false, `PDF for ${tc.name} must not contain NaN`);
    assert.equal(text.includes("undefined"), false, `PDF for ${tc.name} must not contain undefined`);
    assert.equal(text.includes("Valued Customer"), false);
    assert.equal(text.includes("..."), false);
    assert.equal(text.includes("[x]"), false);
  }
});
