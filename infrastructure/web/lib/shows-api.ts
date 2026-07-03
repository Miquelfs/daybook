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
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed ${res.status}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Show {
  id: number;
  title: string;
  date_watched: string | null;
  type: string | null;       // "movie" | "show" | "documentary"
  genre: string | null;
  platform: string | null;
  companions: string | null;
  rating_mf: number | null;
  rating_ad: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShowIn {
  title: string;
  date_watched?: string;
  type?: string;
  genre?: string;
  platform?: string;
  companions?: string;
  rating_mf?: number;
  rating_ad?: number;
  notes?: string;
}

export interface ShowStats {
  total: number;
  by_year: Record<string, number>;
  by_type: Record<string, number>;
  by_genre: Record<string, number>;
  by_platform: Record<string, number>;
  avg_rating_mf: number | null;
  top_rated: { id: number; title: string; type: string | null; rating_mf: number }[];
}

// ── API ───────────────────────────────────────────────────────────────────────

export const showsApi = {
  stats: (year?: number | null): Promise<ShowStats> =>
    get(`/shows/stats${year ? `?year=${year}` : ""}`),

  list: (params?: { year?: number; date?: string; type?: string; genre?: string; platform?: string }): Promise<Show[]> => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    else if (params?.year) qs.set("year", String(params.year));
    if (params?.type) qs.set("type", params.type);
    if (params?.genre) qs.set("genre", params.genre);
    if (params?.platform) qs.set("platform", params.platform);
    const q = qs.toString();
    return get(`/shows${q ? `?${q}` : ""}`);
  },

  get: (id: number): Promise<Show> => get(`/shows/${id}`),

  create: (body: ShowIn): Promise<Show> => proxyPost("/api/shows", body),

  update: (id: number, body: Partial<ShowIn>): Promise<Show> =>
    proxyPatch(`/api/shows/${id}`, body),

  delete: (id: number): Promise<void> => proxyDelete(`/api/shows/${id}`),
};
