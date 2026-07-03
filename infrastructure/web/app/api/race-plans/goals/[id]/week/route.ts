import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const qs = req.nextUrl.searchParams.toString();
  const upstream = await fetch(
    `${API}/race-plans/goals/${id}/week${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
