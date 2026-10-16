import test from "node:test";
import assert from "node:assert/strict";

import {
  renderClarificationEmail,
  renderQuoteEmail,
  extractClarificationQuestions,
} from "./resend-outbound.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { buildQuote } from "../pricing/quote-builder.ts";
import { emptyDemand } from "../pricing/engine.ts";
import type { RequirementProfile } from "@/types/domain";
import { formatMoney } from "../pricing/money.ts";

const catalogue = loadActiveCatalogue();

function makeProfile(fields: RequirementProfile["fields"] = []): RequirementProfile {
  return {
    id: "prof_test",
    threadId: "th_test",
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "test",
    extractorRunId: null,
    fields,
    summary: "Test profile",
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
  };
}

test("Phase 8 - Clarification Template: Word count strictly < 120 words", () => {
  const cases = [
    {
      name: "Rajesh Verma",
      questions:
        "1. How many servers (Linux, Windows, or VMs) do you need to monitor?\n2. How many websites, URLs, or API endpoints do you need to check?",
    },
    {
      name: null,
      questions:
        "• How many servers do you have?\n• Do you need synthetic checks?\n• What is your expected monthly log volume in GB?",
    },
    {
      name: "Deepak",
      questions:
        "Please specify your total Linux and Windows application server count, database instances, and network components across all data centers.",
    },
  ];

  for (const c of cases) {
    const { textContent, wordCount } = renderClarificationEmail({
      recipientName: c.name,
      questionText: c.questions,
      threadId: "th_test_clar",
    });

    assert.ok(
      wordCount < 120,
      `Word count (${wordCount}) must be strictly under 120 words for case "${c.name ?? "anonymous"}"`
    );
    assert.equal(wordCount, textContent.split(/\s+/).filter(Boolean).length);
  }
});

test("Phase 8 - Clarification Template: Zero prices anywhere in the body", () => {
  const { textContent, htmlContent } = renderClarificationEmail({
    recipientName: "Anita Sharma",
    questionText:
      "1. How many servers do you plan to monitor?\n2. How many website endpoints require uptime monitoring?",
    threadId: "th_test_no_prices",
  });

  // Must not contain any currency symbols, paise, or price figures
  assert.equal(textContent.includes("₹"), false, "Plain text must not contain ₹");
  assert.equal(textContent.includes("Rs"), false, "Plain text must not contain Rs");
  assert.equal(textContent.includes("INR"), false, "Plain text must not contain INR");
  assert.equal(textContent.includes("paise"), false, "Plain text must not contain paise");
  assert.equal(/\$\d+/.test(textContent), false, "Plain text must not contain dollar amounts");

  assert.equal(htmlContent.includes("₹"), false, "HTML must not contain ₹");
  assert.equal(htmlContent.includes("Rs"), false, "HTML must not contain Rs");
  assert.equal(htmlContent.includes("INR"), false, "HTML must not contain INR");
  assert.equal(htmlContent.includes("paise"), false, "HTML must not contain paise");
});

test("Phase 8 - Clarification Template: At most 3 numbered questions and polite greeting", () => {
  // Pass 5 questions to test capping at 3
  const rawQuestions = [
    "1. How many servers?",
    "2. How many websites?",
    "3. How many network devices?",
    "4. How many log gigabytes?",
    "5. How many RUM pageviews?",
  ].join("\n");

  const { textContent, htmlContent } = renderClarificationEmail({
    recipientName: "Vikram Malhotra",
    questionText: rawQuestions,
    threadId: "th_test_numbered",
  });

  // Greeting
  assert.ok(textContent.startsWith("Hi Vikram Malhotra,"));
  assert.ok(htmlContent.includes("Hi Vikram Malhotra,"));

  // Numbered questions in text: 1., 2., 3. and NOT 4. or 5.
  assert.ok(textContent.includes("1. How many servers?"));
  assert.ok(textContent.includes("2. How many websites?"));
  assert.ok(textContent.includes("3. How many network devices?"));
  assert.equal(textContent.includes("4. How many log"), false);
  assert.equal(textContent.includes("5. How many RUM"), false);

  // HTML ordered list
  assert.ok(htmlContent.includes("<ol>"));
  assert.ok(htmlContent.includes("</ol>"));
  assert.ok(htmlContent.includes("How many servers?"));
});

test("Phase 8 - extractClarificationQuestions: cleans bullets, numbers, and caps at maxQuestions", () => {
  const raw = "• 10 servers\n- 5 websites\n3. 2 apps\n4. extra item";
  const extracted = extractClarificationQuestions(raw, 3);
  assert.deepEqual(extracted, ["10 servers", "5 websites", "2 apps"]);
});

test("Phase 8 - Quote Template: Complete itemized breakdown, transparent cadence, and exact numbers matching engine", () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 25,
    basic_monitor: 1,
  };

  const { quote } = buildQuote({
    quoteId: "qt_test_template_1",
    threadId: "th_test_quote",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: new Date().toISOString(),
  });

  assert.ok(quote.options.length >= 2, "Should have best_value and lowest_cost");
  const bestValue = quote.options.find((o) => o.optionType === "best_value")!;
  const lowestCost = quote.options.find((o) => o.optionType === "lowest_cost")!;

  const { textContent, htmlContent } = renderQuoteEmail({
    recipientName: "Rajesh Verma",
    quote,
    threadId: "th_test_quote",
  });

  // 1. Polite greeting with buyer name
  assert.ok(textContent.includes("Hi Rajesh Verma,"));
  assert.ok(htmlContent.includes("Hi Rajesh Verma,"));

  // 2. Summary of understood requirements
  assert.ok(textContent.includes("Summary of understood requirements:"));
  assert.ok(textContent.includes("Host monitors: 25"));
  assert.ok(htmlContent.includes("Host monitors: 25"));

  // 3. Selected plan name and exact cadence string
  assert.ok(textContent.includes(`Selected plan: ${bestValue.planName}`));
  const plan = catalogue.plans.find((p) => p.id === bestValue.planId)!;
  const planMonthlyPaise = plan.priceMonthlyAnnualBilled ?? plan.basePrice;
  const expectedCadence = `annual upfront, quoted as equivalent per-month rate of ${planMonthlyPaise} paise plus add-ons; total billed today is ${formatMoney(bestValue.total, "INR")}`;
  assert.ok(
    textContent.includes(expectedCadence),
    `Must contain exact cadence string: ${expectedCadence}`
  );
  assert.ok(htmlContent.includes(expectedCadence));

  // 4. Itemized table: Plan base + each add-on with all 6 columns
  assert.ok(textContent.includes("Itemized Pricing Table:"));
  assert.ok(textContent.includes("Item | Included Units | Purchased Units | Pack Size | Pack Count | Line Total"));
  for (const item of bestValue.lineItems) {
    const formattedLineTotal = formatMoney(item.lineTotal, "INR");
    assert.ok(
      textContent.includes(formattedLineTotal),
      `Line total ${formattedLineTotal} must appear in text table`
    );
    assert.ok(
      htmlContent.includes(formattedLineTotal),
      `Line total ${formattedLineTotal} must appear in HTML table`
    );
  }

  // Exact numbers match engine output: sum of line items equals total billed today
  const computedSum = bestValue.lineItems.reduce((acc, item) => acc + item.lineTotal, 0);
  assert.equal(computedSum, bestValue.total, "Line items sum must exactly equal option total");
  assert.ok(textContent.includes(`Total Billed Today: ${formatMoney(bestValue.total, "INR")}`));
  assert.ok(htmlContent.includes(formatMoney(bestValue.total, "INR")));

  // 5. Transparent calculation note verbatim
  const expectedNote = "Add-on rates reflect the plan-specific per-year pricing from the Zoho Store.";
  assert.ok(textContent.includes(expectedNote), "Calculation note must be verbatim in text");
  assert.ok(htmlContent.includes(expectedNote), "Calculation note must be verbatim in HTML");

  // 6. Comparison line verbatim when applicable
  const expectedComparison = `A lighter configuration on ${lowestCost.planName} would cost ${formatMoney(lowestCost.total, "INR")}, but leaves no headroom for`;
  assert.ok(
    textContent.includes(expectedComparison),
    `Comparison line must be present in text: ${expectedComparison}`
  );
  assert.ok(
    htmlContent.includes(expectedComparison),
    `Comparison line must be present in HTML: ${expectedComparison}`
  );

  // 7. Mention official quotation PDF is attached
  const expectedPdfNotice = `Quote24x7-Proposal-${quote.id}.pdf`;
  assert.ok(textContent.includes(expectedPdfNotice), "PDF attachment name must appear in text");
  assert.ok(htmlContent.includes(expectedPdfNotice), "PDF attachment name must appear in HTML");

  // 8. Disclaimer
  const expectedDisclaimer =
    "Disclaimer: quotes generated against current Site24x7 India pricing and final checkout occurs via Zoho Store.";
  assert.ok(textContent.includes(expectedDisclaimer), "Disclaimer must appear in text");
  assert.ok(htmlContent.includes(expectedDisclaimer), "Disclaimer must appear in HTML");

  // 9. Prompt
  const expectedPrompt =
    "Reply to this email if you'd like to adjust counts, add capabilities, or change billing frequency.";
  assert.ok(textContent.includes(expectedPrompt), "Prompt must appear in text");
  assert.ok(
    htmlContent.includes("Reply to this email if") &&
      htmlContent.includes("adjust counts, add capabilities, or change billing frequency"),
    "Prompt must appear in HTML"
  );
});

test("Phase 8 - No hallucinated text: Only verified parameters and catalogue rates are rendered", () => {
  const demand = {
    ...emptyDemand(),
    host_monitor: 10,
  };

  const { quote } = buildQuote({
    quoteId: "qt_test_no_hallucinations",
    threadId: "th_test_no_hallucinations",
    profile: makeProfile(),
    demand,
    catalogue,
    createdAt: new Date().toISOString(),
  });

  const { textContent, htmlContent } = renderQuoteEmail({
    recipientName: "Sanjay",
    quote,
    threadId: "th_test_no_hallucinations",
  });

  // No hallucinated proposal page links or localhost links
  assert.equal(textContent.includes("localhost"), false);
  assert.equal(htmlContent.includes("localhost"), false);
  assert.equal(textContent.includes("/proposals/"), false);
  assert.equal(htmlContent.includes("/proposals/"), false);

  // No invented discounts or capacity points
  assert.equal(textContent.includes("Capacity Points"), false);
  assert.equal(textContent.includes("special discount"), false);
});
