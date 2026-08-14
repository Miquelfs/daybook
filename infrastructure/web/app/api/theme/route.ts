import { NextRequest, NextResponse } from "next/server";

// Persist the theme in a *server-set* cookie. iOS Safari's ITP caps cookies
// written from client JS (document.cookie) to ~7 days and periodically evicts
// localStorage, which was silently reverting a chosen light theme back to dark.
// A first-party HTTP cookie set here is not subject to that cap, so the
// preference survives.
export async function POST(req: NextRequest) {
  let theme = "dark";
  try {
    const body = await req.json();
    if (body?.theme === "light" || body?.theme === "dark") theme = body.theme;
  } catch {
    /* default dark */
  }
  const res = NextResponse.json({ ok: true, theme });
  res.cookies.set("db-theme", theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false, // the pre-paint inline script reads it to avoid a flash
  });
  return res;
}
