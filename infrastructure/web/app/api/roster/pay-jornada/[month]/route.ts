import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ month: string }> }
) {
  const { month } = await params;
  const upstream = await fetch(`${API}/roster/pay-jornada/${month}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await req.text(),
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
