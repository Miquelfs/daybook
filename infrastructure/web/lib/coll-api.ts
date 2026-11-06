// Coll — the DIY bike computer. Types mirror infrastructure/api/routers/coll.py.
// Reads go to the API directly; writes go through the /api/coll proxy (CORS).

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

import type { ProfileMarker } from "@/lib/api";

export type CollStatus = "pending" | "building" | "ready" | "failed";

export interface CollTurn {
  at: number;          // metres from the start
  angle: number;       // ° (+ right)
  kind: 0 | 1 | 2;     // turn / keep / roundabout
  exit: number;
  road: string;
}

export interface CollFuel {
  fuel_plan: string | null;
  source: "course" | "race nutrition plan" | "planned session" | "race targets" | "default" | null;
  note: string;
}

/** The route as a rider reads it (domains/coll/brief.py). The list carries the light part. */
export interface CollBrief {
  date: string | null;
  km: number; climb_m: number; descent_m: number; high_m: number | null;
  est_minutes: number;
  /** with a forecast: est_minutes includes the wind; this is the still-air time */
  est_minutes_still?: number;
  pace: { kmh: number; rides: number; source: "your rides" | "touring model"; base_kmh?: number;
          learned?: { factor: number; rides: number; last: string; last_date: string } | null };
  carry: { items: { name: string; every_min: number; count: number; carbs_g: number | null }[];
           carbs_g: number; carbs_g_h: number | null } | null;
  profile: [number, number][];
  /** detail only */
  climbs?: { km: number; top_km: number; length_km: number; gain_m: number; avg_pct: number; max_200m_pct: number;
             name: string | null; est_min: number }[];
  markers?: ProfileMarker[];
  along?: { km: number; kind: CollWaypointKind; name: string; off_m: number }[];
  cutoffs?: { km: number | null; at: string; name: string | null }[];
  daylight?: { sunrise: string; sunset: string; latest_start: string | null; needs_lights: boolean; with_wind?: boolean } | null;
  tunnels?: { from_km: number; to_km: number; length_km: number; peak_m: number }[];
  attempts?: { activity_id: string; date: string; moving_time_seconds: number | null; distance_meters: number | null;
               avg_heart_rate: number | null; source: string; status: "activity" | "merged" }[];
  has_elevation?: boolean;
}

export interface CollCourse {
  id: number;
  name: string;
  goal_id: number | null;
  session_id: number | null;
  session_date: string | null;
  auto: boolean;                 // made from a planned session's GPX
  status: CollStatus;
  error: string | null;
  progress: string | null;
  pack_sha1: string | null;
  on_device: boolean;
  cutoffs: string | null;
  fuel_plan: string | null;      // override typed on the Coll tab
  start_time: string | null;     // HH:MM you set off (the forecast's times); null = 08:00
  km: number | null;
  turns: number | null;
  keeps: number | null;
  roundabouts: number | null;
  matched_pct: number | null;
  bytes: number | null;
  waypoints: number | null;
  created_at: string;
  built_at: string | null;
  /** list only */
  synced?: boolean;                 // offered to Coll at its next sync
  fuel_plan_now?: string | null;
  /** list only: is it really on Coll? "yes" = Coll reported this exact pack */
  on_coll?: "yes" | "next sync" | "old version" | "no";
  brief?: CollBrief | null;
  /** list only: rides Coll recorded on this route, newest first */
  rides?: { id: number; activity_id: string | null; status: "activity" | "merged"; date: string | null }[];
}

/** What Coll reported at the end of its last sync. */
export interface CollDevice {
  seen_at: string | null;
  firmware: string | null;
  free_kb: number | null;
  battery_pct: number | null;
  rides_waiting: number | null;
  have: { id: number; pack_sha1: string }[];
  firmware_update?: { newest: CollFirmwareBuild | null; state: CollFirmwareState };
}

export type CollFirmwareState = "up to date" | "update offered" | "newer on Coll" | "none";
export interface CollFirmwareBuild { version: string; sha1: string; bytes: number; notes: string | null; uploaded_at: string }
export interface CollFirmware { builds: CollFirmwareBuild[]; device: string | null; state: CollFirmwareState }

/** One sync: the device's requests around one /coll/sync (domains/coll/device_state.history). */
export interface CollSyncSession {
  started: string; ended: string; errors: number; down_bytes: number; up_bytes: number;
  steps: { at: string; kind: "sync" | "settings" | "pack" | "ride" | "device" | "firmware" | "auth" | string;
           status: number; detail: string | null; bytes: number | null }[];
}

/** The forecast along a dated route (domains/coll/weather.py). */
export interface CollWeather {
  status: "ok" | "stale" | "too_far" | "past" | "no_date" | "unavailable";
  start?: string;
  available_from?: string;
  fetched_at?: string;
  finish_at?: string;
  riding_min?: number; still_min?: number; wind_min?: number;
  temp_min?: number | null; temp_max?: number | null; max_gust_kmh?: number | null;
  summits?: { name: string | null; km: number; eta: string; temp: number | null; ele: number | null }[];
  rain?: { from_km: number; at: string; pct: number | null; wet_km: number } | null;
  headwind?: { from_km: number; to_km: number; kmh: number }[];
  tailwind?: { from_km: number; to_km: number; kmh: number }[];
  points?: { km: number; eta: string; temp: number | null; rain_pct: number | null; rain_mm: number | null;
             wind_kmh: number | null; gust_kmh: number | null; wind_from: number | null; head_kmh: number }[];
  line?: string;
}

/** A ride of the route, against its plan (domains/coll/review.rides). */
export interface CollRouteRide {
  activity_id: string; date: string; source: string | null; name: string | null;
  covered_km: number | null; route_km: number | null;
  predicted_min: number | null; moving_min: number | null; elapsed_min: number | null; delta_min: number | null;
  fuel_g_h: number | null;
}

export interface CollReviewFuel {
  source: "coll" | "log";
  plan?: string;
  items?: { name: string; every_min: number; taken: number; expected: number; on_time: number; late: number;
            avg_late_min: number | null; early: number; overdue_at_end_min: number; carbs_g: number | null }[];
  timeline?: { item: string; due_min: number | null; taken_min: number | null; late_min: number | null }[];
  carbs_g: number; planned_carbs_g?: number; carbs_g_h: number | null; planned_g_h?: number | null; presses?: number;
}

/** A ride of a route against its plan (domains/coll/review.py). */
export interface CollReview {
  activity_id: string; course_id: number; course_name: string; date: string; name: string | null; source: string;
  error?: string;
  route_km: number; covered_km: number; from_km: number; to_km: number;
  pace: { kmh: number; base_kmh: number | null; learned: { factor: number; rides: number } | null };
  predicted_min: number; moving_min: number; elapsed_min: number; stopped_min: number; delta_min: number;
  flat_kmh: number | null; avg_hr: number | null;
  sections: { from_km: number; to_km: number; name: string | null; kind: string | null; predicted_min: number;
              ridden: boolean; moving_min?: number; elapsed_min?: number; delta_min?: number;
              avg_hr?: number | null; kmh?: number | null }[];
  climbs: { name: string | null; km: number; top_km: number; gain_m: number; length_km: number; avg_pct: number;
            est_min: number; moving_min: number | null; elapsed_min?: number; vam?: number | null; avg_hr?: number | null;
            best?: { moving_min: number; date: string; activity_id: string }; is_best?: boolean }[];
  fuel: CollReviewFuel | null;
  rides_of_route?: number;
}

export interface CollCourseDetail extends Omit<CollCourse, "turns" | "brief"> {
  summary: {
    km?: number; matched_pct?: number; turns?: number; keeps?: number; roundabouts?: number; bytes?: number;
    tunnels?: { from_km: number; to_km: number; length_km: number; peak_m: number }[];
    waypoint_kinds?: { poi: number; feed: number; summit: number; hazard: number };
    waypoint_names?: string[];
    has_elevation?: boolean;
  };
  turns: CollTurn[];
  polyline: string | null;
  fuel: CollFuel;
  /** read from the pack: where each prompt (same order as turns) and waypoint is; null until built */
  map: CollPackMap | null;
  brief: CollBrief | null;
  weather: CollWeather | null;
  reviews: CollRouteRide[];
}

export type CollWaypointKind = "poi" | "feed" | "summit" | "hazard";

export interface CollPackMap {
  km: number;
  turns: { at: number; lat: number; lon: number }[];
  waypoints: { kind: CollWaypointKind; lat: number; lon: number; name: string }[];
}

/** /coll/courses/map — every built course's line */
export interface CollMapLine {
  id: number;
  name: string;
  goal_id: number | null;
  polyline: string;
  session_date: string | null;
  synced: boolean;
}

export interface CollRideSummary {
  start_utc: string; points: number; segments: number;
  duration_s: number; moving_s: number; distance_m: number; ascent_m: number | null;
  avg_hr: number | null; max_hr: number | null; avg_power: number | null; max_power: number | null;
  avg_cadence: number | null; work_kj: number | null; max_speed_mps: number | null; calories: number | null;
  course: { id: number; name: string; how: "name" | "map"; frac?: number } | null;
}

/** A ride Coll uploaded. status "merged": the watch recorded it too, and its activity is the one that counts. */
export interface CollRide {
  id: number;
  ride_id: string;
  activity_id: string | null;
  status: "activity" | "merged";
  course_id: number | null;
  name: string | null;
  start_utc: string;
  format: "gpx" | "clg";
  summary: CollRideSummary | null;
  received_at: string;
  activity_date?: string | null;
  activity_name?: string | null;
}

export interface CollProduct { id: number; name: string; kind: string; carbs_g: number; caffeine_mg: number; fluid_ml: number }

export interface CollSettings {
  format: number;
  profile: { weight_kg: number | null; age: number | null; sex: string | null };
  hr_zones: number[] | null;
  max_hr: number | null;
  timezone: string | null;
  fuel_plan: string | null;
  cutoffs: string | null;
  cutoffs_course_id: number | null;
  units: string;
  token_configured: boolean;
  fuel_product: CollProduct | null;
  products: CollProduct[];
  /** the ride screens: null = Coll's own (= screens_default) */
  screens: string | null;
  screens_default: string;
  screens_pages: CollScreen[];
  screens_fields: { id: string; label: string; note: string | null }[];
  screens_limits: Record<CollScreenKind, number>;
}

export type CollScreenKind = "list" | "grid" | "map" | "climb" | "fuel";
export interface CollScreen { kind: CollScreenKind; fields: string[] }

export function screensLine(pages: CollScreen[]): string {
  return pages.map((p) => p.kind + (p.fields.length ? `:${p.fields.join(",")}` : "")).join(";");
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${r.status}`);
  return data as T;
}

export const COLL_KEYS = {
  courses: ["coll", "courses"] as const,
  course: (id: number) => ["coll", "course", id] as const,
  settings: ["coll", "settings"] as const,
  map: ["coll", "map"] as const,
  rides: ["coll", "rides"] as const,
  device: ["coll", "device"] as const,
  review: (aid: string) => ["coll", "review", aid] as const,
  syncLog: ["coll", "sync-log"] as const,
  firmware: ["coll", "firmware"] as const,
};

export const collApi = {
  courses: () => req<CollCourse[]>("GET", `${API}/coll/courses`),
  course: (id: number) => req<CollCourseDetail>("GET", `${API}/coll/courses/${id}`),
  settings: () => req<CollSettings>("GET", `${API}/coll/settings/preview`),
  upload: (gpx: string, name?: string, goal_id?: number | null) =>
    req<CollCourse & { duplicate: boolean }>("POST", "/api/coll/courses", { gpx, name, goal_id }),
  patch: (id: number, body: Partial<Pick<CollCourse, "name" | "on_device" | "goal_id" | "cutoffs" | "fuel_plan" | "start_time">>) =>
    req<CollCourseDetail>("PATCH", `/api/coll/courses/${id}`, body),
  rebuild: (id: number) => req<CollCourseDetail>("POST", `/api/coll/courses/${id}/rebuild`),
  remove: (id: number) => req<void>("DELETE", `/api/coll/courses/${id}`),
  refreshWeather: (id: number) => req<CollCourseDetail>("POST", `/api/coll/courses/${id}/weather`),
  putSettings: (body: { fuel_plan?: string | null; fuel_product_id?: number | null; screens?: string | null }) =>
    req<CollSettings>("PUT", "/api/coll/settings", body),
  device: () => req<CollDevice | null>("GET", `${API}/coll/device`),
  mapLines: () => req<CollMapLine[]>("GET", `${API}/coll/courses/map`),
  rides: () => req<CollRide[]>("GET", `${API}/coll/rides`),
  reimportRide: (id: number) => req<CollRide>("POST", `/api/coll/rides/${id}/reimport`),
  removeRide: (id: number) => req<void>("DELETE", `/api/coll/rides/${id}`),
  /** null when the activity isn't a ride of a Coll route */
  review: async (aid: string): Promise<CollReview | null> => {
    const r = await fetch(`${API}/coll/reviews/${encodeURIComponent(aid)}`);
    if (r.status === 404) return null;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${r.status}`);
    return data as CollReview;
  },
  syncLog: () => req<CollSyncSession[]>("GET", `${API}/coll/sync-log`),
  firmware: () => req<CollFirmware>("GET", `${API}/coll/firmware`),
  uploadFirmware: async (version: string, file: File, notes?: string): Promise<CollFirmware> => {
    const q = new URLSearchParams({ version, ...(notes ? { notes } : {}) });
    const r = await fetch(`/api/coll/firmware?${q}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await file.arrayBuffer(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `HTTP ${r.status}`);
    return data as CollFirmware;
  },
  removeFirmware: (version: string) => req<void>("DELETE", `/api/coll/firmware/${encodeURIComponent(version)}`),
};

/** What Coll will announce: "km 63.8 · LEFT onto Ma-10". */
export function turnText(t: CollTurn): string {
  const side = t.angle > 0 ? "RIGHT" : "LEFT";
  const what = t.kind === 2 ? `ROUNDABOUT exit ${t.exit}` : t.kind === 1 ? `KEEP ${side}` : side;
  return `${what}${t.road ? ` · ${t.road}` : ""}`;
}
