import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

async function forward(method: string, id: string, body?: unknown) {
  const upstream = await fetch(`${API}/planned-trip-budget/${id}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return forward("PATCH", (await params).id, await req.json());
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return forward("DELETE", (await params).id);
}
