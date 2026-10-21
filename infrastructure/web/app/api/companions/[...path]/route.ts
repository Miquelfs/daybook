import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// /api/companions/activity/{id} · /api/companions/trip/{start}/{end} — who it was with.
function target(path: string[]) {
  return `${API}/companions/${path.map(encodeURIComponent).join("/")}`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const upstream = await fetch(target((await params).path), { cache: "no-store" });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const body = await req.json();
  const upstream = await fetch(target((await params).path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
