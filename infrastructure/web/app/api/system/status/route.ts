import { NextResponse } from "next/server";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export async function GET() {
  try {
    const upstream = await fetch(`${API}/system/status`, { cache: "no-store" });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { overall: "fail", checks: [{ key: "api", label: "API", level: "fail", detail: "API unreachable", group: "system" }], jobs: [] },
      { status: 200 },
    );
  }
}
