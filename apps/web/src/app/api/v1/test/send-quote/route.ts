import { type NextRequest, NextResponse } from "next/server";
import { getAppConfig } from "@/server/config";
import { processInboundEmail } from "@/server/email/inbound-processor";

/**
 * Diagnostics and End-to-End Test Dispatch Route.
 *
 * GET:
 * Returns the current environment configuration status (keys configured, safe recipient, live mode).
 *
 * POST:
 * Triggers an end-to-end quotation pipeline execution.
 * Simulates receiving an inquiry email, parses the infrastructure counts,
 * calculates the Site24x7 pricing, generates the PDF attachment,
 * and calls the Resend API (or safe dry-run if live dispatch is disabled).
 */
export async function GET() {
  const config = getAppConfig();

  return NextResponse.json({
    status: "ok",
    configuration: {
      resendApiKeyConfigured: Boolean(config.resendApiKey),
      resendApiKeyPrefix: config.resendApiKey ? `${config.resendApiKey.substring(0, 7)}...` : null,
      isLiveDispatchEnabled: config.isLiveDispatchEnabled,
      outboundFromEmail: config.outboundFromEmail,
      resendWebhookSecretConfigured: Boolean(config.resendWebhookSecret),
      appBaseUrl: config.appBaseUrl,
      isPublicAppUrl: config.isPublicAppUrl,
    },
    dispatchMode: config.isLiveDispatchEnabled ? "LIVE_RESEND" : "SAFE_DRY_RUN",
    instructions: {
      postToTrigger: "Send a POST request to this endpoint with an optional JSON body to test the workflow.",
      sampleBody: {
        from: "client@example.com",
        fromName: "Engineering Lead",
        subject: "Site24x7 Quote Request for Production Infrastructure",
        text: "Hi Quote24x7 team, we need monitoring for 80 Linux servers, 15 Cisco switches, 4 synthetic transaction monitors, 2M monthly pageviews for RUM, and 50GB logs per month. Annual billing please.",
      },
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = getAppConfig();
    let body: Record<string, unknown> = {};

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body is optional; fallback to default test payload
    }

    const recipient =
      (typeof body.from === "string" && body.from.trim()) ||
      "test-recipient@example.com";

    const fromName =
      (typeof body.fromName === "string" && body.fromName.trim()) ||
      "Lead SRE Engineer";

    const subject =
      (typeof body.subject === "string" && body.subject.trim()) ||
      "Site24x7 Infrastructure Monitoring Sizing & Quote";

    const text =
      (typeof body.text === "string" && body.text.trim()) ||
      `Hello Site24x7 team,

We are planning our monitoring migration and need an official quotation for our infrastructure:
- 80 production Linux and Windows servers
- 15 core and distribution network switches
- 4 advanced synthetic transaction monitors
- Real User Monitoring for 2,000,000 pageviews/month
- AppLogs log management for 50 GB/month

We prefer an annual billing commitment. Could you please send us the recommended plan and pricing breakdown?

Thanks,
${fromName}`;

    const providerMessageId = `test_inbound_${Date.now()}`;

    const result = await processInboundEmail({
      providerMessageId,
      from: recipient,
      fromName,
      to: [config.outboundFromEmail],
      subject,
      text,
      receivedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      executionSummary: {
        actionTaken: result.actionTaken,
        threadId: result.threadId,
        quoteId: result.quote?.id,
        quoteTotalFormatted: result.quote
          ? `${result.quote.currency} ${((result.quote.options[0]?.total ?? 0) / 100).toLocaleString()}`
          : null,
        pdfGenerated: result.pdfGenerated ?? false,
        outboundStatus: result.outboundResult?.status,
        dispatchMode: result.outboundResult?.mode,
        dispatchedTo: result.outboundResult?.dispatchedTo,
        resendMessageId: result.outboundResult?.providerMessageId,
        error: result.outboundResult?.error ?? null,
      },
      quote: result.quote,
      outboundResult: result.outboundResult,
      message: result.message,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Test dispatch failed", detail: errorMsg },
      { status: 500 }
    );
  }
}
