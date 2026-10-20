import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET() {
  const upstream = await fetch(`${API}/roster/pay-settings`, { cache: "no-store" });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function PUT(req: NextRequest) {
  const upstream = await fetch(`${API}/roster/pay-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await req.text(),
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
