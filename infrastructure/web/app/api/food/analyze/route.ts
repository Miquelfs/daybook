import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function POST(req: NextRequest) {
  // Forward the raw multipart body directly — re-parsing FormData strips the
  // boundary and causes FastAPI to fail.
  const contentType = req.headers.get("content-type") ?? "";
  const body = await req.arrayBuffer();
  const upstream = await fetch(`${API}/food/analyze`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
