import { NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET() {
  const upstream = await fetch(`${API}/money/transactions/export`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "Export failed" }, { status: 502 });
  }

  const csv = await upstream.text();

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=transactions.csv",
    },
  });
}
