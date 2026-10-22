import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ start: string; end: string }> }) {
  const { start, end } = await params;
  const upstream = await fetch(`${API}/planned-trips/for-trip/${start}/${end}`, { cache: "no-store" });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
