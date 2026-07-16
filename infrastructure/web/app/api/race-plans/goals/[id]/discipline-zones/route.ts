import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const upstream = await fetch(`${API}/race-plans/goals/${id}/discipline-zones`, {
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
