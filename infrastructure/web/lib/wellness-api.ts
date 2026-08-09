// Read-only client for the all-day wellness timeline + recovery flag (CIRQA).

const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export interface TimelinePoint { t: string; v: number }
export interface TimelineEvent { t: string; label: string; type: string; detail?: string }
export interface TimelineSpan { start: string; end: string; label: string; type: string }

export interface WellnessTimeline {
  date: string;
  offset_min: number;
  stress: TimelinePoint[];
  body_battery: TimelinePoint[];
  hr: TimelinePoint[];
  spans: TimelineSpan[];
  events: TimelineEvent[];
  has_data: boolean;
}

export interface RecoveryFlag {
  date: string;
  status: "ok" | "watch" | "flag";
  reasons: string[];
  rhr_delta: number | null;
  hrv_status: string | null;
  body_battery_low: number | null;
  skin_temp_dev: number | null;
}

export const wellnessApi = {
  timeline: (date: string): Promise<WellnessTimeline> => get(`/wellness/timeline?date=${date}`),
  recovery: (date: string): Promise<RecoveryFlag> => get(`/wellness/recovery?date=${date}`),
};
