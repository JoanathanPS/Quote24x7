import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { getAppConfig } from "@/server/config";

export async function GET() {
  await store.ensureInitializedAsync();
  const config = getAppConfig();
  const integrations = store.getIntegrations().map((item) => {
    if (item.id === "int_outbound_resend") {
      return {
        ...item,
        state: config.isLiveDispatchEnabled
          ? ("configured" as const)
          : config.resendApiKey
          ? ("demo_mode" as const)
          : ("not_configured" as const),
        detail: config.isLiveDispatchEnabled
          ? `Live dispatch enabled to Resend from ${config.outboundFromEmail}`
          : config.resendApiKey
          ? "RESEND_API_KEY present, running in safe dry-run (ALLOW_EXTERNAL_DISPATCH is not true)"
          : "RESEND_API_KEY not configured. Running in safe dry-run mode.",
      };
    }
    if (item.id === "int_inbound_resend") {
      return {
        ...item,
        state: config.resendWebhookSecret ? ("configured" as const) : ("demo_mode" as const),
        detail: config.resendWebhookSecret
          ? "Resend webhook endpoint active and signing secret configured"
          : "Inbound endpoint active at /api/v1/inbound (ready for webhooks and test payloads)",
      };
    }
    return item;
  });
  return NextResponse.json(integrations);
}
