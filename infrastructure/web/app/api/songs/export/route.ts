import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Streams the year's playlist file (m3u/csv) back to the browser as a download.
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.search;
  const upstream = await fetch(`${API}/songs/export${qs}`, { cache: "no-store" });

  if (!upstream.ok) {
    return NextResponse.json({ error: "Export failed" }, { status: 502 });
  }

  const body = await upstream.text();
  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const disposition =
    upstream.headers.get("content-disposition") ?? "attachment; filename=songs.m3u";

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": contentType, "Content-Disposition": disposition },
  });
}
