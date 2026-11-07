import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// One proxy for the travel journal (/travel/* on the Pi): JSON calls, photo uploads (the raw
// multipart body, so the boundary survives), and the book (HTML) / export (zip) streamed through.
type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  const qs = req.nextUrl.searchParams.toString();
  const hasBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
  const type = req.headers.get("content-type") ?? "";
  const multipart = type.startsWith("multipart/form-data");
  const body = !hasBody ? undefined
    : multipart ? Buffer.from(await req.arrayBuffer())
    : JSON.stringify(await req.json().catch(() => ({})));
  let upstream: Response;
  try {
    upstream = await fetch(`${API}/travel/${path.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`, {
      method: req.method,
      headers: hasBody ? { "Content-Type": multipart ? type : "application/json" } : undefined,
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "The Pi didn't answer" }, { status: 503 });
  }
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const out = upstream.headers.get("content-type") ?? "";
  if (!out.includes("application/json")) {
    const headers: Record<string, string> = { "content-type": out, "cache-control": "no-store" };
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers["content-disposition"] = disposition;
    const length = upstream.headers.get("content-length");
    if (length) headers["content-length"] = length;
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  }
  return NextResponse.json(await upstream.json(), { status: upstream.status });
}

export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
