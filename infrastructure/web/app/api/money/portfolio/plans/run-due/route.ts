import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry_run") === "true";
  const upstream = await fetch(`${API}/money/portfolio/plans/run-due${dry ? "?dry_run=true" : ""}`, {
    method: "POST",
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
