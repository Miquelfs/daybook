import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

type Ctx = { params: Promise<{ path?: string[] }> };

// One request to the Pi, errors said plainly: the Pi not answering (503), or answering with an error
// page instead of JSON (its status + "Pi answered N", and the API's own log has the traceback).
export async function forward(req: NextRequest, path: string): Promise<NextResponse> {
  const hasBody = req.method === "POST" || req.method === "PATCH" || req.method === "PUT";
  const type = req.headers.get("content-type") ?? "";
  const multipart = type.startsWith("multipart/form-data");
  const body = !hasBody ? undefined
    : multipart ? Buffer.from(await req.arrayBuffer())
    : JSON.stringify(await req.json().catch(() => ({})));
  let upstream: Response;
  try {
    upstream = await fetch(`${API}${path}`, {
      method: req.method,
      headers: hasBody ? { "Content-Type": multipart ? type : "application/json" } : undefined,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    console.error(`[proxy] ${req.method} ${path}: ${timedOut ? "timed out" : "no answer"}`, e);
    return NextResponse.json({ detail: timedOut ? "The Pi took too long to answer" : "The Pi didn't answer" }, { status: 503 });
  }
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const text = await upstream.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: `Pi answered ${upstream.status}: ${text.slice(0, 200)}` }; }
  if (upstream.status >= 500) console.error(`[proxy] ${req.method} ${path} → ${upstream.status}`, text.slice(0, 500));
  return NextResponse.json(data, { status: upstream.status });
}

// One proxy for a whole backend prefix (/money/statements, /vehicles): JSON bodies and multipart
// uploads (the raw body, so the boundary survives) go straight through to the Pi.
export function passthrough(prefix: string) {
  async function handler(req: NextRequest, { params }: Ctx) {
    const { path = [] } = await params;
    const qs = req.nextUrl.searchParams.toString();
    const sub = path.map(encodeURIComponent).join("/");
    return forward(req, `${prefix}${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`);
  }
  return { GET: handler, POST: handler, PATCH: handler, PUT: handler, DELETE: handler };
}
