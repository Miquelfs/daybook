import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const qs = sport ? `?sport=${encodeURIComponent(sport)}` : "";
  const upstream = await fetch(`${API}/race-plans/benchmarks${qs}`, { cache: "no-store" });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const upstream = await fetch(`${API}/race-plans/benchmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
