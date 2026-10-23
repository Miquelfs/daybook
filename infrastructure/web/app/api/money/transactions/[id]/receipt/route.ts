import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Forward the raw multipart body directly — re-parsing FormData strips the boundary
  // and causes FastAPI to fail with 422/500.
  const contentType = req.headers.get("content-type") ?? "";
  const body = await req.arrayBuffer();
  const upstream = await fetch(`${API}/money/transactions/${encodeURIComponent(id)}/receipt`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/money/transactions/${encodeURIComponent(id)}/receipt`, {
    method: "DELETE",
    cache: "no-store",
  });
  return new NextResponse(null, { status: upstream.ok ? 204 : upstream.status });
}
