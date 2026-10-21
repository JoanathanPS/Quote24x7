import OpenAI from "openai";
import type { AiFailureCategory } from "@/types/domain";
import { getAppConfig, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "../config.ts";
import {
  parseDecisionResponse,
  type AiProvider,
  type AiProviderResult,
  type GenerateDecisionInput,
} from "./gemini-provider.ts";

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

      if (!parsed.ok) {
        return {
          ok: false,
          category: "schema_violation",
          detail: `Local Ollama JSON output failed schema validation: ${parsed.detail}`,
          model,
          latencyMs,
          attempts: 1,
        };
      }

      return {
        ok: true,
        decision: parsed.decision,
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
