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

export interface Book {
  id: number;
  title: string;
  author: string;
  date_finished: string | null;
  genre: string | null;
  language: string | null;
  location: string | null;
  ownership: string | null;
  pages: number | null;
  rating: number | null;
  notes: string | null;
  gift_from: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookIn {
  title: string;
  author: string;
  date_finished?: string;
  genre?: string;
  language?: string;
  location?: string;
  ownership?: string;
  pages?: number;
  rating?: number;
  notes?: string;
  gift_from?: string;
}

export interface BooksStats {
  books_per_year: Record<string, number>;
  pages_per_year: Record<string, number>;
  books_per_month: Record<string, number>;
  genre_breakdown: Record<string, number>;
  language_breakdown: Record<string, number>;
  top_authors: { author: string; books: number; avg_rating: number | null }[];
  current_year: {
    year: string;
    books: number;
    pages: number;
    vs_last_year_books_pct: number | null;
    vs_last_year_pages_pct: number | null;
    note: string;
  };
  reading_pace: {
    avg_days_between_books: number | null;
    monthly_streak: number;
    total_books: number;
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

export const booksApi = {
  stats: (year?: number | null): Promise<BooksStats> =>
    get(`/books/stats${year ? `?year=${year}` : ""}`),

  list: (params?: { year?: number; genre?: string; author?: string }): Promise<Book[]> => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set("year", String(params.year));
    if (params?.genre) qs.set("genre", params.genre);
    if (params?.author) qs.set("author", params.author);
    const q = qs.toString();
    return get(`/books${q ? `?${q}` : ""}`);
  },

  get: (id: number): Promise<Book> => get(`/books/${id}`),

  create: (body: BookIn): Promise<Book> => proxyPost("/api/books", body),

  update: (id: number, body: Partial<BookIn & { cover_url?: string }>): Promise<Book> =>
    proxyPatch(`/api/books/${id}`, body),

  delete: (id: number): Promise<void> => proxyDelete(`/api/books/${id}`),
};
