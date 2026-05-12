// On the server: API_INTERNAL_URL (localhost) takes precedence.
// On the client: NEXT_PUBLIC_API_URL is baked in at build time.
const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export type SleepData = {
  duration_seconds: number | null;
  deep_seconds: number | null;
  light_seconds: number | null;
  rem_seconds: number | null;
  awake_seconds: number | null;
  avg_hrv: number | null;
  avg_spo2: number | null;
  score: number | null;
};

export type DailyStats = {
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  body_battery_low: number | null;
  body_battery_high: number | null;
};

export type HRVData = {
  last_night_avg: number | null;
  weekly_avg: number | null;
  status: string | null;
};

export type Activity = {
  activity_id: string;
  type: string | null;
  name: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
};

export type LocationVisit = {
  start_time: string;
  end_time: string;
  semantic_type: string | null;
  place_name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export type DaySubjective = {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep_quality: number | null;
  notes: string | null;
  daily_question: string | null;
  daily_answer: string | null;
  tags: string | null;
  duty_day: boolean;
  away_from_base: boolean;
  timezone_offset: number | null;
  alcohol: number | null;
  social: boolean | null;
  outdoors: boolean | null;
};

export type DayDetail = {
  date: string;
  subjective: DaySubjective;
  sleep: SleepData | null;
  daily_stats: DailyStats | null;
  hrv: HRVData | null;
  activities: Activity[];
  location: { cities: string[]; total_distance_meters: number } | null;
  visits: LocationVisit[];
};

export type DaySummary = {
  date: string;
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep_duration_seconds: number | null;
  steps: number | null;
  resting_hr: number | null;
  hrv_last_night: number | null;
  activity_count: number;
  cities: string[];
  duty_day: boolean;
  away_from_base: boolean;
};

export type CoreQuestion = {
  id: string;
  text: string;
  type: "scale" | "boolean" | "text";
  field: string;
  tag?: string;
  hint?: string;
};

export type Questionnaire = {
  date: string;
  core: CoreQuestion[];
  rotating: { id: string; text: string; type: string; field: string };
};

export type DayPatch = Partial<{
  energy: number;
  mood: number;
  stress: number;
  sleep_quality: number;
  notes: string;
  daily_question: string;
  daily_answer: string;
  tags: string;
  duty_day: boolean;
  away_from_base: boolean;
  alcohol: number;
  social: boolean;
  outdoors: boolean;
}>;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export type GeoFeature = {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Point"; coordinates: [number, number] };
  properties: {
    segment_start: string;
    segment_end: string;
    place_name: string | null;
    semantic_type: string | null;
    city: string | null;
    country: string | null;
  };
};

export type TracksGeoJSON = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type HeatmapData = {
  points: [number, number, number][];   // [lat, lng, weight]
  countries: { country: string; days: number }[];
  cities: { city: string; country: string; days: number }[];
  years: string[];
};

export const api = {
  day: (date: string) => get<DayDetail>(`/days/${date}`),
  today: () => get<DayDetail>("/days/today"),
  range: (start: string, end: string) =>
    get<DaySummary[]>(`/days?start=${start}&end=${end}`),
  questionnaire: (date: string) =>
    get<Questionnaire>(`/questionnaire/${date}`),
  tracks: (date: string) => get<TracksGeoJSON>(`/locations/tracks/${date}`),
  heatmap: (year?: number) =>
    get<HeatmapData>(`/locations/heatmap${year ? `?year=${year}` : ""}`),

  syncGarmin: async (): Promise<void> => {
    await fetch(`${BASE}/sync/garmin`, { method: "POST", cache: "no-store" }).catch(() => {});
  },

  patch: async (date: string, body: DayPatch): Promise<DayDetail> => {
    const res = await fetch(`${BASE}/days/${date}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
    return res.json();
  },
};

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function fmtDistance(meters: number | null): string {
  if (!meters) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export function moodEmoji(mood: number | null): string {
  if (!mood) return "·";
  if (mood >= 9) return "😄";
  if (mood >= 7) return "🙂";
  if (mood >= 5) return "😐";
  if (mood >= 3) return "😕";
  return "😞";
}

export function activityIcon(type: string | null): string {
  const t = type?.toLowerCase() ?? "";
  if (t.includes("run")) return "🏃";
  if (t.includes("cycl") || t.includes("bike")) return "🚴";
  if (t.includes("swim")) return "🏊";
  if (t.includes("walk")) return "🚶";
  if (t.includes("strength") || t.includes("gym")) return "🏋";
  return "⚡";
}
