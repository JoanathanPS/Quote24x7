import { NextResponse } from "next/server";
import { pingOllama } from "@/server/ai/ollama-provider";

export async function POST(req: Request) {
  try {
    let customBaseUrl: string | undefined;
    try {
      const body = (await req.json()) as { baseUrl?: string };
      customBaseUrl = body.baseUrl;
    } catch {
      // empty body is fine
    }

    const result = await pingOllama(customBaseUrl);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to ping Ollama: ${msg}`,
      },
      { status: 500 },
    );
  }
}
