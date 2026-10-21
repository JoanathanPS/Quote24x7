import { NextResponse } from "next/server";
import { runBenchmark } from "@/server/ai/eval/benchmark-runner";
import type { BenchmarkCategory } from "@/server/ai/eval/types";
import { BENCHMARK_CASES as RAW_CASES } from "@/server/benchmark/cases";
import { getAppConfig } from "@/server/config";
import { store } from "@/server/store/session-store";
import { groqProvider } from "@/server/ai/groq-provider";
import { cerebrasProvider } from "@/server/ai/cerebras-provider";
import { geminiProvider } from "@/server/ai/gemini-provider";
import { ollamaProvider } from "@/server/ai/ollama-provider";

export async function GET() {
  await store.ensureInitializedAsync();
  const config = getAppConfig();
  const activeProvider = store.getActiveAiProvider();

  // Aggregate category counts from dataset
  const categoryCounts: Record<string, number> = {};
  for (const c of RAW_CASES) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
  }

  return NextResponse.json({
    name: "Quote24x7 AI Evaluation Benchmark",
    description:
      "Automated evaluation harness detecting accuracy, hallucinations, and providing 40 ground-truth benchmark cases.",
    activeProvider,
    dataset: {
      totalCases: RAW_CASES.length,
      datasetVersion: "v1.0.0",
      categories: categoryCounts,
    },
    metricsTracked: [
      "action_accuracy_strict",
      "action_accuracy_lenient",
      "exact_quantity_match",
      "quantity_precision",
      "quantity_recall",
      "quantity_f1",
      "hallucination_rate",
      "premature_quote_rate",
      "follow_up_coverage",
    ],
    hallucinationTaxonomy: [
      "fabricated_quantity",
      "contradicted_negation",
      "distractor_value",
      "unsupported_evidence",
      "unsupported_number",
      "unknown_plan_id",
      "price_leak",
      "system_prompt_leak",
      "premature_quote",
    ],
    supportedProviders: {
      rules: { name: "Deterministic Rules Baseline", status: "always_ready" },
      groq: { name: "Groq Cloud LPU", configured: Boolean(config.groqApiKey) },
      cerebras: { name: "Cerebras CS-3", configured: Boolean(config.cerebrasApiKey) },
      gemini: { name: "Google Gemini", configured: Boolean(config.geminiApiKey) },
      ollama: { name: "Local Ollama (llama3.2:1b)", endpoint: config.ollamaBaseUrl, configured: true },
    },
  });
}

export async function POST(req: Request) {
  await store.ensureInitializedAsync();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      provider?: "rules" | "groq" | "cerebras" | "gemini" | "ollama";
      category?: BenchmarkCategory;
    };

    const targetProvider = body.provider || "rules";

    let aiProviderInstance = null;
    let useRulesBaseline = false;

    if (targetProvider === "rules") {
      useRulesBaseline = true;
    } else if (targetProvider === "groq") {
      aiProviderInstance = groqProvider;
    } else if (targetProvider === "cerebras") {
      aiProviderInstance = cerebrasProvider;
    } else if (targetProvider === "gemini") {
      aiProviderInstance = geminiProvider;
    } else if (targetProvider === "ollama") {
      aiProviderInstance = ollamaProvider;
    } else {
      useRulesBaseline = true;
    }

    const report = await runBenchmark({
      useRulesBaseline,
      provider: aiProviderInstance || undefined,
      categoryFilter: body.category,
    });

    return NextResponse.json({
      success: true,
      provider: targetProvider,
      report,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
