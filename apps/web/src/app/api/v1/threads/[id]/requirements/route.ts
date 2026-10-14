import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const thread = store.getThread(id);
  if (!thread) {
    return NextResponse.json(
      { error: `Thread not found: ${id}` },
      { status: 404 },
    );
  }

  const profile = store.getProfile(id);
  if (!profile) {
    return NextResponse.json(
      { error: `No requirement profile found for thread: ${id}` },
      { status: 404 },
    );
  }

  return NextResponse.json(profile);
}
