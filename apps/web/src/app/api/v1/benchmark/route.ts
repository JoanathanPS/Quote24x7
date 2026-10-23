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
      if (!selectedResult || parsed.meta.startedAt > selectedResult.meta.startedAt) selectedResult = parsed;
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

          if (!selectedResult || parsed.meta.startedAt > selectedResult.meta.startedAt) selectedResult = parsed;
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
