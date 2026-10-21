import type { AiFailureCategory } from "@/types/domain";
import { getAppConfig } from "../config.ts";

export const DEFAULT_CEREBRAS_MODEL = "llama-3.3-70b";
import { buildResponseJsonSchema } from "./decision-schema.ts";
import { parseDecisionResponse, type AiProvider, type AiProviderResult, type GenerateDecisionInput } from "./gemini-provider.ts";

/**
 * Cerebras AI Provider Adapter.
 *
 * Ultra-fast wafer-scale LPU inference via Cerebras's OpenAI-compatible completions endpoint.
 * Serves as high-speed fallback provider between Groq and Gemini.
 *
 * Implements the standard AiProvider interface.
 */

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface ClassifiedCerebrasError {
  category: AiFailureCategory;
  detail: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
}

function redactCerebras(text: string, limit = 320): string {
  const apiKey = process.env.CEREBRAS_API_KEY?.trim();
  let output = text;
  if (apiKey) {
    output = output.split(apiKey).join("[REDACTED_KEY]");
  }
  return output.replace(/csk-[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]").slice(0, limit);
}

function classifyCerebrasError(status: number, message: string, retryAfterHeader: string | null): ClassifiedCerebrasError {
  const safeMessage = redactCerebras(message);
  let retryAfterSeconds: number | null = null;
  if (retryAfterHeader) {
    const parsed = Number(retryAfterHeader);
    if (Number.isFinite(parsed) && parsed > 0) {
      retryAfterSeconds = Math.ceil(parsed);
    }
  }

  if (status === 429) {
    return {
      category: "rate_limited",
      detail: `Cerebras rate limit reached: ${safeMessage}${retryAfterSeconds ? ` (retry after ${retryAfterSeconds}s)` : ""}`,
      retryable: retryAfterSeconds === null || retryAfterSeconds <= 60,
      retryAfterSeconds,
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: "provider_error",
      detail: `Cerebras authentication error: ${safeMessage}`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (status === 404) {
    return {
      category: "unsupported_model",
      detail: `Configured Cerebras model was not found: ${safeMessage}`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (RETRYABLE_STATUSES.has(status)) {
    return {
      category: "provider_error",
      detail: `Cerebras transient server error (HTTP ${status}): ${safeMessage}`,
      retryable: true,
      retryAfterSeconds,
    };
  }

  return {
    category: "provider_error",
    detail: `Cerebras API call failed (HTTP ${status}): ${safeMessage}`,
    retryable: false,
    retryAfterSeconds: null,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelayMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return base + Math.floor(Math.random() * 250);
}

export function normalizeCerebrasModel(raw: string): string {
  const cleaned = raw.trim();
  return cleaned || DEFAULT_CEREBRAS_MODEL;
}

export const cerebrasProvider: AiProvider = {
  name: "cerebras",

  async generateDecision(input: GenerateDecisionInput): Promise<AiProviderResult> {
    const config = getAppConfig();
    const apiKey = process.env.CEREBRAS_API_KEY?.trim() || null;

    if (!apiKey) {
      return {
        ok: false,
        category: "not_configured",
        detail: "CEREBRAS_API_KEY is not set.",
        model: null,
        latencyMs: null,
        attempts: 0,
      };
    }

    const model = normalizeCerebrasModel(process.env.CEREBRAS_MODEL || DEFAULT_CEREBRAS_MODEL);
    const startedAt = Date.now();
    let attemptsMade = 0;

    let lastFailure: ClassifiedCerebrasError = {
      category: "provider_error",
      detail: "Cerebras was not reached.",
      retryable: false,
      retryAfterSeconds: null,
    };

    for (let attempt = 1; attempt <= config.aiMaxAttempts; attempt += 1) {
      attemptsMade = attempt;
      try {
        const isReasoningModel = model.includes("gpt-oss") || model.includes("120b") || model.includes("deepseek") || model.includes("r1");
        const requestPayload: Record<string, unknown> = {
          model,
          messages: [
            {
              role: "system",
              content: input.systemInstruction,
            },
            {
              role: "user",
              content: input.userPrompt,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "ai_decision",
              schema: buildResponseJsonSchema(),
            },
          },
          temperature: 0,
          max_tokens: 8192,
        };
        if (isReasoningModel) {
          requestPayload.reasoning_effort = "low";
        }
        const requestBodyText = JSON.stringify(requestPayload);

        const response: Response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: requestBodyText,
          signal: AbortSignal.timeout(config.aiTimeoutMs),
        });

        if (!response.ok) {
          const errText = await response.text();
          let parsedMsg = errText;
          try {
            const jsonErr = JSON.parse(errText) as { error?: { message?: string } };
            if (jsonErr.error?.message) parsedMsg = jsonErr.error.message;
          } catch {
            // keep raw text
          }

          let retryWaitMs: number | null = null;
          if (response.status === 429) {
            const retryAfterHeader = response.headers.get("retry-after");
            if (retryAfterHeader) {
              const parsedSeconds = parseFloat(retryAfterHeader);
              if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
                retryWaitMs = Math.min(Math.round(parsedSeconds * 1000), 20_000);
              }
            }
          }

          lastFailure = classifyCerebrasError(response.status, parsedMsg, response.headers.get("retry-after"));
          if (!lastFailure.retryable || attempt === config.aiMaxAttempts) break;

          const waitMs = retryWaitMs ?? backoffDelayMs(attempt);
          await sleep(waitMs);
          continue;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        const choice = data.choices?.[0];
        const rawContent = choice?.message?.content;

        const parsed = parseDecisionResponse(rawContent, "Cerebras");
        if (parsed.ok) {
          return {
            ok: true,
            decision: parsed.decision,
            model,
            latencyMs: Date.now() - startedAt,
            attempts: attempt,
          };
        }

        lastFailure = {
          category: parsed.category,
          detail: parsed.detail,
          retryable: true,
          retryAfterSeconds: null,
        };
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        const lower = rawMsg.toLowerCase();
        if (lower.includes("abort") || lower.includes("timed out") || lower.includes("timeout")) {
          lastFailure = {
            category: "timeout",
            detail: `Cerebras request timed out: ${redactCerebras(rawMsg)}`,
            retryable: true,
            retryAfterSeconds: null,
          };
        } else {
          lastFailure = {
            category: "provider_error",
            detail: `Cerebras network error: ${redactCerebras(rawMsg)}`,
            retryable: true,
            retryAfterSeconds: null,
          };
        }

        if (attempt < config.aiMaxAttempts) {
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        break;
      }
    }

    return {
      ok: false,
      category: lastFailure.category,
      detail: lastFailure.detail,
      model,
      latencyMs: Date.now() - startedAt,
      attempts: attemptsMade,
    };
  },
};
