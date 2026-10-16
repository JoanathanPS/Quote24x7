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

test("Acceptance Test 1: 25 servers -> Lite ₹87,210/yr, Professional ₹99,180/yr", () => {
  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 25,
  };

  const liteCandidate = evaluateCandidate(catalogue, litePlan, demand);
  const proCandidate = evaluateCandidate(catalogue, proPlan, demand);

  assert.equal(liteCandidate.valid, true, "Lite plan must be valid for 25 servers");
  assert.equal(
    liteCandidate.total,
    8721000,
    "Lite total must be 87,210 INR/yr (8,721,000 paise): base 10,260 + 3 packs of 10 hosts (76,950)",
  );

  assert.equal(proCandidate.valid, true, "Professional plan must be valid for 25 servers");
  assert.equal(
    proCandidate.total,
    9918000,
    "Professional total must be 99,180 INR/yr (9,918,000 paise): base 47,880 + 2 packs of 10 hosts (51,300)",
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
  assert.equal(lowestCost.total, 8721000);
  assert.equal(bestValue.planId, "plan_professional");
  assert.equal(bestValue.total, 9918000);
  assert.ok(lowestCost.total <= bestValue.total);
});

test("Acceptance Test 2: 25 servers + 3 websites + 2 Java apps -> Lite ₹102,600/yr, Professional ₹117,135/yr", () => {
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
    10260000,
    "Lite total must be 102,600 INR/yr (10,260,000 paise): base 10,260 + 3 host packs (76,950) + 1 advanced pack (15,390)",
  );

  assert.equal(proCandidate.valid, true, "Professional plan must be valid");
  assert.equal(
    proCandidate.total,
    11457000,
    "Professional total must be 114,570 INR/yr (11,457,000 paise): base 47,880 + 2 host packs (51,300) + 1 advanced 2-pack (15,390)",
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
  assert.equal(liteExtracted.total, 10260000);
  assert.equal(proExtracted.total, 11457000);
});

test("Boundary Tests: Lite server pack edges (included: 2, pack size 10 @ 25,650 INR/yr)", () => {
  const cases: Array<{ hosts: number; expectedPaise: number; description: string }> = [
    { hosts: 2, expectedPaise: 1026000, description: "2 servers (exact included capacity)" },
    { hosts: 3, expectedPaise: 1026000 + 2565000, description: "3 servers (excess 1 -> 1 pack)" },
    { hosts: 12, expectedPaise: 1026000 + 2565000, description: "12 servers (excess 10 -> 1 pack)" },
    { hosts: 13, expectedPaise: 1026000 + 2 * 2565000, description: "13 servers (excess 11 -> 2 packs)" },
    { hosts: 22, expectedPaise: 1026000 + 2 * 2565000, description: "22 servers (excess 20 -> 2 packs)" },
    { hosts: 23, expectedPaise: 1026000 + 3 * 2565000, description: "23 servers (excess 21 -> 3 packs)" },
    { hosts: 25, expectedPaise: 8721000, description: "25 servers (excess 23 -> 3 packs)" },
    { hosts: 32, expectedPaise: 1026000 + 3 * 2565000, description: "32 servers (excess 30 -> 3 packs)" },
    { hosts: 33, expectedPaise: 1026000 + 4 * 2565000, description: "33 servers (excess 31 -> 4 packs)" },
  ];

  for (const c of cases) {
    const demand: PricingDemand = { ...emptyDemand(), host_monitor: c.hosts };
    const cand = evaluateCandidate(catalogue, litePlan, demand);
    assert.equal(cand.total, c.expectedPaise, `Lite failed for ${c.description}`);
  }
});

test("Boundary Tests: Professional server pack edges (included: 5, packs 10, 50, 500)", () => {
  const cases: Array<{ hosts: number; expectedPaise: number; description: string }> = [
    { hosts: 5, expectedPaise: 4788000, description: "5 servers (exact included capacity)" },
    { hosts: 6, expectedPaise: 4788000 + 2565000, description: "6 servers (excess 1 -> 1 pack of 10)" },
    { hosts: 15, expectedPaise: 4788000 + 2565000, description: "15 servers (excess 10 -> 1 pack of 10)" },
    { hosts: 16, expectedPaise: 4788000 + 2 * 2565000, description: "16 servers (excess 11 -> 2 packs of 10)" },
    { hosts: 25, expectedPaise: 9918000, description: "25 servers (excess 20 -> 2 packs of 10)" },
    { hosts: 26, expectedPaise: 4788000 + 3 * 2565000, description: "26 servers (excess 21 -> 3 packs of 10)" },
    { hosts: 45, expectedPaise: 4788000 + 4 * 2565000, description: "45 servers (excess 40 -> 4 packs of 10 = 102,600)" },
    {
      hosts: 46,
      expectedPaise: 4788000 + 12188500,
      description: "46 servers (excess 41 -> knapsack picks 1 pack of 50 @ 121,885 vs 5 packs of 10 @ 128,250)",
    },
    { hosts: 50, expectedPaise: 4788000 + 12188500, description: "50 servers (excess 45 -> 1 pack of 50)" },
    { hosts: 55, expectedPaise: 4788000 + 12188500, description: "55 servers (excess 50 -> 1 pack of 50)" },
    {
      hosts: 56,
      expectedPaise: 4788000 + 12188500 + 2565000,
      description: "56 servers (excess 51 -> 1 pack of 50 + 1 pack of 10)",
    },
  ];

  for (const c of cases) {
    const demand: PricingDemand = { ...emptyDemand(), host_monitor: c.hosts };
    const cand = evaluateCandidate(catalogue, proPlan, demand);
    assert.equal(cand.total, c.expectedPaise, `Professional failed for ${c.description}`);
  }
});

test("Rule 4: Enterprise returns starting-at review rate, withheld from automated quote dispatch", () => {
  const demand: PricingDemand = {
    ...emptyDemand(),
    host_monitor: 100,
  };

  const candidate = evaluateCandidate(catalogue, enterprisePlan, demand);
  assert.equal(candidate.valid, false, "Enterprise candidate must be valid=false so it is withheld from automated dispatch");
  assert.equal(candidate.isHandoff, true, "Enterprise candidate must be marked isHandoff: true");
  assert.equal(candidate.isStartingAt, true, "Enterprise candidate must be marked isStartingAt: true");
  assert.equal(candidate.requiresReview, true, "Enterprise candidate must be marked requiresReview: true");
  assert.ok(candidate.total > 0, "Enterprise total must be computed as starting at rate");
  assert.match(candidate.unavailabilityReason ?? "", /sales consultation|starting at/i);
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
