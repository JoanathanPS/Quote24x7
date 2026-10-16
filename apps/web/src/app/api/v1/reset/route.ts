import { NextResponse } from "next/server";
import { store } from "@/server/store/session-store";
import { dryRunStore } from "@/server/store/dryrun-store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await store.clearAll();
    dryRunStore.clearAll();

    return NextResponse.json({
      success: true,
      message: "All email records, threads, quotations, and delivery tracking logs have been purged.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/v1/reset] Error clearing email data:", err);
    return NextResponse.json(
      { error: "Failed to reset email data", detail: message },
      { status: 500 }
    );
  }
}
