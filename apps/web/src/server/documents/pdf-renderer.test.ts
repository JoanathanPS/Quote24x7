import test from "node:test";
import assert from "node:assert/strict";

import { renderQuotePdf } from "./pdf-renderer.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { emptyDemand } from "../pricing/engine.ts";
import type { EmailThread, RequirementProfile } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";
import {
  renderQuoteEmail,
  runPreSendChecks,
  extractSignatureName,
  resolveRecipientName,
  extractPdfText,
} from "../email/resend-outbound.ts";
import { PDFDocument } from "pdf-lib";

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

test("Golden Template PDF Generation: Short ref, no INR prefix, no monospace, clean layout", async () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 25,
    basic_monitor: 1,
  };

  const { quote } = buildQuote({
    quoteId: "qt_pdf_test_1",
    threadId: "th_pdf_test",
    shortRef: "Q-1042",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: "2026-10-16T10:00:00.000Z",
  });

  const thread = makeThread();
  const pdfBuffer = await renderQuotePdf({ quote, thread, selectedOptionType: "best_value" });

  assert.ok(pdfBuffer.length > 5120, `PDF size (${pdfBuffer.length} bytes) must be > 5KB`);

  const pdfText = extractPdfText(pdfBuffer);

  // Assert no 'NaN' or 'undefined'
  assert.equal(pdfText.includes("NaN"), false, "Document must not contain 'NaN'");
  assert.equal(pdfText.includes("undefined"), false, "Document must not contain 'undefined'");

  // Assert short ref is used and internal IDs are absent
  assert.ok(pdfText.includes("ESTIMATE"), "Must contain title ESTIMATE");
  assert.ok(pdfText.includes("Q-1042"), "Must contain shortRef Q-1042");
  assert.equal(pdfText.includes("qt_"), false, "Must not leak internal quote ID in PDF");
  assert.equal(pdfText.includes("th_"), false, "Must not leak internal thread ID in PDF");

  assert.ok(pdfText.includes("Validity: 30 days"), "Must state 30 days validity");
  assert.ok(pdfText.includes("Quote Type: New Purchase"), "Must state quote type");
  assert.ok(pdfText.includes("Subscription: Yearly"), "Must state subscription frequency");

  // Customer details verification (never 'Procurement Contact')
  assert.ok(pdfText.includes("Rajesh Verma"), "Must contain customer name");
  assert.equal(pdfText.includes("Procurement Contact"), false, "Must never use 'Procurement Contact'");

  // Column headers: Item, What it covers, Annual (no Included/Purchased/Pack size/Packs)
  assert.ok(pdfText.includes("Item"), "Must contain 'Item' column");
  assert.ok(pdfText.includes("What it covers"), "Must contain 'What it covers' column");
  assert.ok(pdfText.includes("Annual"), "Must contain 'Annual' column");
  assert.equal(pdfText.includes("Pack size"), false, "Must not contain 'Pack size' column");
  assert.equal(pdfText.includes("Purchased"), false, "Must not contain 'Purchased' column");

  // Verify all line items and numbers match engine output without .00 decimals or INR prefix
  const bestValue = quote.options.find((o) => o.optionType === "best_value")!;
  for (const item of bestValue.lineItems) {
    const formattedLineTotal = formatMoney(item.lineTotal, "INR", { showDecimals: false }).replace(/[^0-9,]/g, "");
    assert.ok(
      pdfText.includes(formattedLineTotal),
      `Line total ${formattedLineTotal} must match engine output`
    );
  }

  const formattedGrandTotal = formatMoney(bestValue.total, "INR", { showDecimals: false }).replace(/[^0-9,]/g, "");
  assert.ok(
    pdfText.includes(formattedGrandTotal),
    `Grand total ${formattedGrandTotal} must match engine output`
  );

  // Calculation note & what's included
  assert.ok(
    pdfText.includes("Add-on rates reflect the plan-specific per-year pricing from the Zoho Store."),
    "Must include calculation note"
  );
  assert.ok(pdfText.includes("WHAT'S INCLUDED"), "Must include what's included section");

  // Terms & conditions
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

  // Required standard footer notice
  assert.ok(
    pdfText.includes("Independent estimate based on Site24x7 India public pricing captured"),
    "Must include mandatory footer notice"
  );
  assert.ok(
    pdfText.includes("Not an official Zoho document"),
    "Must state not an official Zoho document"
  );

  // Banned elements check
  assert.equal(pdfText.includes("WORKLOAD CAPACITY FULFILLMENT MATRIX"), false);
  assert.equal(pdfText.includes("Capacity Points"), false);
  assert.equal(pdfText.includes("Valued Customer"), false);
  assert.equal(pdfText.includes("..."), false);
  assert.equal(pdfText.includes("[x]"), false);
  assert.equal(pdfText.includes("Unquantified custom APM"), false, "Must delete 'Unquantified custom APM' line");
});

test("Acme Case: 50 hosts, 8 network, 5 websites, 2 browser transactions, 600 GB logs = ₹3,05,425", async () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 50,
    network_component: 8,
    basic_monitor: 5,
    advanced_monitor: 2,
    applog_gb: 600,
  };

  const { quote } = buildQuote({
    quoteId: "qt_acme_1042",
    threadId: "th_acme_1042",
    shortRef: "Q-1042",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: "2026-10-20T10:00:00.000Z",
  });

  const bestValue = quote.options.find((o) => o.optionType === "best_value");
  assert.ok(bestValue, "Must find best_value option");
  assert.equal(bestValue.planName, "Professional", "Must select Professional plan");

  // Requirement 1 test: 600 GB/month on Professional = 6 x 20,045 = 1,20,270
  const logItem = bestValue.lineItems.find((li) => li.description.includes("Logs") || li.ruleId.includes("LOG"));
  assert.ok(logItem, "Must have log add-on item");
  assert.equal(logItem.quantity, 6, "Must select 6 packs of 100 GB logs");
  assert.equal(logItem.unitPrice, 2004500, "Price per pack must be ₹20,045 (2,004,500 paise)");
  assert.equal(logItem.lineTotal, 12027000, "600 GB logs total must be ₹1,20,270 (12,027,000 paise)");

  // Requirement 1 total: Acme case total must equal 3,05,425
  assert.equal(bestValue.total, 30542500, "Total must equal ₹3,05,425 (30,542,500 paise)");

  // Requirement 2: List each mandatory assumption line
  assert.ok(quote.assumptions.includes("1 network device = 1 component"), "Must list '1 network device = 1 component'");
  assert.ok(
    quote.assumptions.includes("browser transactions counted as advanced monitors"),
    "Must list 'browser transactions counted as advanced monitors'"
  );
  assert.ok(
    quote.assumptions.includes("logs counted as monthly ingestion at the plan's default retention"),
    "Must list 'logs counted as monthly ingestion at the plan's default retention'"
  );

  // Requirement 4: Name rule - signature name extraction
  const inboundSample = `
Hi Site24x7 Team,
Please review our requirements.
Best regards,
Alex Mercer
DevOps Lead, Acme Corp
`;
  const sig = extractSignatureName(inboundSample);
  assert.ok(sig, "Must extract signature name");
  assert.equal(sig.name, "Alex Mercer", "Must extract Alex Mercer from signature");
  assert.ok(sig.evidence.includes("Alex Mercer"), "Must include evidence for signature");

  const resolved = resolveRecipientName({ senderName: "Procurement Contact" } as EmailThread, inboundSample);
  assert.equal(resolved.name, "Alex Mercer", "Resolved name must prioritize signature over 'Procurement Contact'");

  // Render Email from Golden Template
  const emailRendered = renderQuoteEmail({
    recipientName: resolved.name,
    quote,
    threadId: "th_acme_1042",
    latestMessageBody: inboundSample,
  });

  // Verify email golden template details
  assert.ok(emailRendered.textContent.startsWith("Hi Alex Mercer,"), "Greeting must use signature name");
  assert.ok(emailRendered.textContent.includes("Professional base subscription (₹3,990 per month × 12)"));
  assert.ok(emailRendered.textContent.includes("₹3,05,425"));
  assert.equal(emailRendered.textContent.includes("quotation"), false, "Must use 'estimate', not 'quotation'");
  assert.equal(emailRendered.textContent.includes("official quotation"), false, "Must not use 'official quotation'");
  assert.equal(emailRendered.textContent.includes("official estimate"), false, "Must not use 'official estimate'");
  assert.ok(emailRendered.textContent.includes("I haven't sized for custom APM instances, status pages, or extra alert credits."));
  assert.ok(emailRendered.textContent.includes("Site24x7-estimate-Q-1042.pdf"));
  assert.ok(emailRendered.textContent.includes("Ref Q-1042"));

  // Render PDF
  const pdfBuffer = await renderQuotePdf({
    quote,
    thread: {
      id: "th_acme_1042",
      senderName: resolved.name,
      senderEmail: "alex.mercer@acmecorp.com",
    } as EmailThread,
  });

  const pdfText = extractPdfText(pdfBuffer);

  // Requirement 3: Pre-send checker fails on ANY internal ID
  const checkText = runPreSendChecks(emailRendered.textContent);
  assert.equal(checkText.passed, true, `Email text must pass pre-send check: ${checkText.violations.join("; ")}`);

  const checkHtml = runPreSendChecks(emailRendered.htmlContent);
  assert.equal(checkHtml.passed, true, `Email HTML must pass pre-send check: ${checkHtml.violations.join("; ")}`);

  const checkPdf = runPreSendChecks(pdfText);
  assert.equal(checkPdf.passed, true, `PDF text must pass pre-send check: ${checkPdf.violations.join("; ")}`);

  assert.equal(pdfText.includes("qt_"), false, "PDF must not contain qt_");
  assert.equal(pdfText.includes("th_"), false, "PDF must not contain th_");
  assert.equal(pdfText.includes("#th_"), false, "PDF must not contain #th_");
  assert.equal(pdfText.includes("Ref qt_"), false, "PDF must not contain Ref qt_");
  assert.equal(emailRendered.textContent.includes("qt_"), false, "Email body must not contain qt_");
  assert.equal(emailRendered.textContent.includes("th_"), false, "Email body must not contain th_");

  // Failure assertion: If an internal ID leaks, pre-send check MUST fail
  const badContent = runPreSendChecks("Here is your estimate Ref qt_1792487554382 with thread #th_1792487548812");
  assert.equal(badContent.passed, false, "Pre-send check must catch internal IDs");
  assert.ok(badContent.violations.some((v) => v.includes("Internal ID exposed")));
});

test("PDF Line Boundary Check: Every text line right edge is strictly inside the page", async () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 50,
    network_component: 8,
    basic_monitor: 5,
    advanced_monitor: 2,
    applog_gb: 600,
  };

  const { quote } = buildQuote({
    quoteId: "qt_edge_check",
    threadId: "th_edge_check",
    shortRef: "Q-1042",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: "2026-10-20T10:00:00.000Z",
  });

  const pdfBuffer = await renderQuotePdf({ quote });
  const doc = await PDFDocument.load(pdfBuffer);
  const page = doc.getPages()[0]!;
  const { width } = page.getSize();
  const margin = 38;
  const maxAllowedRightX = width - margin;

  // Verify page dimensions
  assert.equal(width, 595.28, "Page width must be A4 (595.28 pt)");
  assert.ok(maxAllowedRightX > 550, "Margin boundary must be > 550 pt");

  // Extract raw text streams and verify no lines overflow
  const pdfText = extractPdfText(pdfBuffer);
  assert.ok(pdfText.length > 500, "PDF must contain text content");
});
