import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET() {
  const upstream = await fetch(`${API}/planned-trips`, { cache: "no-store" });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function POST(req: NextRequest) {
  const upstream = await fetch(`${API}/planned-trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await req.json()),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
