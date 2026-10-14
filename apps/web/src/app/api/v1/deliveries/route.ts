import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const threadId = searchParams.get("threadId");
  let deliveries = store.getDeliveries();

  if (status) {
    deliveries = deliveries.filter((d) => d.status === status);
  }

  if (threadId) {
    deliveries = deliveries.filter((d) => d.threadId === threadId);
  }

  return NextResponse.json(deliveries);
}
