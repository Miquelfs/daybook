import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Same-origin ticket screenshot, so the phone opens it full-screen.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const upstream = await fetch(`${API}/money/receipts/${encodeURIComponent(id)}/image/${encodeURIComponent(n)}`, { cache: "no-store" });
  if (!upstream.ok) return NextResponse.json({ error: "Screenshot not found" }, { status: upstream.status });
  return new NextResponse(upstream.body, {
    headers: { "content-type": upstream.headers.get("content-type") ?? "image/png" },
  });
}
