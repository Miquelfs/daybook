import { NextRequest, NextResponse } from "next/server";

// Browser → Next → API (server-side): the API's CORS doesn't allow PUT from the
// browser, and all browser mutations go through these proxy routes anyway.
const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/flights/${encodeURIComponent(id)}/runway`, { cache: "no-store" });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/flights/${encodeURIComponent(id)}/runway`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await req.text(),
    cache: "no-store",
  });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}
