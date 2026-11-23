import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

type Ctx = { params: Promise<{ path?: string[] }> };

// One proxy for a whole backend prefix (/money/statements, /vehicles): JSON bodies and multipart
// uploads (the raw body, so the boundary survives) go straight through to the Pi.
export function passthrough(prefix: string) {
  async function handler(req: NextRequest, { params }: Ctx) {
    const { path = [] } = await params;
    const qs = req.nextUrl.searchParams.toString();
    const hasBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
    const type = req.headers.get("content-type") ?? "";
    const multipart = type.startsWith("multipart/form-data");
    const body = !hasBody ? undefined
      : multipart ? Buffer.from(await req.arrayBuffer())
      : JSON.stringify(await req.json().catch(() => ({})));
    const sub = path.map(encodeURIComponent).join("/");
    let upstream: Response;
    try {
      upstream = await fetch(`${API}${prefix}${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`, {
        method: req.method,
        headers: hasBody ? { "Content-Type": multipart ? type : "application/json" } : undefined,
        body,
        cache: "no-store",
      });
    } catch {
      return NextResponse.json({ detail: "The Pi didn't answer" }, { status: 503 });
    }
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    const data = await upstream.json().catch(() => ({ detail: `Pi answered ${upstream.status}` }));
    return NextResponse.json(data, { status: upstream.status });
  }
  return { GET: handler, POST: handler, PATCH: handler, PUT: handler, DELETE: handler };
}
