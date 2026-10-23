import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Same-origin ticket PDF, so the phone opens it in its own viewer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API}/money/receipts/${encodeURIComponent(id)}/pdf`, { cache: "no-store" });
  if (!upstream.ok) return NextResponse.json({ error: "Ticket not found" }, { status: upstream.status });
  return new NextResponse(upstream.body, {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="ticket-${id}.pdf"` },
  });
}
