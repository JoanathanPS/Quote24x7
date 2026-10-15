import assert from "node:assert/strict";
import test from "node:test";

import { loadActiveCatalogue } from "../catalogue/loader.ts";
import { evaluateCandidate, rankOptions, runIntegrityChecks, type Candidate, type PricingDemand } from "./engine.ts";
import type { Plan, QuoteOption } from "@/types/domain";

const catalogue = loadActiveCatalogue();

test("Ranking: 25 Linux servers + 1 website check correctly ranks Lowest Cost at ₹7,980 and Best Value at ₹8,740", () => {
  const demand: PricingDemand = {
    host_monitor: 25,
    basic_monitor: 1,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  const candidates = catalogue.plans.map((p) => evaluateCandidate(catalogue, p, demand));
  const { options, rejected } = rankOptions(candidates, demand, "q_rank_25");

  assert.equal(options.length, 2, "Expected 2 distinct valid options (Lite and Professional)");
  const bestValue = options.find((o) => o.optionType === "best_value");
  const lowestCost = options.find((o) => o.optionType === "lowest_cost");

  assert.ok(bestValue, "best_value must be present");
  assert.ok(lowestCost, "lowest_cost must be present");

  // Invariant 1: Lowest cost must be the absolute cheapest valid configuration (Lite at ₹7,980)
  assert.equal(lowestCost.planId, "plan_lite", "Lite must be the lowest_cost option");
  assert.equal(lowestCost.total, 798000, "Lite total must be 7,980 INR monthly list (798,000 paise)");

  // Invariant 2: Best value must recommend Professional at ₹8,740 (higher capability/breadth for marginal extra cost)
  assert.equal(bestValue.planId, "plan_professional", "Professional must be the best_value option");
  assert.equal(bestValue.total, 874000, "Professional total must be 8,740 INR monthly list (874,000 paise)");

  // Invariant 3: Enterprise returns handoff, never an automated price
  const enterpriseRejected = rejected.find((r) => r.plan.id === "plan_enterprise");
  assert.ok(enterpriseRejected, "Enterprise must be in rejected candidates list");
  assert.equal(enterpriseRejected.isHandoff, true, "Enterprise must be marked as isHandoff: true");

  // Invariant 4: Lowest Cost is strictly less than or equal to Best Value
  assert.ok(
    lowestCost.total <= bestValue.total,
    `lowest_cost (${lowestCost.total}) must be <= best_value (${bestValue.total})`
  );

  // Invariant 5: Both options are distinct plans
  const planIds = new Set(options.map((o) => o.planId));
  assert.equal(planIds.size, 2, "All options must use distinct plans");

  // Invariant 6: Integrity checks pass, including lowest-cost-is-minimum
  const checks = runIntegrityChecks(catalogue, options, demand);
  for (const check of checks) {
    assert.equal(check.passed, true, `Check ${check.id} must pass`);
  }
});

test("Ranking: 5-capability demand ensures lowest_cost <= best_value", () => {
  const demand: PricingDemand = {
    host_monitor: 80,
    network_component: 15,
    advanced_monitor: 4,
    rum_pageview: 2000000,
    applog_gb: 50,
    basic_monitor: 0,
  };

  const candidates = catalogue.plans.map((p) => evaluateCandidate(catalogue, p, demand));
  const { options } = rankOptions(candidates, demand, "q_rank_5cap");

  assert.equal(options.length, 2, "Expected 2 distinct valid options (Lite and Professional)");
  const bestValue = options.find((o) => o.optionType === "best_value")!;
  const lowestCost = options.find((o) => o.optionType === "lowest_cost")!;

  assert.ok(lowestCost.total <= bestValue.total, "lowest_cost must be <= best_value");

  const checks = runIntegrityChecks(catalogue, options, demand);
  assert.ok(checks.every((c) => c.passed), "all integrity checks must pass");
});

test("Ranking: Overlapping prices at the minimum assign higher-value candidate to best_value and lowest_cost never exceeds it", () => {
  const dummyDemand: PricingDemand = {
    host_monitor: 10,
    basic_monitor: 0,
    advanced_monitor: 0,
    network_component: 0,
    rum_pageview: 0,
    applog_gb: 0,
  };

  // Create two candidates with identical minimum total (₹50,000) but different coverage scores
  const planA: Plan = {
    id: "plan_a",
    name: "Plan A",
    summary: "Plan A summary",
    basePrice: 5000000,
    billingPeriod: "annual",
    verificationStatus: "public_verified",
    pollingFrequency: "1 minute",
    monitoringLocations: 4,
    sourceId: "src_store_comparison",
    entitlements: [{ unit: "host_monitor", included: 10 }],
    capabilities: ["Server and cloud monitoring"],
    allowedAddOnIds: [],
  };

  const planB: Plan = {
    id: "plan_b",
    name: "Plan B",
    summary: "Plan B summary",
    basePrice: 5000000,
    billingPeriod: "annual",
    verificationStatus: "public_verified",
    pollingFrequency: "10 seconds",
    monitoringLocations: 16,
    sourceId: "src_store_comparison",
    entitlements: [{ unit: "host_monitor", included: 10 }, { unit: "basic_monitor", included: 20 }],
    capabilities: ["Server and cloud monitoring", "Website monitoring"],
    allowedAddOnIds: [],
  };

  const candA: Candidate = {
    plan: planA,
    valid: true,
    unavailabilityReason: null,
    lineItems: [
      {
        id: "a_base",
        ruleId: "RULE-BASE-PLAN",
        description: "Plan A base",
        quantity: 1,
        unit: "subscription",
        unitPrice: 5000000,
        lineTotal: 5000000,
        includedQuantity: null,
        sourceId: "src_store_comparison",
      },
    ],
    coverage: [{ unit: "host_monitor", label: "Host Monitors", required: 10, included: 10, viaAddOns: 0, total: 10, satisfied: true }],
    subtotal: 5000000,
    total: 5000000,
    coveragePoints: 100,
    coverageScore: 200,
    trace: [],
    addOnPackCount: 0,
  };

  const candB: Candidate = {
    plan: planB,
    valid: true,
    unavailabilityReason: null,
    lineItems: [
      {
        id: "b_base",
        ruleId: "RULE-BASE-PLAN",
        description: "Plan B base",
        quantity: 1,
        unit: "subscription",
        unitPrice: 5000000,
        lineTotal: 5000000,
        includedQuantity: null,
        sourceId: "src_store_comparison",
      },
    ],
    coverage: [{ unit: "host_monitor", label: "Host Monitors", required: 10, included: 10, viaAddOns: 0, total: 10, satisfied: true }],
    subtotal: 5000000,
    total: 5000000,
    coveragePoints: 100,
    coverageScore: 500, // Higher score for same price
    trace: [],
    addOnPackCount: 0,
  };

  const { options } = rankOptions([candA, candB], dummyDemand, "q_overlap");
  assert.equal(options.length, 2);

  const bestValue = options.find((o) => o.optionType === "best_value")!;
  const lowestCost = options.find((o) => o.optionType === "lowest_cost")!;

  assert.equal(bestValue.planId, "plan_b", "Candidate with higher score must be assigned to best_value");
  assert.equal(lowestCost.planId, "plan_a", "Other candidate must be assigned to lowest_cost");
  assert.equal(lowestCost.total, 5000000);
  assert.equal(bestValue.total, 5000000);
  assert.equal(lowestCost.total, bestValue.total, "Totals are identical");
});

test("Ranking: Single valid candidate is presented as best_value with honest note", () => {
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
        sourceId: "src_store_comparison",
      },
    ],
    coverage: [{ unit: "host_monitor", label: "Host Monitors", required: 10, included: 10, viaAddOns: 0, total: 10, satisfied: true }],
    subtotal: 1026000,
    total: 1026000,
    coveragePoints: 100,
    coverageScore: 300,
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

  // Fabricate an inverted options array
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
