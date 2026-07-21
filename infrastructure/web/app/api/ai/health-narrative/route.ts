import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const topic = searchParams.get("topic") ?? "";
  const days = searchParams.get("days") ?? "14";
  try {
    const res = await fetch(`${API}/ai/health-narrative?topic=${encodeURIComponent(topic)}&days=${days}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ text: null, cached: false }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await fetch(`${API}/ai/health-narrative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ text: null, available: false }, { status: 503 });
  }
}
