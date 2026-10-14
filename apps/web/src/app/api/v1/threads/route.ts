import { type NextRequest, NextResponse } from "next/server";
import { store } from "@/server/store/session-store";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  let threads = store.getThreads();

  if (status) {
    threads = threads.filter((t) => t.status === status);
  }

  if (search) {
    const q = search.toLowerCase();
    threads = threads.filter(
      (t) =>
        t.senderEmail.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.senderName?.toLowerCase().includes(q) ?? false) ||
        (t.organisation?.toLowerCase().includes(q) ?? false),
    );
  }

  return NextResponse.json(threads);
}
