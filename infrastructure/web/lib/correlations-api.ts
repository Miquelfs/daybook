const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

export type MetricMeta = {
  key: string;
  label: string;
  unit: string;
  category: string;
};

export type CatalogResponse = Record<string, MetricMeta[]>;

export type ScatterPoint = { date: string; x: number; y: number };

export type CorrelationResult = {
  metric_a: MetricMeta;
  metric_b: MetricMeta;
  points: ScatterPoint[];
  r: number | null;
  p_value: number | null;
  n: number;
  interpretation: string;
  trendline: { slope: number; intercept: number } | null;
};

export type TopCorrelation = {
  metric_a: string;
  metric_b: string;
  label_a: string;
  label_b: string;
  r: number;
  n: number;
  interpretation: string;
};

export type WeekdayStat = {
  weekday: string;
  weekday_num: number;
  avg_mood: number | null;
  avg_energy: number | null;
  avg_hrv: number | null;
  n: number;
};

export type TagImpact = {
  slug: string;
  name: string;
  icon: string | null;
  usage: number;
  avg_mood_with: number;
  avg_mood_without: number;
  delta: number;
};

export type WeeklyStatsResponse = {
  by_weekday: WeekdayStat[];
  best_weekday_mood: string | null;
  best_weekday_energy: string | null;
  top_tags: TagImpact[];
};

export type JournalEntry = {
  date: string;
  mood: number | null;
  mood_note: string;
  tags: string[];
};

export type PrecomputedCorrelation = {
  metric_a: string;
  metric_b: string;
  label_a: string;
  label_b: string;
  category_a: string;
  category_b: string;
  r: number;
  p_value: number | null;
  n: number;
  lag: number;
  is_new: boolean;
  r_prev: number | null;
  direction: "new" | "stronger" | "weaker" | "stable";
  interpretation: string;
};

export type PrecomputedResponse = {
  computed_at: string | null;
  correlations: PrecomputedCorrelation[];
};

export type PeriodStats = {
  start: string;
  end: string;
  avg: number | null;
  stddev?: number | null;
};

export type CompareResponse = {
  metric: string;
  label: string;
  unit: string;
  period: "month" | "week" | "year";
  current: PeriodStats;
  prior: PeriodStats;
  same_period_last_year: PeriodStats;
  pct_change: number | null;
};

export type TagStats = {
  slug: string;
  name: string;
  icon: string | null;
  category: string;
  total_days_all: number;
  total_days_90d: number;
  first_used: string | null;
  last_used: string | null;
  avg_gap_days: number | null;
  peak_month: number | null;
  weekly_sparkline: { week: string; count: number }[];
  rolling_28d: { period_end: string; count: number }[];
  mood_impact: { avg_with: number; avg_without: number | null; delta: number | null; n: number } | null;
  energy_impact: { avg_with: number; avg_without: number | null; delta: number | null; n: number } | null;
  hrv_impact: { avg_with: number; avg_without: number | null; delta: number | null; n: number } | null;
};

export const correlationsApi = {
  catalog: (): Promise<CatalogResponse> =>
    fetch(`${BASE}/correlations/catalog`, { cache: "no-store" }).then((r) => r.json()),

  compute: (a: string, b: string, days: number): Promise<CorrelationResult> =>
    fetch(`${BASE}/correlations/compute?metric_a=${encodeURIComponent(a)}&metric_b=${encodeURIComponent(b)}&days=${days}`, {
      cache: "no-store",
    }).then((r) => r.json()),

  top: (days: number): Promise<{ top_correlations: TopCorrelation[] }> =>
    fetch(`${BASE}/correlations/top?days=${days}`, { cache: "no-store" }).then((r) => r.json()),

  weeklyStats: (): Promise<WeeklyStatsResponse> =>
    fetch(`${BASE}/correlations/weekly-stats`, { cache: "no-store" }).then((r) => r.json()),

  journal: (q: string, limit: number, offset: number): Promise<JournalEntry[]> =>
    fetch(
      `${BASE}/correlations/journal?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
      { cache: "no-store" }
    ).then((r) => r.json()),

  precomputed: (window = 90, limit = 20, domain = ""): Promise<PrecomputedResponse> =>
    fetch(
      `${BASE}/correlations/precomputed?window=${window}&limit=${limit}${domain ? `&domain=${domain}` : ""}`,
      { cache: "no-store" }
    ).then((r) => r.json()),

  compare: (metric: string, period: "month" | "week" | "year"): Promise<CompareResponse> =>
    fetch(`${BASE}/correlations/compare?metric=${encodeURIComponent(metric)}&period=${period}`, {
      cache: "no-store",
    }).then((r) => r.json()),

  tagStats: (slug: string): Promise<TagStats> =>
    fetch(`${BASE}/tags/${encodeURIComponent(slug)}/stats`, { cache: "no-store" }).then((r) => r.json()),
};
