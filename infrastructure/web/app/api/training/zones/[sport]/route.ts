import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sport: string }> },
) {
  const { sport } = await params;
  const body = await req.json();
  const upstream = await fetch(`${API}/training/zones/${sport}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
