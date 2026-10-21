import { decideNextAction, type SalesDecision, type SalesEngineerInput } from "../ai/sales-engineer.ts";
import type { AiProvider, AiProviderResult } from "../ai/gemini-provider.ts";
import type { AiDecisionOutput } from "../ai/decision-schema.ts";
import { deriveSupportedCategories } from "../ai/context-builder.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import type { EmailMessage, EmailThread } from "@/types/domain";
import { BENCHMARK_CASES } from "./cases.ts";
import { aggregate, scoreCase, type DetectContext } from "./scorer.ts";
import {
  UNITS,
  type AggregateMetrics,
  type BenchmarkCase,
  type CaseScore,
  type ScoredOutput,
} from "./types.ts";

type Catalogue = ReturnType<typeof loadActiveCatalogue>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Building the app's real input from a benchmark case
// ---------------------------------------------------------------------------

function thread(id: string): EmailThread {
  const now = new Date().toISOString();
  return {
    id,
    provider: "resend",
    providerThreadId: `${id}_p`,
    senderEmail: "buyer@benchmark.example.com",
    senderName: "Benchmark Buyer",
    organisation: null,
    subject: "Benchmark",
    status: "received",
    requestType: "quote",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    messageCount: 1,
    quoteId: null,
    quoteTotal: null,
    currency: "INR",
    statusDetail: null,
  };
}

export function buildInput(c: BenchmarkCase, catalogue: Catalogue): SalesEngineerInput {
  const th = thread(`th_bench_${c.id}`);
  const subject = c.subject ?? "Monitoring quote request";
  const latest = c.turns[c.turns.length - 1] ?? "";
  const prior: EmailMessage[] = c.turns.slice(0, -1).map((body, index) => ({
    id: `msg_${c.id}_${index}`,
    threadId: th.id,
    providerMessageId: `pm_${c.id}_${index}`,
    direction: "inbound",
    fromAddress: th.senderEmail,
    fromName: th.senderName,
    toAddresses: ["quotes@example.com"],
    subject,
    bodyText: body,
    occurredAt: new Date(Date.now() - (c.turns.length - index) * 60_000).toISOString(),
    deliveryId: null,
    securityNotes: [],
    attachments: [],
  }));
  return {
    thread: th,
    latestMessageText: latest,
    cumulativeText: c.turns.join("\n\n"),
    priorMessages: prior,
    existingProfile: undefined,
    catalogue,
    senderEmail: th.senderEmail,
    senderName: th.senderName,
    subject,
  };
}

// ---------------------------------------------------------------------------
// Converting outputs into the scorer's neutral shape
// ---------------------------------------------------------------------------

export function rawToScored(decision: AiDecisionOutput): ScoredOutput {
  return {
    layer: "raw_model",
    action: decision.action,
    claims: decision.knownRequirements.map((r) => ({ unit: r.unit, quantity: r.quantity, basis: r.basis, evidence: r.evidence })),
    referencedPlanIds: decision.referencedPlanIds,
    recommendedCategories: decision.recommendedProductCategories,
    freeText: [
      decision.customerSummary,
      ...decision.identifiedNeeds,
      ...decision.assumptions,
      decision.reasoningSummary,
      decision.conversationalResponse ?? "",
    ],
    followUpQuestions: decision.followUpQuestions,
    confidence: decision.confidence,
  };
}

export function finalToScored(decision: SalesDecision): ScoredOutput {
  const record = decision.record;
  return {
    layer: "final_system",
    action: decision.action,
    claims: UNITS.map((unit) => ({ unit, quantity: decision.extraction.demand[unit] ?? 0 })),
    referencedPlanIds: record.referencedPlanIds,
    recommendedCategories: record.recommendedCategories,
    freeText: [record.customerSummary, ...record.identifiedNeeds, ...record.assumptions, record.reasoningSummary],
    followUpQuestions: record.followUpQuestions,
    confidence: record.confidence,
  };
}

// ---------------------------------------------------------------------------
// Running one case
// ---------------------------------------------------------------------------

export interface CaseRun {
  caseId: string;
  source: string;
  model: string | null;
  latencyMs: number | null;
  /** n/a for the rules baseline, ok when the model answered, failed when it fell back. */
  providerStatus: "n/a" | "ok" | "failed";
  failure: string | null;
  raw: ScoredOutput | null;
  final: ScoredOutput;
}

/** Wraps a provider so the raw model answer can be captured, with one patient retry on rate limits. */
function recorder(inner: AiProvider, rateLimitWaitMs: number) {
  let last: AiProviderResult | null = null;
  const provider: AiProvider = {
    name: inner.name,
    async generateDecision(input) {
      let result = await inner.generateDecision(input);
      for (let retry = 0; retry < 2 && !result.ok && result.category === "rate_limited"; retry += 1) {
        await sleep(rateLimitWaitMs);
        result = await inner.generateDecision(input);
      }
      last = result;
      return result;
    },
  };
  return { provider, last: () => last };
}

export async function runCase(c: BenchmarkCase, catalogue: Catalogue, provider: AiProvider | null, rateLimitWaitMs = 15_000): Promise<CaseRun> {
  const input = buildInput(c, catalogue);
  if (!provider) {
    const decision = await decideNextAction(input);
    return {
      caseId: c.id,
      source: decision.record.source,
      model: null,
      latencyMs: null,
      providerStatus: "n/a",
      failure: null,
      raw: null,
      final: finalToScored(decision),
    };
  }
  const rec = recorder(provider, rateLimitWaitMs);
  const decision = await decideNextAction(input, rec.provider);
  const result = rec.last();
  const ok = result?.ok === true;
  return {
    caseId: c.id,
    source: decision.record.source,
    model: result?.model ?? null,
    latencyMs: result?.latencyMs ?? null,
    providerStatus: ok ? "ok" : "failed",
    failure: result && !result.ok ? `${result.category}: ${result.detail}` : null,
    raw: result && result.ok ? rawToScored(result.decision) : null,
    final: finalToScored(decision),
  };
}

// ---------------------------------------------------------------------------
// Running the whole benchmark
// ---------------------------------------------------------------------------

export interface RunOptions {
  providerName: string;
  provider: AiProvider | null;
  delayMs?: number;
  repeats?: number;
  limit?: number;
  ids?: string[];
  categories?: string[];
  cases?: BenchmarkCase[];
}

export interface BenchmarkResult {
  meta: { provider: string; startedAt: string; cases: number; repeats: number; datasetVersion: string; catalogueVersion: string };
  runs: Array<CaseRun & { repeat: number }>;
  raw: { scores: CaseScore[]; metrics: AggregateMetrics } | null;
  final: { scores: CaseScore[]; metrics: AggregateMetrics };
  /** Share of cases whose reported quantities and action were identical across all repeats. Null when repeats = 1. */
  stability: number | null;
  providerFailures: number;
}

export const DATASET_VERSION = "v1";

export async function runBenchmark(options: RunOptions): Promise<BenchmarkResult> {
  const catalogue = loadActiveCatalogue();
  const ctx: DetectContext = {
    planIds: new Set(catalogue.plans.map((p) => p.id)),
    supportedCategories: new Set(deriveSupportedCategories(catalogue)),
  };
  let selected = options.cases ?? BENCHMARK_CASES;
  if (options.ids?.length) selected = selected.filter((c) => options.ids?.includes(c.id));
  if (options.categories?.length) selected = selected.filter((c) => options.categories?.includes(c.category));
  if (options.limit) selected = selected.slice(0, options.limit);

  const repeats = Math.max(1, options.repeats ?? 1);
  const runs: BenchmarkResult["runs"] = [];
  const byId = new Map(selected.map((c) => [c.id, c]));

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const c of selected) {
      const run = await runCase(c, catalogue, options.provider);
      runs.push({ ...run, repeat });
      if (options.provider && options.delayMs) await sleep(options.delayMs);
    }
  }

  const finalScores = runs.map((r) => scoreCase(byId.get(r.caseId) as BenchmarkCase, r.final, ctx));
  const rawScores = runs
    .filter((r) => r.raw !== null)
    .map((r) => scoreCase(byId.get(r.caseId) as BenchmarkCase, r.raw as ScoredOutput, ctx));

  let stability: number | null = null;
  if (repeats > 1) {
    const signature = (r: CaseRun) => JSON.stringify([r.final.action, r.final.claims.map((c) => [c.unit, c.quantity])]);
    let stable = 0;
    for (const c of selected) {
      const set = new Set(runs.filter((r) => r.caseId === c.id).map(signature));
      if (set.size === 1) stable += 1;
    }
    stability = selected.length === 0 ? null : stable / selected.length;
  }

  return {
    meta: {
      provider: options.providerName,
      startedAt: new Date().toISOString(),
      cases: selected.length,
      repeats,
      datasetVersion: DATASET_VERSION,
      catalogueVersion: catalogue.version,
    },
    runs,
    raw: options.provider ? { scores: rawScores, metrics: aggregate(rawScores, "raw_model") } : null,
    final: { scores: finalScores, metrics: aggregate(finalScores, "final_system") },
    stability,
    providerFailures: runs.filter((r) => r.providerStatus === "failed").length,
  };
}
