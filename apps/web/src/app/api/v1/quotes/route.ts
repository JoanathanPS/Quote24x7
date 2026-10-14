import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET(_request: NextRequest) {
  const quotes = store.getQuotes();
  return NextResponse.json(quotes);
}
