// Food / dietary-intake client. Mirrors the songs-api.ts split: reads go direct
// to the backend (server via API_INTERNAL_URL, browser via NEXT_PUBLIC_API_URL),
// mutations go through same-origin /api/food/* proxy routes to dodge CORS.

const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const PROXY_BASE = typeof window === "undefined" ? BASE : "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function proxyPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

async function proxyPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PUT ${path} failed ${res.status}`);
  return res.json();
}

async function proxyDelete(path: string): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`DELETE ${path} failed ${res.status}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FoodEntry {
  id: number;
  date: string;
  description: string;
  meal_type: string | null;
  source: string;
  photo_path: string | null;
  photo_url: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ai_confidence: number | null;
  logged_at: string;
  created_at: string;
  updated_at: string;
}

export interface FoodEntryIn {
  date: string;
  description: string;
  meal_type?: string;
  source?: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ai_confidence?: number | null;
  ai_raw_json?: string;
}

export interface AnalyzeItem {
  name: string;
  grams?: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface AnalyzeResult {
  items: AnalyzeItem[];
  total_kcal: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  confidence: number;
}

export interface FoodSummary {
  date: string;
  entries_count: number;
  consumed_kcal: number;
  consumed_protein_g: number;
  consumed_carbs_g: number;
  consumed_fat_g: number;
  target_kcal: number | null;
  protein_target_g: number | null;
  remaining_kcal: number | null;
  remaining_protein_g: number | null;
  burned_active_kcal: number | null;
  burned_total_kcal: number | null;
  net_vs_burn_kcal: number | null;
}

export interface CrewPreset {
  id: number;
  name: string;
  category: string;
  meal_type: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  weight_g: number | null;
  location: string;
}

export interface FoodTargetActive {
  id: number;
  effective_date: string;
  maintenance_kcal: number | null;
  deficit_kcal: number | null;
  target_kcal: number;
  protein_g: number;
  basis_weight_kg: number | null;
  method: string;
  notes: string | null;
}

export interface FoodTargetSuggestion {
  maintenance_kcal: number | null;
  deficit_kcal: number;
  target_kcal: number | null;
  protein_g: number | null;
  basis_weight_kg: number | null;
  protein_per_kg: number;
  method: string;
}

export interface FoodTargetsResponse {
  active: FoodTargetActive | null;
  suggestion: FoodTargetSuggestion;
}

export interface FoodTargetPut {
  effective_date?: string;
  target_kcal: number;
  protein_g: number;
  maintenance_kcal?: number | null;
  deficit_kcal?: number | null;
  basis_weight_kg?: number | null;
  notes?: string;
}

export interface MealPlan {
  meals: { name: string; kcal: number; protein_g: number; why: string }[];
  note?: string;
}

// ── API ───────────────────────────────────────────────────────────────────────

export const foodApi = {
  listEntries: (params?: { date?: string; from?: string; to?: string }): Promise<FoodEntry[]> => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const q = qs.toString();
    return get(`/food/entries${q ? `?${q}` : ""}`);
  },

  summary: (date: string): Promise<FoodSummary> => get(`/food/summary?date=${date}`),

  presets: (location = "PMI"): Promise<CrewPreset[]> =>
    get(`/food/presets?location=${location}`),

  targets: (params?: { date?: string; deficit?: number; protein_per_kg?: number }): Promise<FoodTargetsResponse> => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.deficit != null) qs.set("deficit", String(params.deficit));
    if (params?.protein_per_kg != null) qs.set("protein_per_kg", String(params.protein_per_kg));
    const q = qs.toString();
    return get(`/food/targets${q ? `?${q}` : ""}`);
  },

  status: (): Promise<{ provider: string; available: boolean }> => get(`/food/status`),

  // Multipart → proxy (raw body forwarded to preserve boundary).
  analyze: async (fd: FormData): Promise<AnalyzeResult> => {
    const res = await fetch(`${PROXY_BASE}/api/food/analyze`, { method: "POST", body: fd, cache: "no-store" });
    if (!res.ok) throw new Error(`analyze failed ${res.status}`);
    return res.json();
  },

  create: (body: FoodEntryIn): Promise<FoodEntry> => proxyPost("/api/food/entries", body),

  update: (id: number, body: Partial<FoodEntryIn>): Promise<FoodEntry> =>
    proxyPatch(`/api/food/entries/${id}`, body),

  delete: (id: number): Promise<void> => proxyDelete(`/api/food/entries/${id}`),

  putTargets: (body: FoodTargetPut): Promise<FoodTargetActive> => proxyPut("/api/food/targets", body),

  mealPlan: (date: string): Promise<{ id: number; date: string; plan: MealPlan; model: string; generated_at: string }> =>
    get(`/food/meal-plan?date=${date}`),

  generateMealPlan: (date: string, preferences?: string): Promise<{ date: string; plan: MealPlan }> => {
    const qs = new URLSearchParams({ date });
    if (preferences) qs.set("preferences", preferences);
    return proxyPost(`/api/food/meal-plan/generate?${qs.toString()}`);
  },
};
