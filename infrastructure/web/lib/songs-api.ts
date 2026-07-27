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

export interface Song {
  id: number;
  date: string;
  title: string;
  artist: string | null;
  album: string | null;
  url: string | null;
  rating: number | null;
  mood: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongIn {
  date: string;
  title: string;
  artist?: string;
  album?: string;
  url?: string;
  rating?: number;
  mood?: string;
  notes?: string;
}

export interface SongsStats {
  songs_per_year: Record<string, number>;
  songs_per_month: Record<string, number>;
  top_artists: { artist: string; songs: number }[];
  current_year: {
    year: string;
    songs: number;
    distinct_artists: number;
    days_covered: number;
    with_links: number;
  };
  total_songs: number;
  total_with_links: number;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const songsApi = {
  stats: (year?: number | null): Promise<SongsStats> =>
    get(`/songs/stats${year ? `?year=${year}` : ""}`),

  list: (params?: { year?: number; date?: string; artist?: string }): Promise<Song[]> => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    else if (params?.year) qs.set("year", String(params.year));
    if (params?.artist) qs.set("artist", params.artist);
    const q = qs.toString();
    return get(`/songs${q ? `?${q}` : ""}`);
  },

  get: (id: number): Promise<Song> => get(`/songs/${id}`),

  create: (body: SongIn): Promise<Song> => proxyPost("/api/songs", body),

  update: (id: number, body: Partial<SongIn>): Promise<Song> =>
    proxyPatch(`/api/songs/${id}`, body),

  delete: (id: number): Promise<void> => proxyDelete(`/api/songs/${id}`),

  // Playlist export goes through the proxy so the browser downloads a file.
  exportUrl: (year?: number, format: "m3u" | "csv" = "m3u"): string => {
    const qs = new URLSearchParams({ format });
    if (year) qs.set("year", String(year));
    return `/api/songs/export?${qs.toString()}`;
  },
};
