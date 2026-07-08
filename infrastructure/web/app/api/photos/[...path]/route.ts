import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const conditionalHeaders: Record<string, string> = {};
  const ifNoneMatch = req.headers.get("if-none-match");
  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifNoneMatch) conditionalHeaders["if-none-match"] = ifNoneMatch;
  if (ifModifiedSince) conditionalHeaders["if-modified-since"] = ifModifiedSince;

  const upstream = await fetch(`${API}/photos/${path.join("/")}`, {
    cache: "no-store",
    headers: conditionalHeaders,
  });

  const etag = upstream.headers.get("etag");
  const lastModified = upstream.headers.get("last-modified");
  const passthroughHeaders: Record<string, string> = {
    "cache-control": "no-cache, must-revalidate",
    ...(etag ? { etag } : {}),
    ...(lastModified ? { "last-modified": lastModified } : {}),
  };

  if (upstream.status === 304) {
    return new NextResponse(null, { status: 304, headers: passthroughHeaders });
  }
  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const blob = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  return new NextResponse(blob, {
    headers: { ...passthroughHeaders, "content-type": contentType },
  });
}
