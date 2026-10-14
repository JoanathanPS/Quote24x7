import { NextResponse } from "next/server";
import { loadActiveCatalogue } from "@/server/catalogue/loader";

export async function GET() {
  const activeCatalogue = loadActiveCatalogue();
  return NextResponse.json([activeCatalogue]);
}
