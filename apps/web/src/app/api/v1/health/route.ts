import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET() {
  const health = store.getHealth();
  return NextResponse.json(health);
}
