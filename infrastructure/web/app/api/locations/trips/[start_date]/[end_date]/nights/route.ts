import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ start_date: string; end_date: string }> }) {
  const { start_date, end_date } = await params;
  try {
    const res = await fetch(`${API}/locations/trips/${start_date}/${end_date}/nights`, { cache: "no-store" });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ nights: [] }, { status: 503 });
  }
}
