import type { RouteFrequency, AirportVisit, AirportInfo } from "@/lib/api";

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
  dep_icao: string | null;
  arr_icao: string | null;
  airline: string | null;
  airline_code: string | null;
  aircraft: string | null;
  aircraft_code: string | null;
  registration: string | null;
  price_paid: number | null;
  reason: string | null;
  commuting: boolean;
  companion: string | null;
  seat: string | null;
  seat_type: string | null;
  flight_class: string | null;
  dep_time: string | null;
  arr_time: string | null;
  duration_hours: number | null;
  distance_km: number | null;
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
  airline_code?: string;
  aircraft?: string;
  aircraft_code?: string;
  registration?: string;
  price_paid?: number;
  reason?: string;
  commuting?: boolean;
  companion?: string;
  seat?: string;
  seat_type?: string;
  flight_class?: string;
  dep_time?: string;
  arr_time?: string;
  duration_hours?: number;
  notes?: string;
}

export interface FlightAnalytics {
  totals: {
    flights: number;
    distance_km: number;
    distance_mi: number;
    hours: number;
    spent: number;
    co2_tons: number;
    distinct_airports: number;
    distinct_airlines: number;
    distinct_aircraft: number;
    distinct_countries: number;
    distinct_routes: number;
    domestic: number;
    international: number;
    years_flying: number;
  };
  top_airports: { code: string; city: string | null; country: string | null; count: number }[];
  top_airlines: { code: string | null; airline: string; count: number }[];
  top_aircraft: { code: string; count: number }[];
  top_routes: { route: string; count: number }[];
  top_countries: { country: string; count: number }[];
  flights_per_year: Record<string, number>;
  class_breakdown: Record<string, number>;
  seat_breakdown: Record<string, number>;
  reason_breakdown: Record<string, number>;
  routes_geo: RouteFrequency[];
  airports_geo: AirportVisit[];
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

  analytics: (): Promise<FlightAnalytics> => get("/passenger-flights/analytics"),

  // Airport autocomplete reuses the pilot logbook's 7k-airport search.
  searchAirports: (q: string): Promise<AirportInfo[]> =>
    get(`/flights/airports/search?q=${encodeURIComponent(q)}`),

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
