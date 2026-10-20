import { type NextRequest, NextResponse } from "next/server";
import { searchKnowledgeBase } from "@/server/knowledge/retriever";
import type { KnowledgeCategory } from "@/types/domain";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, category, limit } = body as {
      query: string;
      category?: KnowledgeCategory;
      limit?: number;
    };

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'query' parameter." }, { status: 400 });
    }

    const results = await searchKnowledgeBase(query, { category, limit });
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
