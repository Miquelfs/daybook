import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// The device reports its IANA timezone; the API stores it (every "today" follows
// you) and the `tz` cookie lets server-rendered pages compute your local date.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const tz = typeof body?.timezone === "string" ? body.timezone : "";
  const upstream = await fetch(`${API}/settings/timezone`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: tz }), cache: "no-store",
  }).catch(() => null);
  const ok = !!upstream && upstream.ok;
  const res = NextResponse.json({ ok, timezone: tz }, { status: ok ? 200 : 422 });
  if (ok) res.cookies.set("tz", tz, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
