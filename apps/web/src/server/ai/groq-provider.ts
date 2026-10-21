import type { AiFailureCategory } from "@/types/domain";
import { getAppConfig, DEFAULT_GROQ_MODEL } from "../config.ts";
import { buildResponseJsonSchema } from "./decision-schema.ts";
import { parseDecisionResponse, type AiProvider, type AiProviderResult, type GenerateDecisionInput } from "./gemini-provider.ts";

/**
 * Groq AI Provider Adapter.
 *
 * Ultra-fast LPU inference via Groq's OpenAI-compatible chat completions endpoint.
 * Highly reliable with generous rate limits (e.g. 14,400 requests/day on free tier
 * compared to 20 requests/day on Gemini).
 *
 * Implements the standard AiProvider interface.
 */

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface ClassifiedGroqError {
  category: AiFailureCategory;
  detail: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
}

function redactGroq(text: string, limit = 320): string {
  const config = getAppConfig();
  let output = text;
  if (config.groqApiKey) {
    output = output.split(config.groqApiKey).join("[REDACTED_KEY]");
  }
  return output.replace(/gsk_[0-9A-Za-z_-]{20,}/g, "[REDACTED_KEY]").slice(0, limit);
}

function classifyGroqError(status: number, message: string, retryAfterHeader: string | null): ClassifiedGroqError {
  const safeMessage = redactGroq(message);
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
      detail: `Groq rate limit reached: ${safeMessage}${retryAfterSeconds ? ` (retry after ${retryAfterSeconds}s)` : ""}`,
      retryable: retryAfterSeconds === null || retryAfterSeconds <= 60,
      retryAfterSeconds,
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: "provider_error",
      detail: `Groq authentication error: ${safeMessage}`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (status === 404) {
    return {
      category: "unsupported_model",
      detail: `Configured Groq model was not found: ${safeMessage}`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (RETRYABLE_STATUSES.has(status)) {
    return {
      category: "provider_error",
      detail: `Groq transient server error (HTTP ${status}): ${safeMessage}`,
      retryable: true,
      retryAfterSeconds,
    };
  }

  return {
    category: "provider_error",
    detail: `Groq API call failed (HTTP ${status}): ${safeMessage}`,
    retryable: false,
    retryAfterSeconds: null,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelayMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return base + Math.floor(Math.random() * 250);
}

export function normalizeGroqModel(raw: string): string {
  const cleaned = raw.trim();
  return cleaned || DEFAULT_GROQ_MODEL;
}

export const groqProvider: AiProvider = {
  name: "groq",

  async generateDecision(input: GenerateDecisionInput): Promise<AiProviderResult> {
    const config = getAppConfig();

    if (!config.groqApiKey) {
      return {
        ok: false,
        category: "not_configured",
        detail: "GROQ_API_KEY is not set.",
        model: null,
        latencyMs: null,
        attempts: 0,
      };
    }

    const model = normalizeGroqModel(config.groqModel);
    const startedAt = Date.now();
    let attemptsMade = 0;

    let lastFailure: ClassifiedGroqError = {
      category: "provider_error",
      detail: "Groq was not reached.",
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

        const response: Response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.groqApiKey}`,
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
            const rateLimitHeaders: Record<string, string> = {};
            response.headers.forEach((val, key) => {
              const lowerKey = key.toLowerCase();
              if (lowerKey.startsWith("x-ratelimit-") || lowerKey === "retry-after") {
                rateLimitHeaders[lowerKey] = val;
              }
            });
            console.warn(
              `[Groq 429] Request body size: ${requestBodyText.length} bytes | Rate limits: ${JSON.stringify(rateLimitHeaders)}`,
            );

            const retryAfterHeader = response.headers.get("retry-after");
            if (retryAfterHeader) {
              const parsedSeconds = parseFloat(retryAfterHeader);
              if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
                retryWaitMs = Math.min(Math.round(parsedSeconds * 1000), 20_000);
              }
            } else {
              const resetHeader =
                response.headers.get("x-ratelimit-reset-tokens") ||
                response.headers.get("x-ratelimit-reset-requests");
              if (resetHeader) {
                const match = resetHeader.match(/([\d.]+)\s*s?/);
                if (match) {
                  const parsedSeconds = parseFloat(match[1]!);
                  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
                    retryWaitMs = Math.min(Math.round(parsedSeconds * 1000), 20_000);
                  }
                }
              }
            }
          }

          lastFailure = classifyGroqError(response.status, parsedMsg, response.headers.get("retry-after"));
          if (!lastFailure.retryable || attempt === config.aiMaxAttempts) break;

          const waitMs = retryWaitMs ?? backoffDelayMs(attempt);
          if (response.status === 429 && retryWaitMs) {
            console.warn(
              `[Groq] Rate limited (429). Waiting ${waitMs}ms (capped at 20s) before retry attempt ${attempt + 1}/${config.aiMaxAttempts}...`,
            );
          }
          await sleep(waitMs);
          continue;
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        const choice = data.choices?.[0];
        if (choice?.finish_reason === "length") {
          console.warn("[Groq] Response was truncated due to max_tokens limit (finish_reason: length).");
        }
        const rawContent = choice?.message?.content;

        const parsed = parseDecisionResponse(rawContent, "Groq");
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
            detail: `Groq request timed out: ${redactGroq(rawMsg)}`,
            retryable: true,
            retryAfterSeconds: null,
          };
        } else {
          lastFailure = {
            category: "provider_error",
            detail: `Groq network call failed: ${redactGroq(rawMsg)}`,
            retryable: true,
            retryAfterSeconds: null,
          };
        }
      }

      if (!lastFailure.retryable || attempt === config.aiMaxAttempts) break;
      await sleep(backoffDelayMs(attempt));
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
