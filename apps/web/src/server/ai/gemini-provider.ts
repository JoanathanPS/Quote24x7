import { GoogleGenAI } from "@google/genai";

import type { AiFailureCategory } from "@/types/domain";
import { getAppConfig } from "../config.ts";
import { aiDecisionSchema, buildResponseJsonSchema, type AiDecisionOutput } from "./decision-schema.ts";

/**
 * Gemini provider adapter.
 *
 * The only place in the application that talks to Google. It is responsible for
 * the request, a hard timeout, bounded retries on transient failures, and
 * turning every possible failure into a classified, operator-safe result. It
 * never throws at its caller: an unusable provider is a normal, expected
 * condition that must route to the rules fallback rather than break the
 * pipeline.
 *
 * The API key is read from `getAppConfig()` (process.env) at call time and is
 * never logged, returned, or attached to an error.
 */

export interface AiProviderSuccess {
  ok: true;
  decision: AiDecisionOutput;
  model: string;
  latencyMs: number;
  attempts: number;
}

export interface AiProviderFailure {
  ok: false;
  category: AiFailureCategory;
  /** Safe for operator display and persistence. Contains no credentials. */
  detail: string;
  model: string | null;
  latencyMs: number | null;
  attempts: number;
}

export type AiProviderResult = AiProviderSuccess | AiProviderFailure;

export interface GenerateDecisionInput {
  systemInstruction: string;
  userPrompt: string;
}

/**
 * Injectable provider surface. Tests supply a fake implementation so the suite
 * never spends API credits; production uses `geminiProvider`.
 */
export interface AiProvider {
  readonly name: string;
  generateDecision(input: GenerateDecisionInput): Promise<AiProviderResult>;
}

/** Transient HTTP statuses worth retrying with backoff. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface ClassifiedError {
  category: AiFailureCategory;
  detail: string;
  retryable: boolean;
  /** Provider-advised wait before retrying, in seconds, when it supplied one. */
  retryAfterSeconds: number | null;
}

/**
 * Pulls the human-readable message out of a provider error.
 *
 * Google returns a large JSON envelope. Storing the whole blob makes the
 * operator view unreadable, so the `error.message` field is preferred and the
 * envelope is used only as a fallback.
 */
function extractProviderMessage(raw: string): string {
  const start = raw.indexOf("{");
  if (start !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(start)) as {
        error?: { message?: unknown; status?: unknown };
      };
      const message = parsed.error?.message;
      if (typeof message === "string" && message.length > 0) {
        // Keep the first sentence or two; the rest is documentation links.
        return message.split("\n")[0]?.trim() ?? message.trim();
      }
    } catch {
      // Not JSON, or truncated. Fall through to the raw text.
    }
  }
  return raw.trim();
}

/** Reads the RetryInfo delay (e.g. "44563s") that Google attaches to a 429. */
function extractRetryAfterSeconds(raw: string): number | null {
  const fromRetryInfo = raw.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (fromRetryInfo?.[1]) return Math.ceil(Number(fromRetryInfo[1]));

  // The prose form: "Please retry in 12h23m57.17s".
  const prose = raw.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (prose && (prose[1] || prose[2] || prose[3])) {
    const hours = Number(prose[1] ?? 0);
    const minutes = Number(prose[2] ?? 0);
    const seconds = Number(prose[3] ?? 0);
    return Math.ceil(hours * 3600 + minutes * 60 + seconds);
  }
  return null;
}

/** Beyond this, retrying within one request is pointless — a daily quota, not a blip. */
const MAX_WORTHWHILE_RETRY_WAIT_SECONDS = 60;

/**
 * Maps a thrown provider error onto a stable category.
 *
 * Only the error's own message is used, and only after stripping anything that
 * could carry the key. Provider error messages are not assumed to be safe.
 */
export function classifyProviderError(error: unknown): ClassifiedError {
  const raw = error instanceof Error ? error.message : String(error);
  const safeRaw = redact(raw, 4_000);
  const message = redact(extractProviderMessage(safeRaw));
  const lower = safeRaw.toLowerCase();
  const retryAfterSeconds = extractRetryAfterSeconds(safeRaw);

  // The SDK's ApiError carries a numeric status; other transports may not.
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;

  if (lower.includes("abort") || lower.includes("timed out") || lower.includes("timeout")) {
    return { category: "timeout", detail: `Gemini request timed out: ${message}`, retryable: true, retryAfterSeconds };
  }

  if (status === 429 || lower.includes("rate limit") || lower.includes("resource_exhausted") || lower.includes("quota")) {
    // A daily-quota 429 advises a wait of hours. Retrying inside this request
    // would only burn time, so it is reported immediately to the fallback.
    const worthRetrying =
      retryAfterSeconds === null || retryAfterSeconds <= MAX_WORTHWHILE_RETRY_WAIT_SECONDS;
    const waitNote =
      retryAfterSeconds !== null ? ` Provider advises retrying in ~${formatWait(retryAfterSeconds)}.` : "";
    return {
      category: "rate_limited",
      detail: `Gemini rate limit or quota reached: ${message}${waitNote}`,
      retryable: worthRetrying,
      retryAfterSeconds,
    };
  }

  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("permission_denied") || lower.includes("unauthenticated")) {
    return {
      category: "provider_error",
      detail: `Gemini rejected the credentials or the request was not permitted: ${message}`,
      retryable: false,
      retryAfterSeconds,
    };
  }

  // A wrong model id is a configuration fault, not a transient one. Surfaced
  // distinctly so the operator is told to fix GEMINI_MODEL rather than retry.
  if (
    status === 404 ||
    lower.includes("not found") ||
    lower.includes("is not supported") ||
    lower.includes("unsupported model") ||
    lower.includes("does not exist")
  ) {
    return {
      category: "unsupported_model",
      detail: `Configured Gemini model was rejected by the API: ${message}`,
      retryable: false,
      retryAfterSeconds,
    };
  }

  if (Number.isFinite(status) && RETRYABLE_STATUSES.has(status)) {
    return {
      category: "provider_error",
      detail: `Gemini transient error (HTTP ${status}): ${message}`,
      retryable: true,
      retryAfterSeconds,
    };
  }

  if (lower.includes("fetch failed") || lower.includes("econnreset") || lower.includes("socket") || lower.includes("network")) {
    return {
      category: "provider_error",
      detail: `Network failure reaching Gemini: ${message}`,
      retryable: true,
      retryAfterSeconds,
    };
  }

  return { category: "provider_error", detail: `Gemini call failed: ${message}`, retryable: false, retryAfterSeconds };
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 360) / 10}h`;
}

/** Defence in depth: strips anything key-shaped from text before it is stored or shown. */
function redact(text: string, limit = 320): string {
  const config = getAppConfig();
  let output = text;
  if (config.geminiApiKey) {
    output = output.split(config.geminiApiKey).join("[REDACTED_KEY]");
  }
  return output
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/(key=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, limit);
}

/** Pulls the first JSON object out of a response that wrapped it in prose or a code fence. */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{")) return inner;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return null;
}

/**
 * Validates a raw provider response string into a decision.
 * Exported so tests can exercise malformed-output handling directly.
 */
export function parseDecisionResponse(
  text: string | undefined,
  providerName = "AI provider",
): { ok: true; decision: AiDecisionOutput } | { ok: false; category: AiFailureCategory; detail: string } {
  if (!text || text.trim().length === 0) {
    return { ok: false, category: "invalid_output", detail: `${providerName} returned an empty response body.` };
  }

  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return {
      ok: false,
      category: "invalid_output",
      detail: `${providerName} response contained no JSON object (received ${text.length} characters of prose).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      category: "invalid_output",
      detail: `${providerName} response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const validated = aiDecisionSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      category: "schema_violation",
      detail: `${providerName} output failed schema validation: ${issues}`,
    };
  }

  return { ok: true, decision: validated.data };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with jitter, so retries do not synchronise under load. */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return base + Math.floor(Math.random() * 250);
}

/** The live Gemini adapter. */
export const geminiProvider: AiProvider = {
  name: "gemini",

  async generateDecision(input: GenerateDecisionInput): Promise<AiProviderResult> {
    const config = getAppConfig();

    if (!config.geminiApiKey) {
      return {
        ok: false,
        category: "not_configured",
        detail: "GEMINI_API_KEY is not set. The rules-based engine is handling this thread.",
        model: null,
        latencyMs: null,
        attempts: 0,
      };
    }

    const model = config.geminiModel;
    const responseJsonSchema = buildResponseJsonSchema();
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

    let lastFailure: ClassifiedError = {
      category: "provider_error",
      detail: "Gemini was not reached.",
      retryable: false,
      retryAfterSeconds: null,
    };

    const startedAt = Date.now();
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= config.aiMaxAttempts; attempt += 1) {
      attemptsMade = attempt;
      try {
        const response = await client.models.generateContent({
          model,
          contents: input.userPrompt,
          config: {
            systemInstruction: input.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema,
            // Deterministic as the API allows: the same email should not
            // produce a different action on a retry.
            temperature: 0,
            maxOutputTokens: 4_096,
            // No hidden chain-of-thought is requested or stored; the auditable
            // explanation is the reasoningSummary field instead.
            thinkingConfig: { includeThoughts: false },
            httpOptions: { timeout: config.aiTimeoutMs },
          },
        });

        const parsed = parseDecisionResponse(response.text, "Gemini");
        if (parsed.ok) {
          return {
            ok: true,
            decision: parsed.decision,
            model,
            latencyMs: Date.now() - startedAt,
            attempts: attempt,
          };        }

        // Malformed output is retried once or twice — a transient decoding
        // glitch is common — but never beyond the attempt budget.
        lastFailure = { category: parsed.category, detail: parsed.detail, retryable: true, retryAfterSeconds: null };
      } catch (error) {
        lastFailure = classifyProviderError(error);
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
      // Report attempts actually made, not the budget.
      attempts: attemptsMade,
    };
  },
};
