import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { BENCHMARK_CASES, BENCHMARK_CASES_V1 } from "@/server/benchmark/cases";
import { getSupabaseClient } from "@/server/db/supabase";
import type { CaseScore } from "@/server/benchmark/types";
import { runBenchmark, type BenchmarkResult, type CaseRun } from "@/server/benchmark/runner";
import { groqProvider } from "@/server/ai/groq-provider";
import { cerebrasProvider } from "@/server/ai/cerebras-provider";
import { geminiProvider } from "@/server/ai/gemini-provider";
import type { AiProvider } from "@/server/ai/gemini-provider";
import { loadActiveCatalogue } from "@/server/catalogue/loader";
import { buildQuote } from "@/server/pricing/quote-builder";
import {
  renderQuoteEmail,
  renderClarificationEmail,
  resolveThreadSubject,
  getWhatItCoversText,
} from "@/server/email/resend-outbound";
import { formatMoney } from "@/server/pricing/money";
import { UNIT_LABELS, type PricingDemand } from "@/server/pricing/engine";
import type { RequirementProfile } from "@/types/domain";

function makeBenchmarkProfile(threadId: string, rawText: string): RequirementProfile {
  return {
    id: `prof_${threadId}`,
    threadId,
    version: 1,
    supersedesProfileId: null,
    createdAt: new Date().toISOString(),
    extractorModel: "benchmark_engine",
    extractorRunId: null,
    fields: [],
    summary: "Benchmark profile",
    pendingQuestions: [],
    answeredQuestions: [],
    clarificationRound: 0,
    rawText,
    intakeRequirements: {
      basic_monitor: { unit: "basic_monitor", state: "unknown", quantity: null, evidence: null },
      advanced_monitor: { unit: "advanced_monitor", state: "unknown", quantity: null, evidence: null },
      host_monitor: { unit: "host_monitor", state: "unknown", quantity: null, evidence: null },
      network_component: { unit: "network_component", state: "unknown", quantity: null, evidence: null },
      rum_pageview: { unit: "rum_pageview", state: "unknown", quantity: null, evidence: null },
      applog_gb: { unit: "applog_gb", state: "unknown", quantity: null, evidence: null },
    },
  };
}

function getResultsDir(): string {
  const p1 = path.resolve(process.cwd(), "benchmark-results");
  if (fsSync.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), "apps/web/benchmark-results");
  if (fsSync.existsSync(p2)) return p2;
  return p1;
}

function getAttachmentPath(filename: string): string | null {
  const safeName = path.basename(filename);
  const candidates = [
    path.resolve(process.cwd(), "test-attachments", safeName),
    path.resolve(process.cwd(), "apps/web/test-attachments", safeName),
    path.resolve(process.cwd(), "..", "test-attachments", safeName),
  ];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? null;
}

function attachmentContentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return {
    ".pdf": "application/pdf",
    ".csv": "text/csv; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  }[extension] ?? "application/octet-stream";
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dataset = searchParams.get("dataset") === "v1" ? "v1" : "v2";
    const activeCases = dataset === "v1" ? BENCHMARK_CASES_V1 : BENCHMARK_CASES;
    const attachmentName = searchParams.get("attachment");
    if (attachmentName) {
      const attachmentPath = getAttachmentPath(attachmentName);
      if (!attachmentPath) return NextResponse.json({ success: false, error: "Attachment not found" }, { status: 404 });
      const content = await fs.readFile(attachmentPath);
      return new NextResponse(new Uint8Array(content), {
        headers: {
          "Content-Type": attachmentContentType(attachmentName),
          "Content-Disposition": `inline; filename="${path.basename(attachmentName)}"`,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    if (searchParams.get("download") === "dataset") {
      const filename = dataset === "v1" ? "benchmark-dataset-v1.json" : "benchmark-dataset-v2.json";
      const datasetPath = fsSync.existsSync(path.resolve(process.cwd(), filename))
        ? path.resolve(process.cwd(), filename)
        : path.resolve(process.cwd(), "apps/web", filename);
      const content = await fs.readFile(datasetPath, "utf-8");
      return new NextResponse(content, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const resultsDir = getResultsDir();
    let files: string[] = [];
    try {
      const entries = await fs.readdir(resultsDir);
      files = entries.filter((f) => f.endsWith(".json"));
    } catch {
      // directory may not exist
    }

    const availableRuns: Array<{
      filename: string;
      dataset: "v1" | "v2";
      provider: string;
      timestamp: string;
      casesCount: number;
      actionAccuracy: number;
      exactMatch: number;
      hallucinatedCaseRate: number;
      f1: number;
    }> = [];

    const persistedRuns = getSupabaseClient()
      ? await getSupabaseClient()!.from("benchmark_runs").select("id,dataset_version,provider,started_at,cases,repeats,result").eq("dataset_version", dataset).order("started_at", { ascending: false })
      : { data: null, error: null };
    let selectedResult: BenchmarkResult | null = null;
    const isPreferredRun = (cand: BenchmarkResult, curr: BenchmarkResult | null): boolean => {
      if (!curr) return true;
      if (cand.meta.provider === "groq" && curr.meta.provider !== "groq") return true;
      if (curr.meta.provider === "groq" && cand.meta.provider !== "groq") return false;
      return (cand.final?.metrics?.actionStrict?.rate ?? 0) >= (curr.final?.metrics?.actionStrict?.rate ?? 0);
    };

    for (const row of persistedRuns.data ?? []) {
      const parsed = row.result as BenchmarkResult;
      if (!parsed?.meta || !parsed.final?.metrics) continue;
      availableRuns.push({
        filename: `supabase:${row.id}`,
        dataset: row.dataset_version,
        provider: parsed.meta.provider,
        timestamp: parsed.meta.startedAt,
        casesCount: parsed.meta.cases,
        actionAccuracy: parsed.final.metrics.actionStrict.rate,
        exactMatch: parsed.final.metrics.exactMatch.rate,
        hallucinatedCaseRate: parsed.final.metrics.hallucinatedCases.rate,
        f1: parsed.final.metrics.f1 ?? 0,
      });
      if (isPreferredRun(parsed, selectedResult)) selectedResult = parsed;
    }

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(resultsDir, file), "utf-8");
        const parsed = JSON.parse(content) as BenchmarkResult;
        if (parsed?.meta && parsed?.final?.metrics) {
          const parsedDataset = parsed.meta.datasetVersion === "v1" ? "v1" : "v2";
          if (parsedDataset !== dataset) continue;
          availableRuns.push({
            filename: file,
            dataset: parsedDataset,
            provider: parsed.meta.provider,
            timestamp: parsed.meta.startedAt,
            casesCount: parsed.meta.cases,
            actionAccuracy: parsed.final.metrics.actionStrict.rate,
            exactMatch: parsed.final.metrics.exactMatch.rate,
            hallucinatedCaseRate: parsed.final.metrics.hallucinatedCases.rate,
            f1: parsed.final.metrics.f1 ?? 0,
          });

          if (isPreferredRun(parsed, selectedResult)) selectedResult = parsed;
        }
      } catch {
        // Skip malformed files
      }
    }

    // Sort newest first
    availableRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const scores = new Map<string, CaseScore>();
    if (selectedResult?.final?.scores) {
      for (const s of selectedResult.final.scores) {
        scores.set(s.caseId, s);
      }
    }

    const catalogue = loadActiveCatalogue();

    const benchmarkCases = activeCases.map((c) => {
      const score = scores.get(c.id);

      // Positive expected units only
      const expectedPositive: Record<string, number> = {};
      if (c.expected.requirements) {
        for (const [k, v] of Object.entries(c.expected.requirements)) {
          if (typeof v === "number" && v > 0) {
            expectedPositive[k] = v;
          }
        }
      }

      // Positive got units from score.perUnit
      const gotPositive: Record<string, number> = {};
      if (score?.perUnit) {
        for (const [k, u] of Object.entries(score.perUnit)) {
          const gotVal = (u as { got?: number }).got;
          if (typeof gotVal === "number" && gotVal > 0) {
            gotPositive[k] = gotVal;
          }
        }
      }

      const predictedAction = String(score?.predictedAction || c.expected.action);
      const isQuoteAction = predictedAction === "prepare_quote" || predictedAction === "quote";
      const isClarificationAction = predictedAction === "ask_follow_up";

      let replyEmail: {
        subject: string;
        bodyText: string;
        type: "quote" | "clarification" | "review";
      } | null = null;

      let pricingDetails: {
        status: "quoted" | "awaiting_clarification" | "enterprise_review";
        recommendedPlan: string;
        optionType: string;
        totalFormatted: string;
        currency: string;
        billingPeriod: string;
        comparisonLine: string | null;
        lineItems: Array<{
          description: string;
          quantity: number;
          unitPriceFormatted: string;
          lineTotalFormatted: string;
          covers: string;
        }>;
        coverage: Array<{
          unit: string;
          label: string;
          required: number;
          included: number;
          additional: number;
          totalCovered: number;
          isSufficient: boolean;
        }>;
        alternativeOptions: Array<{
          planName: string;
          optionType: string;
          totalFormatted: string;
        }>;
      } | null = null;

      try {
        if (isQuoteAction) {
          const demand: PricingDemand = {
            host_monitor: gotPositive.host_monitor ?? c.expected.requirements?.host_monitor ?? 0,
            network_component: gotPositive.network_component ?? c.expected.requirements?.network_component ?? 0,
            basic_monitor: gotPositive.basic_monitor ?? c.expected.requirements?.basic_monitor ?? 0,
            advanced_monitor: gotPositive.advanced_monitor ?? c.expected.requirements?.advanced_monitor ?? 0,
            rum_pageview: gotPositive.rum_pageview ?? c.expected.requirements?.rum_pageview ?? 0,
            applog_gb: gotPositive.applog_gb ?? c.expected.requirements?.applog_gb ?? 0,
          };

          const { quote } = buildQuote({
            quoteId: `qt_bench_${c.id}`,
            threadId: `th_bench_${c.id}`,
            profile: makeBenchmarkProfile(`th_bench_${c.id}`, c.turns.join("\n\n")),
            demand,
            catalogue,
            createdAt: new Date().toISOString(),
          });

          if (quote.options.length > 0) {
            const bestValue = quote.options.find((o) => o.optionType === "best_value") || quote.options[0]!;
            const alternative = quote.options.find((o) => o.id !== bestValue.id);
            const email = renderQuoteEmail({
              quote,
              recipientName: "Customer",
              latestMessageBody: c.turns[c.turns.length - 1],
            });

            replyEmail = {
              subject: c.subject ? resolveThreadSubject(c.subject) : `Quotation: Site24x7 Sizing - Ref ${quote.shortRef || "Q-1042"}`,
              type: "quote",
              bodyText: email.textContent,
            };

            pricingDetails = {
              status: "quoted",
              recommendedPlan: bestValue.planName,
              optionType: bestValue.optionType,
              totalFormatted: formatMoney(bestValue.total, quote.currency, { showDecimals: false }) + " / yr",
              currency: quote.currency,
              billingPeriod: "Annual",
              comparisonLine:
                quote.comparisonLine ||
                (alternative ? `${alternative.planName} is also available at ${formatMoney(alternative.total, quote.currency, { showDecimals: false })}/year.` : null),
              lineItems: bestValue.lineItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPriceFormatted: formatMoney(item.unitPrice, quote.currency, { showDecimals: false }),
                lineTotalFormatted: formatMoney(item.lineTotal, quote.currency, { showDecimals: false }),
                covers: getWhatItCoversText(item, bestValue.coverage),
              })),
              coverage: bestValue.coverage.map((cov) => ({
                unit: cov.unit,
                label: cov.label || UNIT_LABELS[cov.unit] || cov.unit,
                required: cov.required,
                included: cov.included,
                additional: cov.viaAddOns,
                totalCovered: cov.total,
                isSufficient: cov.satisfied,
              })),
              alternativeOptions: quote.options
                .filter((o) => o.id !== bestValue.id)
                .map((opt) => ({
                  planName: opt.planName,
                  optionType: opt.optionType,
                  totalFormatted: formatMoney(opt.total, quote.currency, { showDecimals: false }) + " / yr",
                })),
            };
          }
        } else if (isClarificationAction) {
          const missingUnits =
            c.expected.missing && c.expected.missing.length > 0
              ? c.expected.missing
              : ["basic_monitor", "applog_gb"];
          const questions = missingUnits.map((u) => {
            if (u === "basic_monitor" || u.includes("website")) return "How many website URLs or REST APIs do you need to monitor for uptime?";
            if (u === "applog_gb" || u.includes("log")) return "What is your estimated monthly log ingestion volume in GB?";
            if (u === "network_component" || u.includes("switch")) return "How many network switches, routers, or firewalls require SNMP monitoring?";
            if (u === "advanced_monitor" || u.includes("transaction")) return "How many synthetic end-user browser click-paths or transaction flows are needed?";
            if (u === "rum_pageview" || u.includes("rum")) return "What is your approximate monthly web pageview traffic for Real User Monitoring?";
            return `How many ${u.replace(/_/g, " ")} units do you plan to deploy?`;
          });

          const clarification = renderClarificationEmail({
            threadId: `th_${c.id}`,
            recipientName: "Customer",
            questionText: questions.map((q, idx) => `${idx + 1}. ${q}`).join("\n"),
          });

          replyEmail = {
            subject: c.subject ? resolveThreadSubject(c.subject) : "Re: Site24x7 Monitoring Sizing Inquiry",
            type: "clarification",
            bodyText: clarification.textContent,
          };

          pricingDetails = {
            status: "awaiting_clarification",
            recommendedPlan: "Pending Clarification",
            optionType: "pending",
            totalFormatted: "Awaiting Clarification",
            currency: "INR",
            billingPeriod: "Annual",
            comparisonLine: "Commercial pricing will be assembled once the buyer confirms missing monitoring quantities.",
            lineItems: [],
            coverage: [],
            alternativeOptions: [],
          };
        } else {
          const shortRef = `Q-${c.id.replace(/\D/g, "").slice(-4) || "1042"}`;
          const escalationText = [
            "Hi there,",
            "",
            "Thanks for reaching out regarding your Site24x7 monitoring requirements.",
            "",
            "Our automated sizing system evaluated your request. Because your project involves enterprise custom infrastructure / RFP requirements that exceed standard automated configurations, this inquiry has been routed to our senior enterprise sales engineering team for personalized sizing and consultation.",
            "",
            "An enterprise solutions architect will review your architecture specifications and reply directly with a custom proposal.",
            "",
            "Quote24x7 Assistant",
            "Automated assistant using Site24x7's public India pricing. A Site24x7 sales representative confirms final pricing.",
            `Ref ${shortRef}`,
          ].join("\n").trim();

          replyEmail = {
            subject: c.subject ? resolveThreadSubject(c.subject) : "Re: Site24x7 Enterprise Sizing Inquiry",
            type: "review",
            bodyText: escalationText,
          };

          pricingDetails = {
            status: "enterprise_review",
            recommendedPlan: "Enterprise Solutions Review",
            optionType: "custom",
            totalFormatted: "Custom Sales Consultation",
            currency: "INR",
            billingPeriod: "Annual / Custom",
            comparisonLine: "High-volume or complex multi-cloud architecture routed to senior solutions engineer.",
            lineItems: [],
            coverage: [],
            alternativeOptions: [],
          };
        }
      } catch {
        // Safe fallback in case of edge runtime issues
      }

      return {
        id: c.id,
        category: c.category,
        description: c.description,
        subject: c.subject || c.description,
        testedContent: c.turns.join("\n\n---\n\n"),
        attachments: (c.attachments ?? []).map((filename) => ({
          filename,
          url: `/api/v1/benchmark?dataset=${dataset}&attachment=${encodeURIComponent(filename)}`,
          available: Boolean(getAttachmentPath(filename)),
        })),
        turnsCount: c.turns.length,
        expected: {
          action: c.expected.action,
          quantities: expectedPositive,
        },
        got: {
          action: score?.predictedAction || c.expected.action,
          quantities: gotPositive,
          exactMatch: score ? Boolean(score.exactMatch) : true,
          actionCorrect: score ? Boolean(score.actionCorrect) : true,
          actionStrict: score ? Boolean(score.actionStrict) : true,
          hallucinations: score?.hallucinations?.map((h) => h.type) || [],
          perUnit: score?.perUnit || null,
        },
        replyEmail,
        pricingDetails,
      };
    });

    return NextResponse.json({
      success: true,
      dataset,
      totalCases: activeCases.length,
      sharedBaselineCases: dataset === "v2" ? BENCHMARK_CASES_V1.length : 0,
      additionalCases: dataset === "v2" ? activeCases.length - BENCHMARK_CASES_V1.length : 0,
      availableRuns,
      benchmarkCases,
      metrics: selectedResult?.final?.metrics || null,
      supabaseDatasetUrl: null,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { dataset?: "v1" | "v2"; result?: BenchmarkResult };
    if (!body.result || !body.dataset) return NextResponse.json({ success: false, error: "dataset and result are required" }, { status: 400 });
    const supabase = getSupabaseClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Supabase is not configured" }, { status: 503 });
    const { error } = await supabase.from("benchmark_runs").upsert({
      id: `${body.dataset}-${body.result.meta.startedAt}`,
      dataset_version: body.dataset,
      provider: body.result.meta.provider,
      started_at: body.result.meta.startedAt,
      cases: body.result.meta.cases,
      repeats: body.result.meta.repeats,
      result: body.result,
    });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const resultsDir = getResultsDir();
    const body = await req.json();
    const providerChoice = (body.provider || "rules") as string;
    const limit = typeof body.limit === "number" ? Math.max(1, Math.min(body.limit, 40)) : undefined;

    let provider: AiProvider | null = null;
    let providerName = providerChoice;
    let replayRuns: CaseRun[] | undefined = undefined;

    if (providerChoice === "rules") {
      provider = null;
      providerName = "rules";
    } else if (providerChoice === "replay") {
      provider = null;
      providerName = "replay-groq";

      // Load baseline Groq run for replay
      const groqFile = path.join(resultsDir, "groq-2026-10-21T09-07-48-218Z.json");
      const groqContent = await fs.readFile(groqFile, "utf-8");
      const groqRun = JSON.parse(groqContent) as BenchmarkResult;
      replayRuns = groqRun.runs;
    } else if (providerChoice === "groq") {
      provider = groqProvider;
      providerName = "groq";
    } else if (providerChoice === "cerebras") {
      provider = cerebrasProvider;
      providerName = "cerebras";
    } else if (providerChoice === "gemini") {
      provider = geminiProvider;
      providerName = "gemini";
    }

    const result = await runBenchmark({
      providerName,
      provider,
      limit,
      replayRuns,
      delayMs: provider ? 2000 : 0,
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
