import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET() {
  const metrics = store.getMetrics();
  return NextResponse.json(metrics);
}
