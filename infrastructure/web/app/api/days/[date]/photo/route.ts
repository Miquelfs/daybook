import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  // Forward the raw multipart body directly — re-parsing FormData strips the boundary
  // and causes FastAPI to fail with 422/500.
  const contentType = req.headers.get("content-type") ?? "";
  const body = await req.arrayBuffer();
  const upstream = await fetch(`${API}/days/${date}/photo`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
