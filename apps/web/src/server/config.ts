/**
 * Application environment configuration for Quote24x7 email and service integrations.
 * Secrets are strictly read from process.env and never exposed to the client.
 */

export interface AppConfig {
  /** Resend API Key for outbound email delivery */
  resendApiKey: string | null;
  /** Verified sender email address (e.g. "Quote24x7 <quotes@yourdomain.com>" or "onboarding@resend.dev") */
  outboundFromEmail: string;
  /** Webhook signing secret for verifying incoming Resend webhooks */
  resendWebhookSecret: string | null;
  /** Designated safe test recipient email. If set, emails in test mode only send here */
  testRecipientEmail: string | null;
  /** Whether live outbound dispatch to Resend is enabled */
  isLiveDispatchEnabled: boolean;
  /** Application base URL for webhooks and links */
  appBaseUrl: string;
  /** Whether the configured appBaseUrl is a genuinely public hostname (not localhost / loopback) */
  isPublicAppUrl: boolean;
}

export function getAppConfig(): AppConfig {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || null;
  const outboundFromEmail =
    process.env.OUTBOUND_FROM_EMAIL?.trim() || "Quote24x7 <onboarding@resend.dev>";
  const resendWebhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() || null;
  const testRecipientEmail = process.env.TEST_RECIPIENT_EMAIL?.trim() || null;
  const isLiveDispatchEnabled =
    Boolean(resendApiKey) && process.env.ALLOW_EXTERNAL_DISPATCH === "true";
  const rawAppBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "";
  const isPublicAppUrl =
    Boolean(rawAppBaseUrl) &&
    !rawAppBaseUrl.includes("localhost") &&
    !rawAppBaseUrl.includes("127.0.0.1") &&
    (rawAppBaseUrl.startsWith("http://") || rawAppBaseUrl.startsWith("https://"));
  const appBaseUrl = rawAppBaseUrl || "http://localhost:3000";

  return {
    resendApiKey,
    outboundFromEmail,
    resendWebhookSecret,
    testRecipientEmail,
    isLiveDispatchEnabled,
    appBaseUrl,
    isPublicAppUrl,
  };
}
