import assert from "node:assert/strict";
import test from "node:test";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import {
  evaluateCandidate,
  rankOptions,
  emptyDemand,
  type PricingDemand,
} from "./engine.ts";
import { extractRequirements } from "../extraction/extractor.ts";
import { decideNextAction } from "../ai/sales-engineer.ts";
import type { AiProvider } from "../ai/gemini-provider.ts";
import type { AiDecisionOutput } from "../ai/decision-schema.ts";
import type { EmailThread } from "@/types/domain";

function mockProvider(decision: Partial<AiDecisionOutput>): AiProvider {
  return {
    name: "mock-provider",
    generateDecision: async () => ({
      ok: true,
      decision: {
        customerSummary: "Mock summary",
        reasoningSummary: "Mock reasoning",
        recommendedProductCategories: ["infrastructure_monitoring"],
        identifiedNeeds: [],
        assumptions: [],
        confidence: 0.95,
        action: "prepare_quote",
        referencedPlanIds: [],
        knownRequirements: [],
        missingRequirements: [],
        followUpQuestions: [],
        humanReviewReasons: [],
        ...decision,
      },
      model: "mock-model",
      latencyMs: 1,
      attempts: 1,
    }),
  };
}

const catalogue = loadActiveCatalogue();
const litePlan = catalogue.plans.find((p) => p.id === "plan_lite")!;
const proPlan = catalogue.plans.find((p) => p.id === "plan_professional")!;
const enterprisePlan = catalogue.plans.find((p) => p.id === "plan_enterprise")!;

test("Acceptance Test 1: 25 servers -> Lite 7980, Professional 8740 per month", () => {
  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 25,
  };

  const liteCandidate = evaluateCandidate(catalogue, litePlan, demand);
  const proCandidate = evaluateCandidate(catalogue, proPlan, demand);

  assert.equal(liteCandidate.valid, true, "Lite plan must be valid for 25 servers");
  assert.equal(
    liteCandidate.total,
    798000,
    "Lite total must be 7,980 INR/mo (798,000 paise): base 855 + 3 packs of 10 hosts (7,125)",
  );

  assert.equal(proCandidate.valid, true, "Professional plan must be valid for 25 servers");
  assert.equal(
    proCandidate.total,
    874000,
    "Professional total must be 8,740 INR/mo (874,000 paise): base 3,990 + 2 packs of 10 hosts (4,750)",
  );

  // Test natural language extraction
  const extracted = extractRequirements({
    threadId: "th_accept_1",
    senderEmail: "buyer@example.com",
    senderName: "Buyer",
    subject: "Quotation request",
    bodyText: "Hi, please give me a quotation for 25 servers.",
  });
  assert.equal(extracted.demand.host_monitor, 25);
  assert.equal(extracted.isComplete, true);

  // Test ranking
  const { options } = rankOptions([liteCandidate, proCandidate], demand, "q_accept_1");
  const lowestCost = options.find((o) => o.optionType === "lowest_cost")!;
  const bestValue = options.find((o) => o.optionType === "best_value")!;

  assert.equal(lowestCost.planId, "plan_lite");
  assert.equal(lowestCost.total, 798000);
  assert.equal(bestValue.planId, "plan_professional");
  assert.equal(bestValue.total, 874000);
  assert.ok(lowestCost.total <= bestValue.total);
});

test("Acceptance Test 2: 25 servers + 3 websites + 2 Java apps -> Lite 9405, Professional 23940 per month", () => {
  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 25,
    basic_monitor: 3,
    advanced_monitor: 2,
  };

  const liteCandidate = evaluateCandidate(catalogue, litePlan, demand);
  const proCandidate = evaluateCandidate(catalogue, proPlan, demand);

  assert.equal(liteCandidate.valid, true, "Lite plan must be valid");
  assert.equal(
    liteCandidate.total,
    940500,
    "Lite total must be 9,405 INR/mo (940,500 paise): base 855 + 3 host packs (7,125) + 1 advanced pack (1,425)",
  );

  assert.equal(proCandidate.valid, true, "Professional plan must be valid");
  assert.equal(
    proCandidate.total,
    2394000,
    "Professional total must be 23,940 INR/mo (2,394,000 paise): base 3,990 + 2 host packs (4,750) + 1 advanced 25-pack (15,200)",
  );

  // Test natural language extraction from customer inquiry
  const extracted = extractRequirements({
    threadId: "th_accept_2",
    senderEmail: "buyer@example.com",
    senderName: "Buyer",
    subject: "Quote inquiry",
    bodyText: "We need monitoring for 25 servers, 3 websites, and 2 Java apps.",
  });
  assert.equal(extracted.demand.host_monitor, 25);
  assert.equal(extracted.demand.basic_monitor, 3);
  assert.equal(extracted.demand.advanced_monitor, 2);
  assert.equal(extracted.isComplete, true);

  const liteExtracted = evaluateCandidate(catalogue, litePlan, extracted.demand);
  const proExtracted = evaluateCandidate(catalogue, proPlan, extracted.demand);
  assert.equal(liteExtracted.total, 940500);
  assert.equal(proExtracted.total, 2394000);
});

test("Boundary Tests: Lite server pack edges (included: 2, pack size 10 @ 2,375 INR)", () => {
  const cases: Array<{ hosts: number; expectedPaise: number; description: string }> = [
    { hosts: 2, expectedPaise: 85500, description: "2 servers (exact included capacity)" },
    { hosts: 3, expectedPaise: 85500 + 237500, description: "3 servers (excess 1 -> 1 pack)" },
    { hosts: 12, expectedPaise: 85500 + 237500, description: "12 servers (excess 10 -> 1 pack)" },
    { hosts: 13, expectedPaise: 85500 + 2 * 237500, description: "13 servers (excess 11 -> 2 packs)" },
    { hosts: 22, expectedPaise: 85500 + 2 * 237500, description: "22 servers (excess 20 -> 2 packs)" },
    { hosts: 23, expectedPaise: 85500 + 3 * 237500, description: "23 servers (excess 21 -> 3 packs)" },
    { hosts: 25, expectedPaise: 798000, description: "25 servers (excess 23 -> 3 packs)" },
    { hosts: 32, expectedPaise: 85500 + 3 * 237500, description: "32 servers (excess 30 -> 3 packs)" },
    { hosts: 33, expectedPaise: 85500 + 4 * 237500, description: "33 servers (excess 31 -> 4 packs)" },
  ];

  for (const c of cases) {
    const demand: PricingDemand = { ...emptyDemand(), host_monitor: c.hosts };
    const cand = evaluateCandidate(catalogue, litePlan, demand);
    assert.equal(cand.total, c.expectedPaise, `Lite failed for ${c.description}`);
  }
});

test("Boundary Tests: Professional server pack edges (included: 5, packs 10, 50, 500)", () => {
  const cases: Array<{ hosts: number; expectedPaise: number; description: string }> = [
    { hosts: 5, expectedPaise: 399000, description: "5 servers (exact included capacity)" },
    { hosts: 6, expectedPaise: 399000 + 237500, description: "6 servers (excess 1 -> 1 pack of 10)" },
    { hosts: 15, expectedPaise: 399000 + 237500, description: "15 servers (excess 10 -> 1 pack of 10)" },
    { hosts: 16, expectedPaise: 399000 + 2 * 237500, description: "16 servers (excess 11 -> 2 packs of 10)" },
    { hosts: 25, expectedPaise: 874000, description: "25 servers (excess 20 -> 2 packs of 10)" },
    { hosts: 26, expectedPaise: 399000 + 3 * 237500, description: "26 servers (excess 21 -> 3 packs of 10)" },
    { hosts: 45, expectedPaise: 399000 + 4 * 237500, description: "45 servers (excess 40 -> 4 packs of 10 = 9,500)" },
    {
      hosts: 46,
      expectedPaise: 399000 + 1045000,
      description: "46 servers (excess 41 -> knapsack picks 1 pack of 50 @ 10,450 vs 5 packs of 10 @ 11,875)",
    },
    { hosts: 50, expectedPaise: 399000 + 1045000, description: "50 servers (excess 45 -> 1 pack of 50)" },
    { hosts: 55, expectedPaise: 399000 + 1045000, description: "55 servers (excess 50 -> 1 pack of 50)" },
    {
      hosts: 56,
      expectedPaise: 399000 + 1045000 + 237500,
      description: "56 servers (excess 51 -> 1 pack of 50 + 1 pack of 10)",
    },
  ];

  for (const c of cases) {
    const demand: PricingDemand = { ...emptyDemand(), host_monitor: c.hosts };
    const cand = evaluateCandidate(catalogue, proPlan, demand);
    assert.equal(cand.total, c.expectedPaise, `Professional failed for ${c.description}`);
  }
});

test("Boundary Tests: Professional advanced monitors (included: 1, packs 25 @ 15,200, 100 @ 57,000)", () => {
  const cases: Array<{ adv: number; expectedPaise: number; description: string }> = [
    { adv: 1, expectedPaise: 399000, description: "1 monitor (exact included capacity)" },
    { adv: 2, expectedPaise: 399000 + 1520000, description: "2 monitors (excess 1 -> 1 pack of 25 @ 15,200)" },
    { adv: 26, expectedPaise: 399000 + 1520000, description: "26 monitors (excess 25 -> 1 pack of 25 @ 15,200)" },
    { adv: 27, expectedPaise: 399000 + 2 * 1520000, description: "27 monitors (excess 26 -> 2 packs of 25)" },
    {
      adv: 101,
      expectedPaise: 399000 + 5700000,
      description: "101 monitors (excess 100 -> 1 pack of 100 @ 57,000 beats 4 packs of 25 @ 60,800)",
    },
  ];

  for (const c of cases) {
    const demand: PricingDemand = { ...emptyDemand(), advanced_monitor: c.adv };
    const cand = evaluateCandidate(catalogue, proPlan, demand);
    assert.equal(cand.total, c.expectedPaise, `Professional advanced monitor failed for ${c.description}`);
  }
});

test("Rule 4: Enterprise returns handoff, never a price", () => {
  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 100,
  };

  const candidate = evaluateCandidate(catalogue, enterprisePlan, demand);
  assert.equal(candidate.valid, false, "Enterprise candidate must never be valid");
  assert.equal(candidate.isHandoff, true, "Enterprise candidate must be marked isHandoff: true");
  assert.equal(candidate.total, 0, "Enterprise total must be 0 (no automated price)");
  assert.equal(candidate.lineItems.length, 0, "Enterprise must have 0 line items");
  assert.match(candidate.unavailabilityReason ?? "", /handoff|sales consultation/i);
});

test("Rule 7: Verification status is present and verified on all plans and add-on packs", () => {
  for (const plan of catalogue.plans) {
    assert.ok(plan.verificationStatus, `Plan ${plan.id} must have verificationStatus`);
    assert.ok(
      ["public_verified", "screenshot_derived", "company_authorized", "synthetic_test"].includes(
        plan.verificationStatus,
      ),
      `Plan ${plan.id} verificationStatus must be a valid status`,
    );
  }

  for (const addOn of catalogue.addOns) {
    assert.ok(addOn.verificationStatus, `Add-on ${addOn.id} must have verificationStatus`);
    assert.ok(
      ["public_verified", "screenshot_derived", "company_authorized", "synthetic_test"].includes(
        addOn.verificationStatus,
      ),
      `Add-on ${addOn.id} verificationStatus must be a valid status`,
    );
  }
});

test("Rule 1: Decide ask vs quote with code, not the LLM", async () => {
  const now = new Date().toISOString();
  const baseThread: EmailThread = {
    id: "th_code_decision",
    provider: "resend",
    providerThreadId: "th_code_decision_p",
    senderEmail: "buyer@test.com",
    senderName: "Buyer",
    organisation: "TestOrg",
    subject: "Inquiry",
    status: "received",
    requestType: "quote",
    statusDetail: null,
    quoteId: null,
    quoteTotal: null,
    currency: "INR",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    messageCount: 1,
  };

  // Case 1: Incomplete inquiry (missing server count) -> Code deterministically chooses ask_follow_up
  const incompleteResult = await decideNextAction(
    {
      thread: baseThread,
      latestMessageText: "I want to monitor servers and website.",
      cumulativeText: "I want to monitor servers and website.",
      priorMessages: [],
      existingProfile: undefined,
      catalogue,
      senderEmail: "buyer@test.com",
      senderName: "Buyer",
      subject: "Inquiry",
    },
    mockProvider({
      action: "prepare_quote", // Model erroneously attempts to quote
      knownRequirements: [],
      missingRequirements: [{ unit: "host_monitor", whyItMatters: "Missing", blocksPricing: true }],
      followUpQuestions: ["How many servers?"],
    }),
  );

  assert.equal(
    incompleteResult.action,
    "ask_follow_up",
    "Code must enforce ask_follow_up when requirements are incomplete",
  );

  // Case 2: Complete inquiry (25 servers) -> Code deterministically chooses prepare_quote
  const completeResult = await decideNextAction(
    {
      thread: baseThread,
      latestMessageText: "We have 25 servers to monitor.",
      cumulativeText: "We have 25 servers to monitor.",
      priorMessages: [],
      existingProfile: undefined,
      catalogue,
      senderEmail: "buyer@test.com",
      senderName: "Buyer",
      subject: "Inquiry",
    },
    mockProvider({
      action: "ask_follow_up", // Model erroneously attempts to ask follow-up
      knownRequirements: [
        { unit: "host_monitor", quantity: 25, basis: "stated", evidence: "25 servers", confidence: 0.95 },
      ],
      missingRequirements: [],
      followUpQuestions: [],
    }),
  );

  assert.equal(
    completeResult.action,
    "prepare_quote",
    "Code must enforce prepare_quote when all required sizing parameters are complete",
  );
});
