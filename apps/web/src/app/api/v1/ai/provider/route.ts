import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { getAppConfig } from "@/server/config";
import pricingData from "@/data/site24x7-pricing-data.json";

export async function GET() {
  await store.ensureInitializedAsync();
  const config = getAppConfig();
  const activeProvider = store.getActiveAiProvider();

  return NextResponse.json({
    activeProvider,
    providers: {
      groq: {
        id: "groq",
        name: "Groq LPU (Cloud)",
        model: config.groqModel,
        configured: Boolean(config.groqApiKey),
        description: "Ultra-fast cloud inference with generous rate limits.",
      },
      ollama: {
        id: "ollama",
        name: "Local Ollama (Local AI)",
        model: config.ollamaModel,
        baseUrl: config.ollamaBaseUrl,
        configured: true,
        description: "Zero cloud egress, runs locally on localhost:11434 with llama3.2:1b.",
      },
      cerebras: {
        id: "cerebras",
        name: "Cerebras CS-3 (Cloud)",
        model: config.cerebrasModel,
        configured: Boolean(config.cerebrasApiKey),
        description: "Wafer-scale high-speed inference engine.",
      },
      gemini: {
        id: "gemini",
        name: "Google Gemini (Cloud)",
        model: config.geminiModel,
        configured: Boolean(config.geminiApiKey),
        description: "Google multimodal frontier model.",
      },
      rules: {
        id: "rules",
        name: "Deterministic Rules Engine",
        model: "rules-v1",
        configured: true,
        description: "Zero-token deterministic regex & rules fallback engine.",
      },
    },
    dataset: {
      loaded: Boolean(pricingData?.title),
      title: pricingData?.title || "Site24x7 small model pricing catalog",
      version: pricingData?.schema_version || "1.0.0",
      collectedAt: pricingData?.collected_at || "2026-10-21",
      plansCount: pricingData?.plans?.length || 0,
      addonsCount: pricingData?.addon_packs?.length || 0,
      rulesCount: pricingData?.license_rules?.length || 0,
      examplesCount: pricingData?.worked_examples?.length || 0,
    },
  });
}

export async function POST(req: Request) {
  await store.ensureInitializedAsync();
  try {
    const body = (await req.json()) as { provider?: string };
    const validProviders = ["groq", "ollama", "cerebras", "gemini", "rules"] as const;
    const provider = body.provider as "groq" | "ollama" | "cerebras" | "gemini" | "rules";

    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider '${body.provider}'. Valid options: ${validProviders.join(", ")}` },
        { status: 400 },
      );
    }

    store.setActiveAiProvider(provider);

    return NextResponse.json({
      success: true,
      activeProvider: store.getActiveAiProvider(),
      message: `Active AI provider switched to ${provider}.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
