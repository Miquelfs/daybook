const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const PROXY = typeof window === "undefined" ? BASE : "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function proxyMutate<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${method} ${path} failed ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type InjuryStatus = "active" | "recovering" | "resolved";
export type InjurySide = "left" | "right" | null;
export type InjuryMechanism = "overuse" | "acute" | "unknown" | null;

export interface Injury {
  id: number;
  zone: string;
  side: InjurySide;
  pain_scale: number;
  status: InjuryStatus;
  onset_date: string;
  resolved_date: string | null;
  notes: string | null;
  mechanism: InjuryMechanism;
  activity_type: string | null;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InjuryCreate {
  zone: string;
  side?: InjurySide;
  pain_scale: number;
  status?: InjuryStatus;
  onset_date: string;
  resolved_date?: string;
  notes?: string;
  mechanism?: InjuryMechanism;
  activity_type?: string;
  activity_id?: string;
}

export interface InjuryPatch {
  pain_scale?: number;
  status?: InjuryStatus;
  resolved_date?: string;
  notes?: string;
  mechanism?: InjuryMechanism;
  activity_type?: string;
  activity_id?: string;
}

export interface ActiveSummaryItem {
  id: number;
  zone: string;
  side: InjurySide;
  pain_scale: number;
  status: InjuryStatus;
  onset_date: string;
}

export const ZONE_LABELS: Record<string, string> = {
  quad: "Quad",
  hip_flexor: "Hip flexor",
  groin: "Groin",
  knee: "Knee",
  shin: "Shin",
  ankle: "Ankle",
  foot: "Foot",
  shoulder: "Shoulder",
  chest: "Chest",
  elbow: "Elbow",
  wrist: "Wrist",
  hamstring: "Hamstring",
  glute: "Glute",
  hip: "Hip",
  calf: "Calf",
  achilles: "Achilles",
  lower_back: "Lower back",
  upper_back: "Upper back",
  it_band: "IT band",
  neck: "Neck",
};

// ── API ────────────────────────────────────────────────────────────────────────

export const injuriesApi = {
  list: (params?: {
    status?: string;
    zone?: string;
    since?: string;
    activity_id?: string;
  }): Promise<Injury[]> => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.zone) qs.set("zone", params.zone);
    if (params?.since) qs.set("since", params.since);
    if (params?.activity_id) qs.set("activity_id", params.activity_id);
    const q = qs.toString();
    return apiFetch(`/injuries${q ? `?${q}` : ""}`);
  },

  activeSummary: (): Promise<ActiveSummaryItem[]> =>
    apiFetch("/injuries/active-summary"),

  create: (body: InjuryCreate): Promise<Injury> =>
    proxyMutate("/api/injuries", "POST", body),

  update: (id: number, body: InjuryPatch): Promise<Injury> =>
    proxyMutate(`/api/injuries/${id}`, "PATCH", body),

  delete: (id: number): Promise<void> =>
    proxyMutate(`/api/injuries/${id}`, "DELETE"),
};
