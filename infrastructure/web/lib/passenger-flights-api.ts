const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const PROXY_BASE = typeof window === "undefined" ? BASE : "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function proxyPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST ${path} failed ${res.status}`);
  return res.json();
}

async function proxyPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed ${res.status}`);
  return res.json();
}

async function proxyDelete(path: string): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`DELETE ${path} failed ${res.status}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PassengerFlight {
  id: number;
  date: string;
  flight_number: string | null;
  origin: string | null;
  destination: string | null;
  airline: string | null;
  aircraft: string | null;
  price_paid: number | null;
  reason: string | null;
  commuting: boolean;
  companion: string | null;
  seat: string | null;
  duration_hours: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PassengerFlightIn {
  date: string;
  flight_number?: string;
  origin?: string;
  destination?: string;
  airline?: string;
  aircraft?: string;
  price_paid?: number;
  reason?: string;
  commuting?: boolean;
  companion?: string;
  seat?: string;
  duration_hours?: number;
  notes?: string;
}

export interface PassengerFlightStats {
  total: number;
  total_spent: number;
  distinct_airlines: number;
  distinct_airports: number;
  total_hours: number;
  flights_per_year: Record<string, number>;
  top_airlines: { airline: string; flights: number }[];
  top_routes: { route: string; flights: number }[];
  current_year: { year: string; flights: number; spent: number; hours: number };
}

// ── API ───────────────────────────────────────────────────────────────────────

export const passengerFlightsApi = {
  stats: (): Promise<PassengerFlightStats> => get("/passenger-flights/stats"),

  list: (params?: { year?: number; date?: string }): Promise<PassengerFlight[]> => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    else if (params?.year) qs.set("year", String(params.year));
    const q = qs.toString();
    return get(`/passenger-flights${q ? `?${q}` : ""}`);
  },

  create: (body: PassengerFlightIn): Promise<PassengerFlight> =>
    proxyPost("/api/passenger-flights", body),

  update: (id: number, body: Partial<PassengerFlightIn>): Promise<PassengerFlight> =>
    proxyPatch(`/api/passenger-flights/${id}`, body),

  delete: (id: number): Promise<void> => proxyDelete(`/api/passenger-flights/${id}`),
};
