import { NextRequest, NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET(req: NextRequest) {
  // Forward any start/end/category/account filters so the export matches
  // whatever slice the user is looking at.
  const qs = req.nextUrl.search;
  const upstream = await fetch(`${API}/money/transactions/export${qs}`, {
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "Export failed" }, { status: 502 });
  }

  const csv = await upstream.text();
  const filename =
    upstream.headers.get("content-disposition")?.match(/filename=([^;]+)/)?.[1] ??
    "transactions.csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}
