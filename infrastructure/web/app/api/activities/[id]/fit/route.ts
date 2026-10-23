import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

/** Upload a trainer .fit file to merge into the activity. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Forward the raw multipart body — re-parsing FormData strips the boundary.
  const contentType = req.headers.get("content-type") ?? "";
  const body = await req.arrayBuffer();
  const upstream = await fetch(`${API}/activities/${encodeURIComponent(id)}/fit`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

/** Re-run metrics (after the FTP changed). */
export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/activities/${encodeURIComponent(id)}/fit/recompute`, {
    method: "POST",
    cache: "no-store",
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

/** Remove the .fit file and restore the watch's own recording. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/activities/${encodeURIComponent(id)}/fit`, {
    method: "DELETE",
    cache: "no-store",
  });
  return new NextResponse(null, { status: upstream.ok ? 204 : upstream.status });
}
