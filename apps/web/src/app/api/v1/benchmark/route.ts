import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { BENCHMARK_CASES } from "@/server/benchmark/cases";
import type { CaseScore } from "@/server/benchmark/types";
import { runBenchmark, type BenchmarkResult, type CaseRun } from "@/server/benchmark/runner";
import { groqProvider } from "@/server/ai/groq-provider";
import { cerebrasProvider } from "@/server/ai/cerebras-provider";
import { geminiProvider } from "@/server/ai/gemini-provider";
import type { AiProvider } from "@/server/ai/gemini-provider";

function getResultsDir(): string {
  const p1 = path.resolve(process.cwd(), "benchmark-results");
  if (fsSync.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), "apps/web/benchmark-results");
  if (fsSync.existsSync(p2)) return p2;
  return p1;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get("download") === "dataset") {
      const datasetPath = fsSync.existsSync(path.resolve(process.cwd(), "benchmark-dataset-v1.json"))
        ? path.resolve(process.cwd(), "benchmark-dataset-v1.json")
        : path.resolve(process.cwd(), "apps/web/benchmark-dataset-v1.json");
      const content = await fs.readFile(datasetPath, "utf-8");
      return new NextResponse(content, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="benchmark-dataset-v1.json"',
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
      provider: string;
      timestamp: string;
      casesCount: number;
      actionAccuracy: number;
      exactMatch: number;
      hallucinatedCaseRate: number;
      f1: number;
    }> = [];

    let cerebrasResult: BenchmarkResult | null = null;

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(resultsDir, file), "utf-8");
        const parsed = JSON.parse(content) as BenchmarkResult;
        if (parsed?.meta && parsed?.final?.metrics) {
          availableRuns.push({
            filename: file,
            provider: parsed.meta.provider,
            timestamp: parsed.meta.startedAt,
            casesCount: parsed.meta.cases,
            actionAccuracy: parsed.final.metrics.actionStrict.rate,
            exactMatch: parsed.final.metrics.exactMatch.rate,
            hallucinatedCaseRate: parsed.final.metrics.hallucinatedCases.rate,
            f1: parsed.final.metrics.f1 ?? 0,
          });

          // Pick the 40-case Cerebras run for per-case detailed evaluation
          if (
            file.startsWith("cerebras-") &&
            parsed.meta.cases === 40 &&
            (!cerebrasResult || parsed.meta.startedAt > cerebrasResult.meta.startedAt)
          ) {
            cerebrasResult = parsed;
          }
        }
      } catch {
        // Skip malformed files
      }
    }

    // Sort newest first
    availableRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Map cerebras scores by case ID
    const cerebrasScores = new Map<string, CaseScore>();
    if (cerebrasResult?.final?.scores) {
      for (const s of cerebrasResult.final.scores) {
        cerebrasScores.set(s.caseId, s);
      }
    }

    const benchmarkCases = BENCHMARK_CASES.map((c) => {
      const score = cerebrasScores.get(c.id);

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

      return {
        id: c.id,
        category: c.category,
        description: c.description,
        subject: c.subject || c.description,
        testedContent: c.turns.join("\n\n---\n\n"),
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
      };
    });

    return NextResponse.json({
      success: true,
      totalCases: BENCHMARK_CASES.length,
      availableRuns,
      benchmarkCases,
      cerebrasMetrics: cerebrasResult?.final?.metrics || null,
      supabaseDatasetUrl: "https://rezunroklwuzwahzknbz.supabase.co/storage/v1/object/public/benchmark-datasets/benchmark-dataset-v1.json",
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
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
