// Travel journal — moments of a trip, its story and export (Pi: /travel/*, domains/travel/).
// Client-side only: everything goes through the Next.js /api/travel proxy.

export interface MomentPhoto {
  id: number;
  moment_id: number;
  path: string;
  thumb_path: string | null;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  sort: number;
}

export interface Moment {
  id: number;
  /** Number on the map, in trip order. */
  n?: number;
  date: string;
  taken_at: string | null;
  /** HH:MM where it happened (the trip's clock, not home's). */
  local_time?: string | null;
  title: string | null;
  story: string | null;
  lat: number | null;
  lng: number | null;
  place: string | null;
  city: string | null;
  country: string | null;
  place_source: "exif" | "track" | "manual" | null;
  photos: MomentPhoto[];
}

export interface StoryActivity {
  id: string;
  name: string | null;
  activity_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
}

export interface StoryDay {
  date: string;
  index: number;
  plan: string | null;
  moments: Moment[];
  /** [[lat, lng], …], thinned. */
  route: [number, number][];
  km: number;
  cities: string[];
  countries: string[];
  steps: number | null;
  mood: number | null;
  energy: number | null;
  notes: string | null;
  day_photo: string | null;
  day_photo_caption: string | null;
  activities: StoryActivity[];
  restaurants: { id: number; name: string; cuisine: string | null; city: string | null }[];
  spent_eur: number | null;
}

export interface TripStory {
  start: string;
  end: string;
  name: string | null;
  planned_id: number | null;
  detected: { start_date: string; end_date: string } | null;
  summary: string | null;
  cover_photo_id: number | null;
  cover: { path: string; thumb_path: string | null } | null;
  days: StoryDay[];
  totals: {
    days: number;
    moments: number;
    photos: number;
    km: number;
    cities: string[];
    countries: string[];
    activities: number;
    spent_eur: number;
  };
}

export interface MomentIn {
  date?: string;
  /** HH:MM local to where you were that day; "" clears it. */
  time?: string | null;
  title?: string | null;
  story?: string | null;
  place?: string | null;
}

/** A stored photo path (moments/…, or a day photo's file name) → its URL through the proxy. */
export function photoUrl(path: string): string {
  const clean = path.replace(/^\/?photos\//, "");
  return `/api/photos/${clean.startsWith("moments/") ? clean : clean.split("/").pop()}`;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/travel${path}`, {
    method,
    headers: body === undefined || body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `${method} ${path} failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const range = (start: string, end: string) => `start=${start}&end=${end}`;

export const travelApi = {
  story: (start: string, end: string) => req<TripStory>("GET", `/story?${range(start, end)}`),
  saveStory: (start: string, end: string, body: { summary?: string | null; cover_photo_id?: number | null }) =>
    req<{ status: string }>("PUT", `/story?${range(start, end)}`, body),
  createMoment: (body: MomentIn) => req<Moment>("POST", "/moments", body),
  updateMoment: (id: number, body: MomentIn) => req<Moment>("PATCH", `/moments/${id}`, body),
  deleteMoment: (id: number) => req<void>("DELETE", `/moments/${id}`),
  addPhoto: (momentId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Moment>("POST", `/moments/${momentId}/photos`, fd);
  },
  /** A photo that finds its own moment (EXIF time → where you were). `date` is used when the file has no clock. */
  dropPhoto: (file: File, date: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("date", date);
    return req<Moment>("POST", "/photos", fd);
  },
  updatePhoto: (id: number, body: { caption?: string | null; moment_id?: number }) =>
    req<{ status: string }>("PATCH", `/photos/${id}`, body),
  deletePhoto: (id: number) => req<void>("DELETE", `/photos/${id}`),
  bookUrl: (start: string, end: string, name?: string | null) =>
    `/api/travel/book?${range(start, end)}${name ? `&name=${encodeURIComponent(name)}` : ""}`,
  exportUrl: (start: string, end: string, name?: string | null) =>
    `/api/travel/export?${range(start, end)}${name ? `&name=${encodeURIComponent(name)}` : ""}`,
};

/** Upload photos one at a time (the Pi has little RAM), reporting progress. Returns how many failed. */
export async function uploadEach(files: File[], send: (f: File) => Promise<unknown>,
                                 onProgress: (done: number, total: number) => void): Promise<number> {
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    onProgress(i, files.length);
    try { await send(files[i]); } catch { failed += 1; }
  }
  onProgress(files.length, files.length);
  return failed;
}

export const storyKey = (start: string, end: string) => ["travel-story", start, end] as const;
