import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

async function forward(method: string, slug: string) {
  const upstream = await fetch(`${API}/habits/${encodeURIComponent(slug)}/track`, { method, cache: "no-store" });
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return forward("POST", (await params).slug);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  return forward("DELETE", (await params).slug);
}
