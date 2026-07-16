import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(_req: NextRequest) {
  const upstream = await fetch(`${API}/nutrition/sweat-rate`, { cache: "no-store" });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
