import assert from "node:assert/strict";
import test from "node:test";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import {
  evaluateCandidate,
  rankOptions,
  runIntegrityChecks,
  applyGrowthBuffer,
  type Candidate,
  type PricingDemand,
} from "./engine.ts";
import type { QuoteOption } from "@/types/domain";

const catalogue = loadActiveCatalogue();

test("Ranking: 25 Linux servers + 1 website check correctly ranks Lowest Cost at ₹87,210/yr and Best Value at ₹99,180/yr with comparison line", () => {
  const demand: PricingDemand = {
    host_monitor: 25,
    basic_monitor: 1,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const candidates = catalogue.plans.map((p) => evaluateCandidate(catalogue, p, demand));
  const { options, rejected, comparisonLine } = rankOptions(candidates, demand, "q_rank_25");

  assert.equal(options.length, 2, "Expected 2 distinct valid options (Lite and Professional)");
  const bestValue = options.find((o) => o.optionType === "best_value");
  const lowestCost = options.find((o) => o.optionType === "lowest_cost");

  assert.ok(bestValue, "best_value must be present");
  assert.ok(lowestCost, "lowest_cost must be present");

  // Invariant 1: Lowest cost must be the absolute cheapest valid configuration (Lite at ₹87,210/yr)
  // Lite base: ₹855/mo * 12 = ₹10,260 (1,026,000 paise) + 3 packs of 10 hosts @ ₹25,650 = ₹76,950 (7,695,000 paise)
  assert.equal(lowestCost.planId, "plan_lite", "Lite must be the lowest_cost option");
  assert.equal(lowestCost.total, 8721000, "Lite total must be 87,210 INR/yr (8,721,000 paise)");

  // Invariant 2: Best value must recommend Professional at ₹99,180/yr
  // Pro base: ₹3,990/mo * 12 = ₹47,880 (4,788,000 paise) + 2 packs of 10 hosts @ ₹25,650 = ₹51,300 (5,130,000 paise)
  assert.equal(bestValue.planId, "plan_professional", "Professional must be the best_value option");
  assert.equal(bestValue.total, 9918000, "Professional total must be 99,180 INR/yr (9,918,000 paise)");

  // Invariant 3: Comparison line is generated with golden format (<Plan> costs ₹X more per year (₹Y). It adds ...)
  assert.ok(comparisonLine, "Comparison line must be present");
  assert.ok(comparisonLine.includes("Professional costs"), "Comparison line must mention Professional costs");
  assert.ok(comparisonLine.includes("₹11,970"), "Comparison line must include difference");
  assert.ok(comparisonLine.includes("₹99,180"), "Comparison line must include Professional total");

  // Invariant 4: What it adds is described on alternative
  assert.ok(bestValue.whatItAdds && bestValue.whatItAdds.length > 0, "whatItAdds must be populated on alternative");

  // Invariant 5: Enterprise is withheld from automated options and flagged for sales review
  const enterpriseRejected = rejected.find((r) => r.plan.id === "plan_enterprise");
  assert.ok(enterpriseRejected, "Enterprise must be in rejected candidates list");
  assert.equal(enterpriseRejected.isHandoff, true, "Enterprise must be marked as isHandoff: true");
  assert.equal(enterpriseRejected.isStartingAt, true, "Enterprise must be marked as isStartingAt: true");
  assert.equal(enterpriseRejected.requiresReview, true, "Enterprise must be marked as requiresReview: true");

  // Invariant 6: Lowest Cost is strictly less than or equal to Best Value
  assert.ok(
    lowestCost.total <= bestValue.total,
    `lowest_cost (${lowestCost.total}) must be <= best_value (${bestValue.total})`,
  );

  // Invariant 7: Both options are distinct plans
  const planIds = new Set(options.map((o) => o.planId));
  assert.equal(planIds.size, 2, "All options must use distinct plans");

  // Invariant 8: Integrity checks pass
  const checks = runIntegrityChecks(catalogue, options, demand);
  for (const check of checks) {
    assert.equal(check.passed, true, `Check ${check.id} must pass`);
  }
});

test("Strict Plan-Addon Isolation: A pack with no (plan, addon) row is never priced; Lite cannot buy anything the grid marks unavailable", () => {
  const litePlan = catalogue.plans.find((p) => p.id === "plan_lite")!;
  assert.ok(litePlan, "Lite plan must exist");

  // Lite only has 7 purchasable add-on packs in the Zoho Store grid:
  // addon_basic_10, addon_advanced_2, addon_host_10, addon_netcomp_10, addon_pv_500k_5, addon_logs_10gb, addon_synth_10000
  // It cannot buy addon_basic_50 (50 basic monitors), addon_host_50, or addon_advanced_25.
  const largeBasicDemand: PricingDemand = {
    host_monitor: 0,
    basic_monitor: 100, // Needs 100 basic monitors
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const liteCandidate = evaluateCandidate(catalogue, litePlan, largeBasicDemand);
  // Lite can only buy 10-packs of basic monitors.
  // Verify that it only uses addon_basic_10, never addon_basic_50 or addon_basic_500 which have no row for Lite
  for (const item of liteCandidate.lineItems) {
    if (item.ruleId === "RULE-ADDON-PACK") {
      assert.equal(
        item.id,
        "plan_lite__addon_basic_10",
        "Lite must only purchase addon_basic_10 since other basic monitor packs are not purchasable for Lite in the Store grid",
      );
    }
  }

  // Requesting advanced monitors beyond Lite's capacity with packs Lite cannot buy
  const proPlan = catalogue.plans.find((p) => p.id === "plan_professional")!;
  const proCandidate = evaluateCandidate(catalogue, proPlan, largeBasicDemand);
  // Pro has addon_basic_50 and addon_basic_500, so it can satisfy large demand using larger packs
  const proPacksUsed = proCandidate.lineItems.filter((i) => i.ruleId === "RULE-ADDON-PACK");
  assert.ok(proPacksUsed.length > 0);
  assert.ok(
    proPacksUsed.some((p) => p.id === "plan_professional__addon_basic_50" || p.id === "plan_professional__addon_basic_10"),
  );
});

test("Price differentiation: 500 basic monitors costs differently on Professional and Enterprise per the Store rows", () => {
  const proPrices = catalogue.planAddOnPrices?.["plan_professional"];
  const enterprisePrices = catalogue.planAddOnPrices?.["plan_enterprise"];

  assert.ok(proPrices, "Professional add-on prices must exist in catalogue");
  assert.ok(enterprisePrices, "Enterprise add-on prices must exist in catalogue");

  // In the Store grid:
  // 500 Basic Monitors on Professional is ₹461,700/year (46,170,000 paise)
  // 500 Basic Monitors on Enterprise is ₹738,720/year (73,872,000 paise)
  const pro500BasicPrice = proPrices["addon_basic_500"];
  const enterprise500BasicPrice = enterprisePrices["addon_basic_500"];

  assert.ok(pro500BasicPrice, "addon_basic_500 must be priced for Professional");
  assert.ok(enterprise500BasicPrice, "addon_basic_500 must be priced for Enterprise");
  assert.notEqual(
    pro500BasicPrice,
    enterprise500BasicPrice,
    "500 basic monitors MUST cost differently between Professional and Enterprise per Store rows",
  );
  assert.equal(pro500BasicPrice, 46170000, "Professional 500 basic must be 461,700 INR/yr (46,170,000 paise)");
  assert.equal(enterprise500BasicPrice, 73872000, "Enterprise 500 basic must be 738,720 INR/yr (73,872,000 paise)");
});

test("Annual basis: plan = list monthly * 12 arithmetic; add-ons use verbatim Store per-year price; MSP is quoted per month", () => {
  const litePlan = catalogue.plans.find((p) => p.id === "plan_lite")!;
  const mspPlan = catalogue.plans.find((p) => p.id === "plan_msp")!;

  assert.ok(litePlan, "Lite plan must exist");
  assert.ok(mspPlan, "MSP plan must exist");

  const emptyDem: PricingDemand = {
    host_monitor: 0,
    basic_monitor: 0,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  // Lite base price evaluation: monthly 855 * 12 = 10,260 INR (1,026,000 paise)
  const liteCand = evaluateCandidate(catalogue, litePlan, emptyDem);
  assert.equal(liteCand.total, 1026000, "Lite annual base must be 1,026,000 paise (855 × 12)");
  const liteTrace = liteCand.trace.find((t) => t.ruleId === "RULE-BASE-PRICE")!;
  assert.ok(liteTrace.computation.includes("12"), "Trace must record monthly × 12 arithmetic");

  // MSP base price evaluation: quoted per month (5,130 INR = 513,000 paise)
  const mspCand = evaluateCandidate(catalogue, mspPlan, emptyDem);
  assert.equal(mspCand.total, 513000, "MSP must be quoted per month (513,000 paise)");
  const mspTrace = mspCand.trace.find((t) => t.ruleId === "RULE-BASE-PRICE")!;
  assert.ok(mspTrace.computation.includes("quoted per month"), "Trace must record quoted per month");
});

test("Growth buffer: 10% buffer with integer ceil logic Math.floor((raw * 110 + 99) / 100) and assumption text", () => {
  const rawDemand: PricingDemand = {
    host_monitor: 25,
    basic_monitor: 15,
    advanced_monitor: 3,
    network_component: 7,
    rum_pageview: 50000,
    applog_gb: 0,
  };

  const { bufferedDemand, assumptions } = applyGrowthBuffer(rawDemand, true);

  // 25 * 1.1 = 27.5 -> ceil = 28. Math.floor((25 * 110 + 99) / 100) = Math.floor(2849 / 100) = 28
  assert.equal(bufferedDemand.host_monitor, 28, "25 servers buffered at 10% ceil must be 28");

  // 15 * 1.1 = 16.5 -> ceil = 17. Math.floor((15 * 110 + 99) / 100) = Math.floor(1749 / 100) = 17
  assert.equal(bufferedDemand.basic_monitor, 17, "15 basic monitors buffered at 10% ceil must be 17");

  // 3 * 1.1 = 3.3 -> ceil = 4. Math.floor((3 * 110 + 99) / 100) = Math.floor(429 / 100) = 4
  assert.equal(bufferedDemand.advanced_monitor, 4, "3 advanced monitors buffered at 10% ceil must be 4");

  // 7 * 1.1 = 7.7 -> ceil = 8. Math.floor((7 * 110 + 99) / 100) = Math.floor(869 / 100) = 8
  assert.equal(bufferedDemand.network_component, 8, "7 network components buffered at 10% ceil must be 8");

  // Assumptions must document the buffer and mark exact Zoho rule needs_confirmation
  assert.ok(assumptions.length > 0);
  assert.ok(assumptions.some((a) => a.includes("needs_confirmation")));
  assert.ok(assumptions.some((a) => a.includes("Expecting 10% growth")));
});

test("Enterprise and MSP Enterprise: priced as starting at, confirmed by Site24x7 sales, flagged for review, never auto-sent as final price", () => {
  const enterprisePlan = catalogue.plans.find((p) => p.id === "plan_enterprise")!;
  assert.ok(enterprisePlan, "Enterprise plan must exist");

  const demand: PricingDemand = {
    host_monitor: 50,
    basic_monitor: 100,
    advanced_monitor: 20,
    network_component: 10,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const candidate = evaluateCandidate(catalogue, enterprisePlan, demand);

  // Price is computed for transparency and comparison
  assert.ok(candidate.total > 0, "Enterprise total must be computed");
  assert.equal(candidate.valid, false, "Enterprise valid must be false so it is withheld from automated options dispatch");
  assert.equal(candidate.isHandoff, true, "Enterprise must be marked isHandoff: true");
  assert.equal(candidate.isStartingAt, true, "Enterprise must be marked isStartingAt: true");
  assert.equal(candidate.requiresReview, true, "Enterprise must be marked requiresReview: true");
  assert.equal(candidate.pricingNote, "Starting at rate, confirmed by Site24x7 sales");
});

test("Single valid candidate is presented as best_value with honest note", () => {
  const dummyDemand: PricingDemand = {
    host_monitor: 10,
    basic_monitor: 0,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const cand: Candidate = {
    plan: catalogue.plans[1]!,
    valid: true,
    unavailabilityReason: null,
    lineItems: [
      {
        id: "base",
        ruleId: "RULE-BASE-PLAN",
        description: "Base",
        quantity: 1,
        unit: "subscription",
        unitPrice: 1026000,
        lineTotal: 1026000,
        includedQuantity: null,
        sourceId: "src_store_addon_prices",
      },
    ],
    coverage: [{ unit: "host_monitor", label: "Host Monitors", required: 10, included: 10, viaAddOns: 0, total: 10, satisfied: true }],
    subtotal: 1026000,
    total: 1026000,
    trace: [],
    addOnPackCount: 0,
  };

  const { options, optionCountNote } = rankOptions([cand], dummyDemand, "q_single");
  assert.equal(options.length, 1);
  assert.equal(options[0]!.optionType, "best_value");
  assert.ok(optionCountNote?.includes("Only 1 genuinely distinct valid configuration exists"));
});

test("Integrity check: lowest-cost-is-minimum check fails if lowest_cost has higher price than another option", () => {
  const dummyDemand: PricingDemand = {
    host_monitor: 10,
    basic_monitor: 0,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const invertedOptions: QuoteOption[] = [
    {
      id: "q__best_value",
      quoteId: "q",
      optionType: "best_value",
      planId: "plan_lite",
      planName: "Lite",
      rankReason: "Best value",
      subtotal: 8721000,
      taxTotal: null,
      total: 8721000, // 87,210 INR
      valid: true,
      unavailabilityReason: null,
      lineItems: [],
      coverage: [],
      headroomNotes: [],
    },
    {
      id: "q__lowest_cost",
      quoteId: "q",
      optionType: "lowest_cost",
      planId: "plan_pro",
      planName: "Professional",
      rankReason: "Lowest cost",
      subtotal: 9870500,
      taxTotal: null,
      total: 9870500, // 98,705 INR (INVERTED! More expensive than best_value)
      valid: true,
      unavailabilityReason: null,
      lineItems: [],
      coverage: [],
      headroomNotes: [],
    },
  ];

  const checks = runIntegrityChecks(catalogue, invertedOptions, dummyDemand);
  const minCheck = checks.find((c) => c.id === "lowest-cost-is-minimum");
  assert.ok(minCheck);
  assert.equal(minCheck.passed, false, "lowest-cost-is-minimum check must FAIL when lowest_cost is more expensive");
});

test("Item 1 Property Test: for 200 random small requirement sets, option 1 total <= the total of every valid candidate", () => {
  // Brute-force reference implementation: find the exact minimum total of all valid candidates
  function bruteForceMinTotal(candidates: Candidate[]): number | null {
    const valid = candidates.filter((c) => c.valid);
    if (valid.length === 0) return null;
    let min = Infinity;
    for (const c of valid) {
      if (c.total < min) min = c.total;
    }
    return min;
  }

  for (let i = 0; i < 200; i++) {
    const demand: PricingDemand = {
      host_monitor: Math.floor(Math.random() * 60),
      basic_monitor: Math.floor(Math.random() * 30),
      advanced_monitor: Math.floor(Math.random() * 6),
      network_component: Math.floor(Math.random() * 25),
      rum_pageview: Math.random() < 0.3 ? 0 : Math.floor(Math.random() * 5) * 100_000,
      applog_gb: Math.floor(Math.random() * 400),
    };

    const candidates = catalogue.plans.map((p) => evaluateCandidate(catalogue, p, demand));
    const validCandidates = candidates.filter((c) => c.valid);
    const { options } = rankOptions(candidates, demand, `prop_quote_${i}`);

    if (validCandidates.length > 0) {
      assert.ok(options.length >= 1, `Must have at least 1 option for iteration ${i}`);
      const option1 = options[0]!;
      const expectedMin = bruteForceMinTotal(candidates)!;

      // Option 1 total MUST equal the minimum of every valid candidate
      assert.equal(
        option1.total,
        expectedMin,
        `Iteration ${i}: Option 1 (${option1.planName} at ${option1.total}) must equal brute-force minimum (${expectedMin})`,
      );

      // Option 1 total MUST be <= the total of every valid candidate
      for (const vc of validCandidates) {
        assert.ok(
          option1.total <= vc.total,
          `Iteration ${i}: Option 1 total ${option1.total} must be <= candidate ${vc.plan.name} total ${vc.total}`,
        );
      }
    }
  }
});
