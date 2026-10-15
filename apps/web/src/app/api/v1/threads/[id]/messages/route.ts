import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await store.ensureInitializedAsync();
  const thread = store.getThread(id);
  if (!thread) {
    return NextResponse.json(
      { error: `Thread not found: ${id}` },
      { status: 404 },
    );
  }

  const threadMessages = store.getMessages(id);
  return NextResponse.json(threadMessages);
}
