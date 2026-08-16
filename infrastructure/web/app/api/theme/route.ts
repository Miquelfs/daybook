import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Persist the theme in the server DB (single global setting). Browser storage —
// even a server-set cookie — is not reliable on iOS Safari (ITP evicts it, and
// each origin/hostname has its own jar), which is why the theme kept snapping
// back to dark. The DB is the durable source of truth; the layout reads it
// server-side and renders the theme on every request. The cookie set below is
// only a fast local mirror so the very next paint matches without a round-trip.
export async function POST(req: NextRequest) {
  let theme = "dark";
  try {
    const body = await req.json();
    if (body?.theme === "light" || body?.theme === "dark") theme = body.theme;
  } catch {
    /* default dark */
  }
  await fetch(`${API}/settings/theme`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
    cache: "no-store",
  }).catch(() => { /* offline — cookie mirror below still carries it */ });

  const res = NextResponse.json({ ok: true, theme });
  res.cookies.set("db-theme", theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
  return res;
}
