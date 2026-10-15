import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET() {
  await store.ensureInitializedAsync();
  const metrics = store.getMetrics();
  return NextResponse.json(metrics);
}
