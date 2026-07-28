import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ iso2: string }> }) {
  const { iso2 } = await params;
  try {
    const res = await fetch(`${API}/locations/manual-countries/${iso2}`, {
      method: "DELETE",
      cache: "no-store",
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
