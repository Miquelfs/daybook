import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// One proxy for the web's /coll/* calls (courses, settings, firmware uploads). The device
// endpoints (sync, settings, pack, rides) are called by Coll itself, with its token — not here.
// JSON bodies go through as JSON; a binary body (a firmware .bin) as raw bytes.
type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  const qs = req.nextUrl.searchParams.toString();
  const hasBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
  const binary = (req.headers.get("content-type") ?? "").startsWith("application/octet-stream");
  const body = !hasBody ? undefined
    : binary ? Buffer.from(await req.arrayBuffer())
    : JSON.stringify(await req.json().catch(() => ({})));
  const upstream = await fetch(`${API}/coll/${path.map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`, {
    method: req.method,
    headers: hasBody ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : undefined,
    body,
    cache: "no-store",
  });
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}

export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
