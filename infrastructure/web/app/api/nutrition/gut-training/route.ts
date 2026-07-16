import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const goalId = searchParams.get("goal_id");
  const upstream = await fetch(`${API}/nutrition/gut-training?goal_id=${goalId}`, {
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
