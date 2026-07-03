import { NextResponse } from "next/server";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function POST() {
  try {
    const res = await fetch(`${API}/groceries/prices/sync`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ synced: 0, skipped: 0, errors: 0, message: "API unreachable" }, { status: 503 });
  }
}
