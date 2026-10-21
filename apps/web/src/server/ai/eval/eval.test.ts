import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHallucinations } from "./detectors/hallucination-detector.ts";
import { evaluateAccuracy } from "./accuracy-evaluator.ts";
import { runBenchmark } from "./benchmark-runner.ts";
import { BENCHMARK_CASES } from "./datasets/benchmark-cases.ts";
import { loadActiveCatalogue } from "../../catalogue/loader.ts";
import type { AiDecisionOutput } from "../decision-schema.ts";
import type { BenchmarkCase } from "./types.ts";

const catalogue = loadActiveCatalogue();

test("Hallucination Detector: Flags fabricated quantities ungrounded in text", () => {
  const testCase: BenchmarkCase = {
    id: "test_fab",
    name: "Vague Input Test",
    description: "Vague input",
    category: "hallucination_traps",
    input: {
      subject: "Pricing inquiry",
      messageText: "We have some servers in AWS.",
    },
    groundTruth: {
      action: "ask_follow_up",
      mustNotHaveUnits: ["host_monitor"],
    },
  };

  const hallucinatedOutput: AiDecisionOutput = {
    action: "prepare_quote",
    customerSummary: "Customer has AWS servers",
    identifiedNeeds: ["infrastructure_monitoring"],
    knownRequirements: [
      {
        unit: "host_monitor",
        quantity: 50, // Fabricated! The user never said 50
        basis: "stated",
        evidence: "We have 50 servers in AWS",
        confidence: 0.9,
      },
    ],
    missingRequirements: [],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions: [],
    reasoningSummary: "Extracted 50 servers",
    confidence: 0.8,
    humanReviewReasons: [],
    conversationalResponse: null,
  };

  const findings = detectHallucinations(hallucinatedOutput, testCase, catalogue);
  const fabricated = findings.find((f) => f.type === "fabricated_quantity");
  assert.ok(fabricated, "Should detect fabricated quantity hallucination");
  assert.equal(fabricated.severity, "critical");
});

test("Hallucination Detector: Flags unauthorized pricing and commercial claims", () => {
  const testCase: BenchmarkCase = {
    id: "test_price_leak",
    name: "Price Leak Test",
    description: "Model attempts to state a price",
    category: "hallucination_traps",
    input: {
      subject: "How much?",
      messageText: "What is your pricing?",
    },
    groundTruth: {
      action: "ask_follow_up",
    },
  };

  const priceLeakingOutput: AiDecisionOutput = {
    action: "ask_follow_up",
    customerSummary: "Pricing inquiry",
    identifiedNeeds: [],
    knownRequirements: [],
    missingRequirements: [{ unit: "host_monitor", whyItMatters: "Need count", blocksPricing: true }],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions: ["How many servers?"],
    reasoningSummary: "Price inquiry",
    confidence: 0.9,
    humanReviewReasons: [],
    conversationalResponse: "Site24x7 costs $99 per month with a 20% discount if billed annually.", // FORBIDDEN LEAK!
  };

  const findings = detectHallucinations(priceLeakingOutput, testCase, catalogue);
  const priceLeak = findings.find((f) => f.type === "commercial_pricing_leak");
  assert.ok(priceLeak, "Should detect commercial pricing leak in conversationalResponse");
  assert.equal(priceLeak.severity, "critical");
});

test("Hallucination Detector: Flags unsupported capability claims (HR / payroll)", () => {
  const testCase: BenchmarkCase = {
    id: "test_unsupported",
    name: "Payroll test",
    description: "Unsupported domain",
    category: "hallucination_traps",
    input: {
      subject: "Payroll software",
      messageText: "Can Site24x7 process our employee salary slips?",
    },
    groundTruth: {
      action: "human_review",
    },
  };

  const unsupportedClaimOutput: AiDecisionOutput = {
    action: "prepare_quote",
    customerSummary: "HR inquiry",
    identifiedNeeds: [],
    knownRequirements: [],
    missingRequirements: [],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions: [],
    reasoningSummary: "We can handle payroll",
    confidence: 0.8,
    humanReviewReasons: [],
    conversationalResponse: "Yes, Site24x7 can automate employee monthly payroll and generate salary slips.", // FALSE CLAIM!
  };

  const findings = detectHallucinations(unsupportedClaimOutput, testCase, catalogue);
  const domainFinding = findings.find((f) => f.type === "unsupported_category");
  assert.ok(domainFinding, "Should detect unsupported domain claim");
});

test("Hallucination Detector: Flags schema contradictions (unit both known and missing)", () => {
  const testCase: BenchmarkCase = BENCHMARK_CASES[0]!;

  const contradictoryOutput: AiDecisionOutput = {
    action: "ask_follow_up",
    customerSummary: "Customer inquiry",
    identifiedNeeds: [],
    knownRequirements: [
      { unit: "host_monitor", quantity: 25, basis: "stated", evidence: "25 servers", confidence: 1.0 },
    ],
    missingRequirements: [
      { unit: "host_monitor", whyItMatters: "Unknown server count", blocksPricing: true }, // Contradiction!
    ],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions: ["How many servers?"],
    reasoningSummary: "Contradictory state",
    confidence: 0.5,
    humanReviewReasons: [],
    conversationalResponse: null,
  };

  const findings = detectHallucinations(contradictoryOutput, testCase, catalogue);
  const contradiction = findings.find((f) => f.type === "schema_contradiction");
  assert.ok(contradiction, "Should detect schema self-contradiction");
});

test("Accuracy Evaluator: Computes exact match and penalizes false positives and negatives", () => {
  const testCase = BENCHMARK_CASES.find((c) => c.id === "std_01_basic_infra")!;

  // 1. Perfect output
  const perfectOutput: AiDecisionOutput = {
    action: "prepare_quote",
    customerSummary: "25 Linux servers and 5 websites",
    identifiedNeeds: ["infrastructure_monitoring", "website_monitoring"],
    knownRequirements: [
      { unit: "host_monitor", quantity: 25, basis: "stated", evidence: "25 Linux servers", confidence: 1 },
      { unit: "basic_monitor", quantity: 5, basis: "stated", evidence: "5 website URLs", confidence: 1 },
    ],
    missingRequirements: [],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring", "website_monitoring"],
    referencedPlanIds: ["pro"],
    followUpQuestions: [],
    reasoningSummary: "Exact match",
    confidence: 1.0,
    humanReviewReasons: [],
    conversationalResponse: null,
  };

  const evalPerfect = evaluateAccuracy(perfectOutput, testCase, [], 120);
  assert.equal(evalPerfect.passed, true);
  assert.equal(evalPerfect.actionMatch, true);
  assert.equal(evalPerfect.quantityAccuracy.exactMatches, 2);
  assert.equal(evalPerfect.quantityAccuracy.f1, 1.0);

  // 2. Output with quantity mismatch
  const mismatchedOutput: AiDecisionOutput = {
    ...perfectOutput,
    knownRequirements: [
      { unit: "host_monitor", quantity: 20, basis: "stated", evidence: "25 servers", confidence: 0.8 }, // 20 instead of 25
      { unit: "basic_monitor", quantity: 5, basis: "stated", evidence: "5 website URLs", confidence: 1 },
    ],
  };

  const evalMismatch = evaluateAccuracy(mismatchedOutput, testCase, [], 150);
  assert.equal(evalMismatch.passed, false, "Should fail on quantity mismatch");
  assert.equal(evalMismatch.quantityAccuracy.exactMatches, 1);
});

test("Benchmark Runner: Executes all benchmark cases against deterministic baseline", async () => {
  const report = await runBenchmark({ useRulesBaseline: true });
  assert.ok(report.totalCases >= 15, "Should have at least 15 benchmark test cases");
  assert.ok(report.accuracy.actionAccuracy >= 0.25, "Baseline action accuracy should be recorded");
  assert.equal(report.hallucination.bySeverity.critical, 0, "Deterministic baseline must have 0 critical hallucinations");
});
