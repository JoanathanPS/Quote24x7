import fs from "node:fs";
import path from "node:path";
import { decideNextAction, type SalesDecision, type SalesEngineerInput } from "../ai/sales-engineer.ts";
import type { AiProvider, AiProviderResult } from "../ai/gemini-provider.ts";
import { PRODUCT_CATEGORIES, type AiDecisionOutput } from "../ai/decision-schema.ts";
import { deriveSupportedCategories } from "../ai/context-builder.ts";
import { loadActiveCatalogue } from "../catalogue/loader.ts";
import type { EmailMessage, EmailThread, MessageAttachment, RequirementProfile } from "@/types/domain";
import { parseInboundDocument } from "../documents/inbound-document-parser.ts";
import { extractRequirements, mergeRequirements } from "../extraction/extractor.ts";
import { BENCHMARK_CASES, BENCHMARK_CASES_V1 } from "./cases.ts";
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

function resolveAttachmentPath(filename: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), "test-attachments", filename),
    path.resolve(process.cwd(), "..", "test-attachments", filename),
    path.resolve(process.cwd(), "..", "..", "test-attachments", filename),
    path.resolve(process.cwd(), "apps", "web", "test-attachments", filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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

export async function buildInput(c: BenchmarkCase, catalogue: Catalogue): Promise<SalesEngineerInput> {
  const th = thread(`th_bench_${c.id}`);
  const subject = c.subject ?? "Monitoring quote request";
  const latest = c.turns[c.turns.length - 1] ?? "";

  const attachments: MessageAttachment[] = [];
  if (c.attachments && c.attachments.length > 0) {
    for (const filename of c.attachments) {
      const fullPath = resolveAttachmentPath(filename);
      if (fullPath && fs.existsSync(fullPath)) {
        try {
          const buffer = fs.readFileSync(fullPath);
          const parsed = await parseInboundDocument({ filename, buffer });
          attachments.push({
            name: parsed.filename,
            contentType: parsed.contentType,
            sizeBytes: parsed.sizeBytes,
            scanned: true,
            extractedText: parsed.text,
            documentKind: parsed.documentKind,
            contentBase64: parsed.contentBase64,
          });
        } catch {
          // ignore read failure
        }
      }
    }
  }

  if (attachments.length === 0 && c.attachmentTexts && c.attachmentTexts.length > 0) {
    for (let i = 0; i < c.attachmentTexts.length; i++) {
      attachments.push({
        name: c.attachments?.[i] ?? `attachment-${i + 1}.txt`,
        contentType: "text/plain",
        sizeBytes: Buffer.byteLength(c.attachmentTexts[i]!, "utf8"),
        scanned: true,
        extractedText: c.attachmentTexts[i]!,
        documentKind: "text",
      });
    }
  }

  const parsedDocText = attachments.map((a) => a.extractedText || "").filter(Boolean).join("\n\n");
  const fallbackDocText = (c.attachmentTexts || []).join("\n\n");
  const docText = parsedDocText || fallbackDocText;
  const cumulativeText = docText ? `${c.turns.join("\n\n")}\n\n[Attached Documents]:\n${docText}` : c.turns.join("\n\n");

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

  let existingProfile: RequirementProfile | undefined = undefined;
  if (c.turns.length > 1) {
    let currentRes = extractRequirements({
      threadId: th.id,
      senderEmail: th.senderEmail,
      senderName: th.senderName,
      subject,
      bodyText: c.turns[0]!,
    });
    for (let t = 1; t < c.turns.length - 1; t++) {
      currentRes = mergeRequirements({
        existingProfile: currentRes.profile,
        replyText: c.turns[t]!,
        senderEmail: th.senderEmail,
        senderName: th.senderName,
        subject,
        cumulativeText: c.turns.slice(0, t + 1).join("\n\n"),
      });
    }
    existingProfile = currentRes.profile;
  }

  return {
    thread: th,
    latestMessageText: latest,
    cumulativeText,
    priorMessages: prior,
    existingProfile,
    catalogue,
    senderEmail: th.senderEmail,
    senderName: th.senderName,
    subject,
    attachments,
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

/**
 * Reconstructs a schema-valid AiDecisionOutput from the scored subset stored in benchmark results.
 *
 * Approximation documentation:
 * - customerSummary: mapped from freeText[0] or default "Customer monitoring environment and requirements.".
 * - reasoningSummary: mapped from freeText[freeText.length - 2] or customerSummary.
 * - conversationalResponse: mapped from freeText[freeText.length - 1] or null.
 * - identifiedNeeds: derived from intermediate freeText entries.
 * - missingRequirements: defaulted to empty array (not persisted separately in scored subset).
 * - assumptions: defaulted to empty array (flattened into freeText in scored subset).
 * - confidence: mapped from raw.confidence or defaulted to 0.95.
 * - knownRequirements confidence: defaulted to 1.0.
 * - humanReviewReasons: ["Requires human review"] if action is human_review, else empty.
 */
export function reconstructRawDecision(raw: ScoredOutput | null): AiDecisionOutput | null {
  if (!raw) return null;
  const free = raw.freeText || [];
  const customerSummary =
    free[0] && free[0].trim().length > 0 ? free[0].slice(0, 600) : "Customer monitoring environment and requirements.";
  const reasoningSummary =
    free.length >= 2 && free[free.length - 2] && free[free.length - 2]!.trim().length > 0
      ? free[free.length - 2]!.slice(0, 900)
      : customerSummary.slice(0, 900);
  const conversational =
    free.length > 0 && free[free.length - 1] && free[free.length - 1]!.trim().length > 0
      ? free[free.length - 1]!.slice(0, 800)
      : null;
  const identifiedNeeds = free
    .slice(1, Math.max(1, free.length - 2))
    .map((s) => s.slice(0, 200))
    .filter(Boolean)
    .slice(0, 12);

  return {
    action: raw.action,
    customerSummary,
    identifiedNeeds,
    knownRequirements: (raw.claims || []).map((c) => ({
      unit: c.unit,
      quantity: c.quantity,
      basis: c.basis ?? "stated",
      evidence: (c.evidence ?? "").slice(0, 400),
      confidence: 1.0,
    })),
    missingRequirements: [],
    assumptions: [],
    recommendedProductCategories: (raw.recommendedCategories || []).filter((cat): cat is (typeof PRODUCT_CATEGORIES)[number] =>
      PRODUCT_CATEGORIES.includes(cat as (typeof PRODUCT_CATEGORIES)[number]),
    ),
    referencedPlanIds: (raw.referencedPlanIds || []).map((p) => p.slice(0, 80)).slice(0, 6),
    followUpQuestions: (raw.followUpQuestions || []).map((q) => q.slice(0, 300)).slice(0, 4),
    reasoningSummary,
    confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.95,
    humanReviewReasons: raw.action === "human_review" ? ["Requires human review"] : [],
    conversationalResponse: conversational,
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
  rawDecision?: AiDecisionOutput | null;
  final: ScoredOutput;
}

/** Wraps a provider so the raw model answer can be captured, with patient retry on rate limits respecting retry-after. */
function recorder(inner: AiProvider, rateLimitWaitMs: number) {
  let last: AiProviderResult | null = null;
  const provider: AiProvider = {
    name: inner.name,
    async generateDecision(input) {
      let result = await inner.generateDecision(input);
      for (let retry = 0; retry < 4 && !result.ok && result.category === "rate_limited"; retry += 1) {
        let waitMs = rateLimitWaitMs;
        const match = result.detail.match(/retry after (\d+(?:\.\d+)?)s/i);
        if (match) {
          const sec = parseFloat(match[1]!);
          if (sec > 0) waitMs = Math.min(Math.max(waitMs, Math.ceil(sec + 1) * 1000), 30_000);
        }
        console.warn(`[Runner] Rate-limited on ${inner.name}. Waiting ${waitMs}ms before retry ${retry + 1}/4...`);
        await sleep(waitMs);
        result = await inner.generateDecision(input);
      }
      last = result;
      return result;
    },
  };
  return { provider, last: () => last };
}

export async function runCase(c: BenchmarkCase, catalogue: Catalogue, provider: AiProvider | null, rateLimitWaitMs = 15_000): Promise<CaseRun> {
  const input = await buildInput(c, catalogue);
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
    rawDecision: result && result.ok ? result.decision : null,
    final: finalToScored(decision),
  };
}

// ---------------------------------------------------------------------------
// Running the whole benchmark
// ---------------------------------------------------------------------------

export interface RunProgressInfo {
  index: number;
  total: number;
  repeat: number;
  totalRepeats: number;
  caseId: string;
  category: string;
  providerStatus: "n/a" | "ok" | "failed";
  latencyMs: number | null;
  failure: string | null;
  action: string;
}

export interface RunOptions {
  providerName: string;
  provider: AiProvider | null;
  delayMs?: number;
  repeats?: number;
  limit?: number;
  ids?: string[];
  categories?: string[];
  cases?: BenchmarkCase[];
  onProgress?: (info: RunProgressInfo) => void;
  replayRuns?: Array<CaseRun>;
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

export const DATASET_VERSION = "v2";

export async function runBenchmark(options: RunOptions): Promise<BenchmarkResult> {
  const catalogue = loadActiveCatalogue();
  const ctx: DetectContext = {
    planIds: new Set(catalogue.plans.map((p) => p.id)),
    supportedCategories: new Set(deriveSupportedCategories(catalogue)),
  };
  const isReplay = Array.isArray(options.replayRuns) && options.replayRuns.length > 0;
  const replayMap = isReplay ? new Map(options.replayRuns!.map((r) => [r.caseId, r])) : null;

  let selected = options.cases ?? (isReplay && options.replayRuns!.length <= 40 ? BENCHMARK_CASES_V1 : BENCHMARK_CASES);
  if (isReplay && !options.cases) {
    const replayIds = new Set(options.replayRuns!.map((r) => r.caseId));
    selected = selected.filter((c) => replayIds.has(c.id));
  }
  if (options.ids?.length) selected = selected.filter((c) => options.ids?.includes(c.id));
  if (options.categories?.length) selected = selected.filter((c) => options.categories?.includes(c.category));
  if (options.limit) selected = selected.slice(0, options.limit);

  const repeats = Math.max(1, options.repeats ?? 1);
  const runs: BenchmarkResult["runs"] = [];
  const byId = new Map(selected.map((c) => [c.id, c]));

  let currentDelayMs = options.delayMs ?? (options.provider ? 3000 : 0);

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (let i = 0; i < selected.length; i += 1) {
      const c = selected[i]!;
      let run: CaseRun;

      if (replayMap) {
        const replayRun = replayMap.get(c.id);
        const rawDec = replayRun ? (replayRun.rawDecision ?? reconstructRawDecision(replayRun.raw)) : null;
        const mockProvider: AiProvider = {
          name: replayRun?.source ? `replay-${replayRun.source}` : "replay",
          async generateDecision() {
            if (!rawDec) {
              return {
                ok: false,
                category: "provider_error",
                detail: replayRun?.failure ?? "No recorded decision available for replay",
                model: replayRun?.model ?? null,
                latencyMs: 0,
                attempts: 1,
              };
            }
            return {
              ok: true,
              decision: rawDec,
              model: replayRun?.model ?? "replay-model",
              latencyMs: replayRun?.latencyMs ?? 0,
              attempts: 1,
            };
          },
        };
        run = await runCase(c, catalogue, mockProvider, 0);
      } else {
        run = await runCase(c, catalogue, options.provider);
      }
      runs.push({ ...run, repeat });

      options.onProgress?.({
        index: i + 1,
        total: selected.length,
        repeat: repeat + 1,
        totalRepeats: repeats,
        caseId: c.id,
        category: c.category,
        providerStatus: run.providerStatus,
        latencyMs: run.latencyMs,
        failure: run.failure,
        action: run.final.action,
      });

      if (run.failure?.includes("rate_limited")) {
        currentDelayMs = Math.max(currentDelayMs + 2000, 6000);
        console.warn(`[Benchmark] Provider rate-limited on ${c.id}. Slowing interval delay to ${currentDelayMs}ms.`);
      }

      if (options.provider && currentDelayMs) await sleep(currentDelayMs);
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
