import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET() {
  await store.ensureInitializedAsync();
  store.flagAndRetryQueuedDeliveries();
  const health = store.getHealth();
  return NextResponse.json(health);
}

export async function POST(request: NextRequest) {
  try {
    await store.ensureInitializedAsync();
    const body = await request.json();
    if (typeof body.outboundSendingPaused === "boolean") {
      store.setOutboundSendingPaused(body.outboundSendingPaused);
    } else if (typeof body.paused === "boolean") {
      store.setOutboundSendingPaused(body.paused);
    }
    const health = store.getHealth();
    return NextResponse.json(health);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to update health settings", detail: message }, { status: 400 });
  }
}
