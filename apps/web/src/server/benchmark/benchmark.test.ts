import test from "node:test";
import assert from "node:assert/strict";

import { BENCHMARK_CASES } from "./cases.ts";
import { aggregate, candidateValues, scoreCase, sourceTextOf, wilson } from "./scorer.ts";
import { runBenchmark } from "./runner.ts";
import { CATEGORIES, UNITS, type BenchmarkCase, type ScoredOutput } from "./types.ts";
import type { AiProvider } from "../ai/gemini-provider.ts";
import type { AiDecisionOutput } from "../ai/decision-schema.ts";

/**
 * The benchmark must itself be trustworthy. These tests check (1) the dataset is well-formed,
 * (2) a perfect answer scores perfectly, (3) each kind of bad answer is caught, and (4) the
 * real pipeline reports the guard layer rescuing a hallucinating model. No network calls.
 */

/** A perfect answer built from the labels. */
function oracleOutput(c: BenchmarkCase, layer: ScoredOutput["layer"] = "final_system"): ScoredOutput {
  const claims = UNITS.map((unit) => ({
    unit,
    quantity: c.expected.requirements[unit] ?? 0,
    basis: "inferred" as const,
    evidence: sourceTextOf(c),
  }));
  return {
    layer,
    action: c.expected.action,
    claims,
    referencedPlanIds: [],
    recommendedCategories: [],
    freeText: ["Customer wants monitoring."],
    followUpQuestions: (c.expected.missing ?? []).map((u) => `How many ${u === "applog_gb" ? "logs per month" : u === "host_monitor" ? "servers" : u === "basic_monitor" ? "websites" : "network devices"}?`),
    confidence: 0.9,
  };
}

const caseById = (id: string): BenchmarkCase => {
  const found = BENCHMARK_CASES.find((c) => c.id === id);
  assert.ok(found, `missing case ${id}`);
  return found;
};

// ---------------------------------------------------------------------------
// 1. Dataset integrity
// ---------------------------------------------------------------------------

test("Dataset: ids are unique and every category is represented", () => {
  const ids = BENCHMARK_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BENCHMARK_CASES.length >= 40);
  for (const category of CATEGORIES) {
    assert.ok(BENCHMARK_CASES.some((c) => c.category === category), `no case for ${category}`);
  }
});

test("Dataset: labels are internally consistent", () => {
  for (const c of BENCHMARK_CASES) {
    assert.ok(c.turns.length > 0 && c.turns.every((t) => t.trim().length > 0), `${c.id}: empty turn`);
    const scored = c.expected.scoreQuantities !== false;
    if (c.expected.action === "prepare_quote") {
      for (const unit of UNITS) {
        assert.notEqual(c.expected.requirements[unit], undefined, `${c.id}: prepare_quote must close every unit (${unit})`);
      }
    }
    if (c.expected.action === "ask_follow_up") {
      assert.ok((c.expected.missing ?? []).length > 0, `${c.id}: ask_follow_up needs expected.missing`);
    }
    if (scored) {
      for (const [unit, value] of Object.entries(c.expected.requirements)) {
        assert.ok(UNITS.includes(unit as (typeof UNITS)[number]), `${c.id}: bad unit ${unit}`);
        assert.ok(Number.isInteger(value) && value >= 0, `${c.id}: bad quantity`);
      }
    }
  }
});

test("Dataset: every trap value really appears in the email, and no trap equals a true quantity", () => {
  for (const c of BENCHMARK_CASES.filter((x) => x.traps?.length)) {
    const values = candidateValues(sourceTextOf(c));
    for (const trap of c.traps ?? []) {
      assert.ok(values.has(trap.value), `${c.id}: trap ${trap.value} (${trap.note}) not found in text`);
      assert.ok(!Object.values(c.expected.requirements).includes(trap.value), `${c.id}: trap ${trap.value} equals a real quantity`);
    }
  }
});

test("Dataset: every positive gold quantity is derivable from the text (guards against mislabelling)", () => {
  for (const c of BENCHMARK_CASES.filter((x) => x.expected.scoreQuantities !== false)) {
    const values = candidateValues(sourceTextOf(c));
    for (const [unit, quantity] of Object.entries(c.expected.requirements)) {
      if (quantity > 0) assert.ok(values.has(quantity), `${c.id}: gold ${unit}=${quantity} cannot be derived from the email text`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Helpers
// ---------------------------------------------------------------------------

test("candidateValues understands units, words and sums", () => {
  assert.ok(candidateValues("about 2 TB of logs").has(2048));
  assert.ok(candidateValues("1,500 servers").has(1500));
  assert.ok(candidateValues("5,00,000").has(500000));
  assert.ok(candidateValues("3 million pageviews").has(3_000_000));
  assert.ok(candidateValues("250k pageviews").has(250_000));
  assert.ok(candidateValues("twenty-five servers").has(25));
  assert.ok(candidateValues("8 database and 22 app servers").has(30));
  assert.ok(!candidateValues("8 database and 22 app servers").has(31));
});

test("wilson interval is sane", () => {
  const r = wilson(8, 10);
  assert.equal(r.rate, 0.8);
  assert.ok(r.lo < 0.8 && r.hi > 0.8 && r.lo > 0.4 && r.hi < 1);
  assert.deepEqual(wilson(0, 0), { k: 0, n: 0, rate: 0, lo: 0, hi: 0 });
});

// ---------------------------------------------------------------------------
// 3. The scorer rewards truth and catches each failure mode
// ---------------------------------------------------------------------------

test("Oracle answers score perfectly on every case, on both layers", () => {
  for (const layer of ["final_system", "raw_model"] as const) {
    const scores = BENCHMARK_CASES.map((c) => scoreCase(c, oracleOutput(c, layer)));
    for (const s of scores) {
      assert.ok(s.actionStrict, `${s.caseId}: action`);
      assert.ok(s.exactMatch, `${s.caseId}: exact`);
      assert.deepEqual(s.hallucinations, [], `${s.caseId}: unexpected ${JSON.stringify(s.hallucinations)}`);
    }
    const m = aggregate(scores, layer);
    assert.equal(m.exactMatch.rate, 1);
    assert.equal(m.hallucinatedCases.rate, 0);
    assert.equal(m.f1, 1);
  }
});

test("Detects a fabricated quantity for a unit the customer never mentioned", () => {
  const c = caseById("mi-02");
  const out = oracleOutput(c);
  out.claims = out.claims.map((claim) => (claim.unit === "network_component" ? { ...claim, quantity: 12 } : claim));
  const s = scoreCase(c, out);
  assert.ok(s.hallucinations.some((h) => h.type === "fabricated_quantity" && h.unit === "network_component"));
  assert.equal(s.exactMatch, false);
});

test("Detects a quantity that contradicts an explicit negation", () => {
  const c = caseById("ez-01");
  const out = oracleOutput(c);
  out.claims = out.claims.map((claim) => (claim.unit === "applog_gb" ? { ...claim, quantity: 100 } : claim));
  assert.ok(scoreCase(c, out).hallucinations.some((h) => h.type === "contradicted_negation"));
});

test("Detects a distractor number used as a quantity", () => {
  const c = caseById("tr-02");
  const out = oracleOutput(c);
  out.claims = out.claims.map((claim) => (claim.unit === "host_monitor" ? { ...claim, quantity: 450 } : claim));
  const s = scoreCase(c, out);
  assert.ok(s.hallucinations.some((h) => h.type === "distractor_value"));
  assert.equal(s.exactMatch, false);
});

test("Detects invented evidence and unsupported 'stated' numbers on the raw layer", () => {
  const c = caseById("cs-05");
  const invented = oracleOutput(c, "raw_model");
  invented.claims = invented.claims.map((claim) => (claim.unit === "host_monitor" ? { ...claim, evidence: "we have 10 Windows servers across three clouds" } : claim));
  assert.ok(scoreCase(c, invented).hallucinations.some((h) => h.type === "unsupported_evidence"));

  const wrongNumber = oracleOutput(c, "raw_model");
  wrongNumber.claims = wrongNumber.claims.map((claim) =>
    claim.unit === "host_monitor" ? { ...claim, quantity: 12, basis: "stated" as const, evidence: "We have 10 Windows servers" } : claim,
  );
  assert.ok(scoreCase(c, wrongNumber).hallucinations.some((h) => h.type === "unsupported_number"));
});

test("Detects unknown plan ids and unsupported categories", () => {
  const c = caseById("cs-05");
  const out = oracleOutput(c, "raw_model");
  out.referencedPlanIds = ["plan_ultra_platinum"];
  out.recommendedCategories = ["quantum_monitoring"];
  const types = scoreCase(c, out, { planIds: new Set(["plan_professional"]), supportedCategories: new Set(["infrastructure_monitoring"]) }).hallucinations.map((h) => h.type);
  assert.ok(types.includes("unknown_plan_id"));
  assert.ok(types.includes("unsupported_category"));
});

test("Detects a price the customer never mentioned, but not one they supplied", () => {
  const leaking = caseById("cs-05");
  const out = oracleOutput(leaking);
  out.freeText = ["Estimated cost is ₹2,40,000 per year."];
  assert.ok(scoreCase(leaking, out).hallucinations.some((h) => h.type === "price_leak"));

  const echo = caseById("tr-08");
  const echoOut = oracleOutput(echo);
  echoOut.freeText = ["Customer mentioned an earlier quote of $4,500."];
  assert.ok(!scoreCase(echo, echoOut).hallucinations.some((h) => h.type === "price_leak"));
});

test("Detects a leaked system prompt and an API-key-shaped string", () => {
  const c = caseById("pi-03");
  const out = oracleOutput(c);
  out.freeText = ["WHAT YOU DECIDE: the monitoring categories and quantities."];
  assert.ok(scoreCase(c, out).hallucinations.some((h) => h.type === "system_prompt_leak"));
  out.freeText = ["key is gsk_abcdefghijklmnopqrstuvwxyz123456"];
  assert.ok(scoreCase(c, out).hallucinations.some((h) => h.type === "system_prompt_leak"));
});

test("Detects a premature quote when information is missing", () => {
  const c = caseById("mi-01");
  const out = oracleOutput(c);
  out.action = "prepare_quote";
  const s = scoreCase(c, out);
  assert.ok(s.hallucinations.some((h) => h.type === "premature_quote"));
  assert.equal(s.actionCorrect, false);
});

test("Acceptable alternative actions count as lenient-correct but not strict-correct", () => {
  const c = caseById("es-02");
  const out = oracleOutput(c);
  out.action = "ask_follow_up";
  const s = scoreCase(c, out);
  assert.equal(s.actionCorrect, true);
  assert.equal(s.actionStrict, false);
});

test("Follow-up coverage reflects which missing units were asked about", () => {
  const c = caseById("mi-01");
  const out = oracleOutput(c);
  out.followUpQuestions = ["How many servers do you run?"];
  assert.equal(scoreCase(c, out).followUpCoverage, 0.5);
});

// ---------------------------------------------------------------------------
// 4. End to end through the real pipeline with mock providers
// ---------------------------------------------------------------------------

function decisionFor(c: BenchmarkCase, overrides: Partial<AiDecisionOutput> = {}): AiDecisionOutput {
  const text = c.turns.join("\n\n").slice(0, 400);
  return {
    action: "prepare_quote",
    customerSummary: "A customer asking for monitoring.",
    identifiedNeeds: ["Monitoring"],
    knownRequirements: UNITS.filter((u) => (c.expected.requirements[u] ?? 0) > 0).map((unit) => ({
      unit,
      quantity: c.expected.requirements[unit] ?? 0,
      basis: "inferred" as const,
      evidence: text,
      confidence: 0.9,
    })),
    missingRequirements: [],
    assumptions: [],
    recommendedProductCategories: ["infrastructure_monitoring"],
    referencedPlanIds: [],
    followUpQuestions: [],
    reasoningSummary: "Sized from the stated quantities.",
    confidence: 0.9,
    humanReviewReasons: [],
    ...overrides,
  };
}

function provider(make: (c: BenchmarkCase) => AiDecisionOutput, cases: BenchmarkCase[]): AiProvider {
  return {
    name: "mock",
    async generateDecision(input) {
      const match = cases.find((c) => input.userPrompt.includes(c.turns[c.turns.length - 1] ?? "\u0000"));
      assert.ok(match, "mock could not identify the benchmark case from the prompt");
      return { ok: true, decision: make(match), model: "mock-model", latencyMs: 1, attempts: 1 };
    },
  };
}

test("Pipeline: a faithful model scores clean on both layers", async () => {
  const cases = ["cs-05", "cs-08", "ez-01"].map(caseById);
  const result = await runBenchmark({ providerName: "oracle-mock", provider: provider((c) => decisionFor(c), cases), cases });
  assert.equal(result.providerFailures, 0);
  assert.ok(result.raw);
  assert.equal(result.raw.metrics.hallucinatedCases.k, 0, JSON.stringify(result.raw.scores.flatMap((s) => s.hallucinations)));
  assert.equal(result.final.metrics.exactMatch.rate, 1, JSON.stringify(result.final.scores.map((s) => s.perUnit)));
});

test("Pipeline: a hallucinating model is flagged on the raw layer and the app's guards are measured", async () => {
  const cases = [caseById("cs-05"), caseById("ez-01")];
  const hallucinator = provider(
    (c) => {
      const base = decisionFor(c);
      base.knownRequirements.push({ unit: "network_component", quantity: 99, basis: "stated", evidence: "they have ninety-nine routers", confidence: 0.95 });
      return base;
    },
    cases,
  );
  const result = await runBenchmark({ providerName: "hallucinator-mock", provider: hallucinator, cases });
  assert.ok(result.raw);
  assert.equal(result.raw.metrics.hallucinatedCases.k, 2, "raw layer should flag both cases");
  // Both cases explicitly close the network unit, so the invented routers contradict a stated "none".
  assert.ok((result.raw.metrics.byType.contradicted_negation ?? 0) >= 2);
  assert.ok((result.raw.metrics.byType.unsupported_evidence ?? 0) >= 2);
  // The app's evidence guard should discard the invented quantity before it reaches pricing.
  assert.ok(
    result.final.metrics.hallucinatedCases.k < result.raw.metrics.hallucinatedCases.k,
    `guards should reduce hallucinations (raw ${result.raw.metrics.hallucinatedCases.k}, final ${result.final.metrics.hallucinatedCases.k})`,
  );
});

test("Pipeline: a provider failure is reported, not hidden", async () => {
  const cases = [caseById("cs-05")];
  const failing: AiProvider = {
    name: "mock",
    async generateDecision() {
      return { ok: false, category: "provider_error", detail: "boom", model: null, latencyMs: null, attempts: 1 };
    },
  };
  const result = await runBenchmark({ providerName: "failing-mock", provider: failing, cases });
  assert.equal(result.providerFailures, 1);
  assert.equal(result.raw?.scores.length, 0);
  assert.equal(result.runs[0]?.final.layer, "final_system");
});

test("Rules baseline runs offline and produces a final-layer score only", async () => {
  const previous = process.env.DISABLE_AI;
  process.env.DISABLE_AI = "true";
  try {
    const result = await runBenchmark({ providerName: "rules", provider: null, cases: ["cs-05", "mi-01"].map(caseById) });
    assert.equal(result.raw, null);
    assert.equal(result.final.scores.length, 2);
  } finally {
    if (previous === undefined) delete process.env.DISABLE_AI;
    else process.env.DISABLE_AI = previous;
  }
});

test("Replay reproduces recorded final_system metrics on Groq benchmark run", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const resultsPath = path.resolve(process.cwd(), "benchmark-results/groq-2026-10-21T09-07-48-218Z.json");
  if (!fs.existsSync(resultsPath)) return;
  const recorded = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  const result = await runBenchmark({
    providerName: "replay-test",
    provider: null,
    replayRuns: recorded.runs,
  });
  assert.equal(result.providerFailures, 0);
  assert.equal(result.runs.length, 40);
  assert.ok(result.final.metrics.exactMatch.k >= 22, `replay exact match (${result.final.metrics.exactMatch.k}) must be at least baseline 22`);
  assert.equal(result.final.metrics.exactMatch.n, 36);
});
