import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const brief = req.nextUrl.searchParams.get("brief") === "1";
  const path = brief ? `/roster/day/${date}/brief` : `/roster/day/${date}`;

  const upstream = await fetch(`${API}${path}`, { cache: "no-store" });

  if (upstream.status === 404) {
    return NextResponse.json(null, { status: 200 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
