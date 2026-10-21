import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { BENCHMARK_CASES } from "@/server/benchmark/cases";
import { runBenchmark, type BenchmarkResult, type CaseRun } from "@/server/benchmark/runner";
import { groqProvider } from "@/server/ai/groq-provider";
import { cerebrasProvider } from "@/server/ai/cerebras-provider";
import { geminiProvider } from "@/server/ai/gemini-provider";
import type { AiProvider } from "@/server/ai/gemini-provider";

const RESULTS_DIR = path.resolve(process.cwd(), "benchmark-results");

export async function GET() {
  try {
    let files: string[] = [];
    try {
      const entries = await fs.readdir(RESULTS_DIR);
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

    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(RESULTS_DIR, file), "utf-8");
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
        }
      } catch {
        // Skip malformed files
      }
    }

    // Sort newest first
    availableRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({
      success: true,
      totalCases: BENCHMARK_CASES.length,
      availableRuns,
      benchmarkCases: BENCHMARK_CASES.map((c) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        expectedAction: c.expected.action,
        expectedQuantities: c.expected.requirements,
        turnsCount: c.turns.length,
      })),
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
      const groqFile = path.join(RESULTS_DIR, "groq-2026-10-21T09-07-48-218Z.json");
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
