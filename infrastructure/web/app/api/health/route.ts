import { NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${API}/`, { cache: "no-store" });
    if (res.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false }, { status: 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
