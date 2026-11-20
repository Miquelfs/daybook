import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest, { params }: { params: Promise<{ start_date: string; end_date: string }> }) {
  const { start_date, end_date } = await params;
  const body = await req.text();
  try {
    const res = await fetch(`${API}/locations/trips/${start_date}/${end_date}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ detail: "API unreachable" }, { status: 503 });
  }
}
