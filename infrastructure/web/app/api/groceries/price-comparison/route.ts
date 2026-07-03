import { NextRequest, NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const months = req.nextUrl.searchParams.get("months") ?? "12";
  const res = await fetch(`${API}/groceries/price-comparison?months=${months}`, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
