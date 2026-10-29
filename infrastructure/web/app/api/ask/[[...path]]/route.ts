import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// One proxy for /ask (POST a question) and /ask/threads/*. An answer can take a
// minute while Claude queries the data, so the route may run long.
export const maxDuration = 300;

type Ctx = { params: Promise<{ path?: string[] }> };

async function proxy(req: NextRequest, { params }: Ctx) {
  const { path = [] } = await params;
  const qs = req.nextUrl.searchParams.toString();
  const hasBody = req.method === "POST";
  const sub = path.map(encodeURIComponent).join("/");
  const upstream = await fetch(`${API}/ask${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`, {
    method: req.method,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(await req.json().catch(() => ({}))) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(300_000),
  });
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const data = await upstream.json().catch(() => ({ detail: `Upstream ${upstream.status}` }));
  return NextResponse.json(data, { status: upstream.status });
}

export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, ctx); }
