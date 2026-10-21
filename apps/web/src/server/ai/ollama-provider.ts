import OpenAI from "openai";
import type { AiFailureCategory, ProductCategory } from "@/types/domain";
import { getAppConfig, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "../config.ts";
import {
  parseDecisionResponse,
  type AiProvider,
  type AiProviderResult,
  type GenerateDecisionInput,
} from "./gemini-provider.ts";
import { aiDecisionSchema } from "./decision-schema.ts";
import { DEMAND_UNITS, type DemandUnit } from "../pricing/engine.ts";
import { PRODUCT_CATEGORIES } from "./decision-schema.ts";
import { extractRequirements } from "../extraction/extractor.ts";

/**
 * Ollama Local AI Provider Adapter.
 *
 * Connects directly to a locally running Ollama instance (defaulting to http://localhost:11434/v1)
 * running models such as llama3.2:1b via the standard OpenAI-compatible SDK.
 *
 * Implements the standard AiProvider interface used across Quote24x7.
 */

export function createOllamaClient(customBaseUrl?: string, customApiKey?: string): OpenAI {
  const config = getAppConfig();
  return new OpenAI({
    baseURL: customBaseUrl || config.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
    apiKey: customApiKey || config.ollamaApiKey || "ollama-local-key",
  });
}

/**
 * Pings the local Ollama instance to verify reachability and enumerate installed models.
 */
export async function pingOllama(customBaseUrl?: string): Promise<{
  ok: boolean;
  baseUrl: string;
  configuredModel: string;
  latencyMs: number | null;
  modelsAvailable: string[];
  error?: string;
}> {
  const config = getAppConfig();
  const baseUrl = customBaseUrl || config.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
  const configuredModel = config.ollamaModel || DEFAULT_OLLAMA_MODEL;
  const start = Date.now();

  try {
    const client = createOllamaClient(baseUrl);
    // Attempt to list models via OpenAI-compatible endpoint
    const response = await client.models.list();
    const latencyMs = Date.now() - start;
    const modelsAvailable = response.data.map((m) => m.id);

    return {
      ok: true,
      baseUrl,
      configuredModel,
      latencyMs,
      modelsAvailable,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);

    // Provide human-friendly diagnosis
    let friendlyError = msg;
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes("econnrefused") || lowerMsg.includes("fetch failed") || lowerMsg.includes("connection")) {
      friendlyError = `Ollama engine is not running on ${baseUrl}. Start it with 'ollama serve' or 'ollama run ${configuredModel}'.`;
    }

    return {
      ok: false,
      baseUrl,
      configuredModel,
      latencyMs,
      modelsAvailable: [],
      error: friendlyError,
    };
  }
}

/**
 * Extracts and cleans JSON string from LLM response text,
 * stripping markdown fences, conversational preambles, and trailing notes.
 */
export function extractCleanJson(rawText: string): string {
  let cleaned = rawText.trim();

  // Strip Markdown ```json ... ``` code blocks if present
  const markdownMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    cleaned = markdownMatch[1].trim();
  }

  // Find outermost JSON object braces if surrounded by prose
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

/**
 * Normalizes small model (llama3.2:1b) output when the model produces nested objects
 * or slightly drifted schemas for fields like customerSummary, action, and knownRequirements.
 */
export function normalizeOllamaDecision(raw: unknown, userPrompt?: string): Record<string, unknown> {
  const rawObj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;

  // 1. Action normalization
  let action: "prepare_quote" | "ask_follow_up" | "human_review" = "ask_follow_up";
  const rawAction = String(rawObj.action || "").toLowerCase().trim();
  if (
    rawAction === "prepare_quote" ||
    rawAction === "quote" ||
    rawAction === "purchase" ||
    rawAction === "buy" ||
    rawAction === "proposal"
  ) {
    action = "prepare_quote";
  } else if (
    rawAction === "human_review" ||
    rawAction === "review" ||
    rawAction === "escalate" ||
    rawAction === "manual"
  ) {
    action = "human_review";
  } else {
    action = "ask_follow_up";
  }

  // 2. Customer summary
  let customerSummary = "Customer requested Site24x7 monitoring configuration.";
  if (typeof rawObj.customerSummary === "string" && rawObj.customerSummary.trim()) {
    customerSummary = rawObj.customerSummary.trim();
  } else if (typeof rawObj.customerSummary === "object" && rawObj.customerSummary !== null) {
    const cs = rawObj.customerSummary as Record<string, unknown>;
    customerSummary =
      (typeof cs.description === "string" && cs.description) ||
      (typeof cs.summary === "string" && cs.summary) ||
      (typeof cs.name === "string" && cs.name) ||
      JSON.stringify(rawObj.customerSummary);
  }

  // 3. Identified needs
  let identifiedNeeds: string[] = [];
  if (Array.isArray(rawObj.identifiedNeeds)) {
    identifiedNeeds = rawObj.identifiedNeeds
      .map((item: unknown) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const rec = item as Record<string, unknown>;
          return String(rec.description || rec.name || "");
        }
        return String(item ?? "");
      })
      .filter((s: string) => Boolean(s.trim()));
  }

  // 4. Known requirements
  const knownRequirements: Array<{
    unit: DemandUnit;
    quantity: number;
    basis: "stated" | "inferred";
    evidence: string;
    confidence: number;
  }> = [];

  const validUnits = new Set<string>(DEMAND_UNITS);

  if (Array.isArray(rawObj.knownRequirements)) {
    for (const req of rawObj.knownRequirements) {
      if (!req || typeof req !== "object") continue;
      const rObj = req as Record<string, unknown>;
      let unit = String(rObj.unit || "").toLowerCase().trim() as DemandUnit;
      let quantity = Number(rObj.quantity);

      if (!validUnits.has(unit)) {
        const textToSearch = `${String(rObj.name || "")} ${String(rObj.description || "")} ${String(rObj.unit || "")}`.toLowerCase();
        if (textToSearch.includes("server") || textToSearch.includes("linux") || textToSearch.includes("host") || textToSearch.includes("vm")) {
          unit = "host_monitor";
        } else if (textToSearch.includes("website") || textToSearch.includes("url") || textToSearch.includes("ping") || textToSearch.includes("uptime")) {
          unit = "basic_monitor";
        } else if (textToSearch.includes("synthetic") || textToSearch.includes("transaction") || textToSearch.includes("browser") || textToSearch.includes("advanced")) {
          unit = "advanced_monitor";
        } else if (textToSearch.includes("network") || textToSearch.includes("switch") || textToSearch.includes("router") || textToSearch.includes("firewall")) {
          unit = "network_component";
        } else if (textToSearch.includes("rum") || textToSearch.includes("pageview")) {
          unit = "rum_pageview";
        } else if (textToSearch.includes("log") || textToSearch.includes("applog")) {
          unit = "applog_gb";
        }
      }

      if (isNaN(quantity) || quantity < 0) {
        const numMatch = String(rObj.description || rObj.name || "").match(/\b(\d+)\b/);
        quantity = numMatch && numMatch[1] ? Number.parseInt(numMatch[1], 10) : 0;
      }

      if (validUnits.has(unit) && quantity >= 0) {
        knownRequirements.push({
          unit,
          quantity: Math.floor(quantity),
          basis: rObj.basis === "inferred" ? "inferred" : "stated",
          evidence: String(rObj.evidence || rObj.description || rObj.name || `${quantity} ${unit}`).slice(0, 390),
          confidence: typeof rObj.confidence === "number" && rObj.confidence >= 0 && rObj.confidence <= 1 ? rObj.confidence : 0.9,
        });
      }
    }
  }

  // Fallback: If known requirements is empty but user prompt had clear numbers, use extractor
  if (knownRequirements.length === 0 && userPrompt) {
    const extracted = extractRequirements({
      threadId: "ollama-inference-fallback",
      senderEmail: "client@example.com",
      subject: "Inquiry",
      bodyText: userPrompt,
    });
    for (const [unit, item] of Object.entries(extracted.intakeRequirements)) {
      if (item && item.state === "stated" && typeof item.quantity === "number" && item.quantity > 0) {
        knownRequirements.push({
          unit: unit as DemandUnit,
          quantity: item.quantity,
          basis: "stated",
          evidence: (item.evidence || userPrompt).slice(0, 390),
          confidence: 0.9,
        });
      }
    }
  }

  // 5. Reasoning summary
  let reasoningSummary = "Extracted monitoring requirements and determined appropriate next action.";
  if (typeof rawObj.reasoningSummary === "string" && rawObj.reasoningSummary.trim()) {
    reasoningSummary = rawObj.reasoningSummary.trim();
  } else if (typeof rawObj.reasoningSummary === "object" && rawObj.reasoningSummary !== null) {
    const rs = rawObj.reasoningSummary as Record<string, unknown>;
    reasoningSummary =
      (typeof rs.summary === "string" && rs.summary) ||
      (typeof rs.reasoning === "string" && rs.reasoning) ||
      JSON.stringify(rawObj.reasoningSummary);
  }

  // 6. Confidence
  let confidence = typeof rawObj.confidence === "number" ? rawObj.confidence : 0.85;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  // 7. Recommended categories
  const categories = new Set<string>(PRODUCT_CATEGORIES);
  const recommendedProductCategories = Array.isArray(rawObj.recommendedProductCategories)
    ? rawObj.recommendedProductCategories
        .map((c: unknown) => {
          if (typeof c === "string") return c;
          if (typeof c === "object" && c !== null) {
            return String((c as Record<string, unknown>).name || "");
          }
          return "";
        })
        .filter((c: string): c is ProductCategory => categories.has(c))
    : [];

  // Adjust action if knownRequirements is empty
  if (action === "prepare_quote" && knownRequirements.length === 0) {
    action = "ask_follow_up";
  }

  return {
    action,
    customerSummary: customerSummary.slice(0, 590),
    identifiedNeeds: identifiedNeeds.slice(0, 10),
    knownRequirements,
    missingRequirements: Array.isArray(rawObj.missingRequirements)
      ? rawObj.missingRequirements.filter((m: unknown) => {
          if (typeof m !== "object" || m === null) return false;
          const u = (m as { unit?: unknown }).unit;
          return typeof u === "string" && validUnits.has(u);
        })
      : [],
    assumptions: Array.isArray(rawObj.assumptions)
      ? rawObj.assumptions
          .map((a: unknown) => {
            if (typeof a === "string") return a;
            if (typeof a === "object" && a !== null) {
              return String((a as Record<string, unknown>).description || "");
            }
            return String(a ?? "");
          })
          .slice(0, 8)
      : [],
    recommendedProductCategories: recommendedProductCategories.length > 0
      ? recommendedProductCategories
      : ["infrastructure_monitoring"],
    referencedPlanIds: Array.isArray(rawObj.referencedPlanIds) ? rawObj.referencedPlanIds : [],
    followUpQuestions: Array.isArray(rawObj.followUpQuestions)
      ? rawObj.followUpQuestions
          .map((q: unknown) => {
            if (typeof q === "string") return q;
            if (typeof q === "object" && q !== null) {
              return String((q as Record<string, unknown>).question || "");
            }
            return String(q ?? "");
          })
          .slice(0, 4)
      : action === "ask_follow_up" ? ["Could you specify the counts of servers and URLs to monitor?"] : [],
    reasoningSummary: reasoningSummary.slice(0, 890),
    confidence,
    humanReviewReasons: Array.isArray(rawObj.humanReviewReasons) ? rawObj.humanReviewReasons : [],
    conversationalResponse: typeof rawObj.conversationalResponse === "string" ? rawObj.conversationalResponse : null,
  };
}

export const ollamaProvider: AiProvider = {
  name: "ollama",

  async generateDecision(input: GenerateDecisionInput): Promise<AiProviderResult> {
    const config = getAppConfig();
    const model = config.ollamaModel || DEFAULT_OLLAMA_MODEL;
    const startedAt = Date.now();

    // Guidance optimized for small models (like llama3.2:1b)
    const smallModelGuidance = `
IMPORTANT FOR SMALL MODELS:
- Output valid JSON matching the schema exactly.
- Do NOT wrap in conversational text. Return ONLY the JSON object.
- action must be one of: "prepare_quote", "ask_follow_up", or "human_review".
- Valid units: "host_monitor", "basic_monitor", "advanced_monitor", "network_component", "rum_pageview", "applog_gb".
- Example JSON shape:
{
  "action": "prepare_quote",
  "customerSummary": "Customer requires infrastructure monitoring.",
  "identifiedNeeds": ["Linux servers", "Websites"],
  "knownRequirements": [
    { "unit": "host_monitor", "quantity": 25, "basis": "stated", "evidence": "25 servers", "confidence": 0.95 }
  ],
  "missingRequirements": [],
  "assumptions": [],
  "recommendedProductCategories": ["infrastructure_monitoring"],
  "referencedPlanIds": [],
  "followUpQuestions": [],
  "reasoningSummary": "Requirements clearly stated by customer.",
  "confidence": 0.9,
  "humanReviewReasons": [],
  "conversationalResponse": null
}
`;

    const systemInstruction = `${input.systemInstruction}\n\n${smallModelGuidance}`;

    try {
      const client = createOllamaClient();

      // Call Ollama via OpenAI SDK with structured JSON object format
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: systemInstruction,
          },
          {
            role: "user",
            content: input.userPrompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
        temperature: 0.1,
      });

      const latencyMs = Date.now() - startedAt;
      const rawText = completion.choices[0]?.message?.content || "";

      if (!rawText.trim()) {
        return {
          ok: false,
          category: "schema_violation",
          detail: "Local Ollama returned an empty response.",
          model,
          latencyMs,
          attempts: 1,
        };
      }

      const cleanedJson = extractCleanJson(rawText);
      const parsed = parseDecisionResponse(cleanedJson);

      if (parsed.ok) {
        return {
          ok: true,
          decision: parsed.decision,
          model,
          latencyMs,
          attempts: 1,
        };
      }

      // If direct parse failed, attempt small-model normalization
      try {
        const rawObj = JSON.parse(cleanedJson);
        const normalized = normalizeOllamaDecision(rawObj, input.userPrompt);
        const normalizedValidation = aiDecisionSchema.safeParse(normalized);

        if (normalizedValidation.success) {
          return {
            ok: true,
            decision: normalizedValidation.data,
            model,
            latencyMs,
            attempts: 1,
          };
        }
      } catch {
        // Ignore secondary parse error and return original failure below
      }

      return {
        ok: false,
        category: "schema_violation",
        detail: `Local Ollama JSON output failed schema validation: ${parsed.detail}`,
        model,
        latencyMs,
        attempts: 1,
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);

      let category: AiFailureCategory = "provider_error";
      let detail = `Ollama error: ${msg}`;

      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("connect")) {
        category = "provider_error";
        detail = `Local Ollama engine unreachable at ${config.ollamaBaseUrl}. Please ensure Ollama is running ('ollama serve' or 'ollama run ${model}').`;
      } else if (msg.includes("not found") || msg.includes("404")) {
        category = "unsupported_model";
        detail = `Model '${model}' not found in local Ollama. Please run 'ollama pull ${model}'.`;
      } else if (msg.includes("timeout") || msg.includes("aborted")) {
        category = "timeout";
        detail = `Local Ollama request timed out after ${config.aiTimeoutMs}ms.`;
      }

      return {
        ok: false,
        category,
        detail,
        model,
        latencyMs,
        attempts: 1,
      };
    }
  },
};
