// Coll — the DIY bike computer. Types mirror infrastructure/api/routers/coll.py.
// Reads go to the API directly; writes go through the /api/coll proxy (CORS).

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

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
}

export interface CollCourseDetail extends Omit<CollCourse, "turns"> {
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
};

export const collApi = {
  courses: () => req<CollCourse[]>("GET", `${API}/coll/courses`),
  course: (id: number) => req<CollCourseDetail>("GET", `${API}/coll/courses/${id}`),
  settings: () => req<CollSettings>("GET", `${API}/coll/settings/preview`),
  upload: (gpx: string, name?: string, goal_id?: number | null) =>
    req<CollCourse & { duplicate: boolean }>("POST", "/api/coll/courses", { gpx, name, goal_id }),
  patch: (id: number, body: Partial<Pick<CollCourse, "name" | "on_device" | "goal_id" | "cutoffs" | "fuel_plan">>) =>
    req<CollCourseDetail>("PATCH", `/api/coll/courses/${id}`, body),
  rebuild: (id: number) => req<CollCourseDetail>("POST", `/api/coll/courses/${id}/rebuild`),
  remove: (id: number) => req<void>("DELETE", `/api/coll/courses/${id}`),
  putSettings: (body: { fuel_plan?: string | null; fuel_product_id?: number | null }) =>
    req<CollSettings>("PUT", "/api/coll/settings", body),
  device: () => req<CollDevice | null>("GET", `${API}/coll/device`),
  mapLines: () => req<CollMapLine[]>("GET", `${API}/coll/courses/map`),
  rides: () => req<CollRide[]>("GET", `${API}/coll/rides`),
  reimportRide: (id: number) => req<CollRide>("POST", `/api/coll/rides/${id}/reimport`),
  removeRide: (id: number) => req<void>("DELETE", `/api/coll/rides/${id}`),
};

/** What Coll will announce: "km 63.8 · LEFT onto Ma-10". */
export function turnText(t: CollTurn): string {
  const side = t.angle > 0 ? "RIGHT" : "LEFT";
  const what = t.kind === 2 ? `ROUNDABOUT exit ${t.exit}` : t.kind === 1 ? `KEEP ${side}` : side;
  return `${what}${t.road ? ` · ${t.road}` : ""}`;
}
