/**
 * Application environment configuration for Quote24x7 email and service integrations.
 * Secrets are strictly read from process.env and never exposed to the client.
 */

export interface AppConfig {
  /** Resend API Key for outbound email delivery */
  resendApiKey: string | null;
  /** Verified sender email address (e.g. "Quote24x7 <quotes@quotes.joanathan.in>") */
  outboundFromEmail: string;
  /**
   * The single mailbox this pipeline answers. Resend's inbound webhook fires for
   * every address on the receiving domain, so mail to hello@, info@ or anything
   * else arrives here too; anything not addressed to this mailbox is dropped
   * before it can open a thread or spend an AI call.
   */
  inboundAddress: string;
  /** Webhook signing secret for verifying incoming Resend webhooks */
  resendWebhookSecret: string | null;
  /** Whether live outbound dispatch to Resend is enabled */
  isLiveDispatchEnabled: boolean;
  /** Application base URL for webhooks and links */
  appBaseUrl: string;
  /** Whether the configured appBaseUrl is a genuinely public hostname (not localhost / loopback) */
  isPublicAppUrl: boolean;
  /** Google Gemini API key for the AI sales engineer. Server-side only. */
  geminiApiKey: string | null;
  /** Configured Gemini model identifier (e.g. "gemini-3.8-flash") */
  geminiModel: string;
  /** Whether the AI sales engineer can be attempted. False forces the rules-based fallback. */
  isAiEnabled: boolean;
  /** Hard timeout for a single Gemini request, in milliseconds */
  aiTimeoutMs: number;
  /** Maximum attempts (initial + retries) for transient Gemini failures */
  aiMaxAttempts: number;
  /** Supabase Project URL */
  supabaseUrl: string | null;
  /** Supabase API Key (service_role or anon key) */
  supabaseKey: string | null;
  /** Whether Supabase is configured and ready for live persistence */
  isSupabaseConfigured: boolean;
}

/** Default model used only when GEMINI_MODEL is absent. Never a silent substitution for a configured value. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Whether this process is an automated test run.
 *
 * Used to keep the live AI provider unreachable from the test suite. The
 * developer's shell may well export GEMINI_API_KEY, so absence of the key is
 * not a safe guard: tests must be structurally prevented from spending API
 * credits. Tests that need the AI path inject a mock provider instead.
 *
 * `ALLOW_AI_IN_TESTS=true` is the deliberate, explicit escape hatch for a
 * manual live-integration check.
 */
export function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.npm_lifecycle_event === "test" ||
    process.env.npm_lifecycle_event === "check" ||
    process.execArgv.some((arg) => arg.includes("--test")) ||
    process.argv.some((arg) => arg.includes(".test.") || arg.includes("--test"))
  );
}

/**
 * Normalizes email strings into RFC 5322 compliant "Name <email@domain>" or "email@domain"
 * format without invalid outer quotes or escaped characters that cause Resend validation errors.
 */
export function formatFromEmail(raw: string): string {
  let cleaned = (raw || "").trim();
  // Strip all leading and trailing quotes, double quotes, and backslashes
  cleaned = cleaned.replace(/^["'\\]+|["'\\]+$/g, "").trim();

  // Extract display name and email if angle brackets exist
  const angleMatch = cleaned.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angleMatch && angleMatch[1] !== undefined && angleMatch[2] !== undefined) {
    const name = angleMatch[1].replace(/^["'\\]+|["'\\]+$/g, "").trim();
    const email = angleMatch[2].replace(/^["'\\]+|["'\\]+$/g, "").trim();
    return name ? `${name} <${email}>` : email;
  }

  return cleaned;
}

export function getAppConfig(): AppConfig {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || null;
  const rawOutboundFrom = process.env.OUTBOUND_FROM_EMAIL || "";
  const cleanedFrom = formatFromEmail(rawOutboundFrom);
  const outboundFromEmail =
    cleanedFrom && cleanedFrom.includes("@")
      ? cleanedFrom
      : "Quote24x7 <quotes@quotes.joanathan.in>";
  const rawInboundAddress = formatFromEmail(process.env.INBOUND_TO_EMAIL || "");
  const inboundAddress =
    rawInboundAddress.includes("@") ? rawInboundAddress : "quotes@quotes.joanathan.in";
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() || null;
  const isLiveDispatchEnabled =
    Boolean(resendApiKey) && process.env.ALLOW_EXTERNAL_DISPATCH === "true";

  // Vercel automatically exposes VERCEL_URL (e.g. quote24x7.vercel.app).
  // Check NEXT_PUBLIC_APP_URL -> APP_BASE_URL -> VERCEL_URL -> localhost:3000.
  const vercelUrl = (process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL)?.trim();
  const rawAppBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    (vercelUrl ? (vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`) : "") ||
    "";
  const isPublicAppUrl =
    Boolean(rawAppBaseUrl) &&
    !rawAppBaseUrl.includes("localhost") &&
    !rawAppBaseUrl.includes("127.0.0.1") &&
    (rawAppBaseUrl.startsWith("http://") || rawAppBaseUrl.startsWith("https://"));
  const appBaseUrl = rawAppBaseUrl || "http://localhost:3000";

  // AI provider. The key stays server-side: it is read from process.env only and
  // is never placed in a NEXT_PUBLIC_* variable, an API response, or a log line.
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || null;
  const geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  // An explicit opt-out so the rules fallback can be exercised without removing the key.
  const aiDisabledByFlag = process.env.DISABLE_AI === "true";
  // Automated tests never reach the live provider unless explicitly allowed.
  const aiBlockedByTestRuntime = isTestRuntime() && process.env.ALLOW_AI_IN_TESTS !== "true";
  const isAiEnabled = Boolean(geminiApiKey) && !aiDisabledByFlag && !aiBlockedByTestRuntime;
  const aiTimeoutMs = Number.parseInt(process.env.AI_TIMEOUT_MS ?? "", 10) || 30_000;
  const aiMaxAttempts = Number.parseInt(process.env.AI_MAX_ATTEMPTS ?? "", 10) || 3;

  // Supabase PostgreSQL Database Integration
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    null;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    null;
  const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

  return {
    resendApiKey,
    outboundFromEmail,
    inboundAddress,
    resendWebhookSecret,
    isLiveDispatchEnabled,
    appBaseUrl,
    isPublicAppUrl,
    geminiApiKey,
    geminiModel,
    isAiEnabled,
    aiTimeoutMs,
    aiMaxAttempts,
    supabaseUrl,
    supabaseKey,
    isSupabaseConfigured,
  };
}
