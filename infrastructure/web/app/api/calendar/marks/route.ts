import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const upstream = await fetch(`${API}/calendar/marks${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
