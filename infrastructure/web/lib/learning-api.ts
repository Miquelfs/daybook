// Learning plans — a curriculum in weeks (the robot-builder roadmap), followed on Today.
// Client-side only: everything goes through the Next.js /api/learning proxy.

export type LearningKind = "course" | "learn" | "skill" | "build" | "buy" | "decide";
export type LearningTier = "core" | "pick" | "later";
export type LearningItemStatus = "todo" | "done" | "skipped";
/** late = past its week · stale = two weeks past (the two-week rule: drop, park or move it). */
export type LearningItemState = "done" | "skipped" | "anytime" | "upcoming" | "now" | "late" | "stale";

export interface LearningPlan {
  id: number;
  slug: string | null;
  title: string;
  emoji: string | null;
  goal: string | null;
  /** Monday of week 1. */
  start_date: string;
  weeks: number;
  weekly_hours: number | null;
  status: "active" | "paused" | "done";
}

export interface LearningItem {
  id: number;
  plan_id: number;
  phase_id: number | null;
  ord: number;
  title: string;
  notes: string | null;
  kind: LearningKind;
  tier: LearningTier;
  resource: string | null;
  url: string | null;
  /** null → any time in the phase. */
  week: number | null;
  weeks: number;
  est_hours: number | null;
  status: LearningItemStatus;
  done_at: string | null;
  // computed
  state?: LearningItemState;
  last_week?: number | null;
}

export interface LearningPhase {
  id: number;
  plan_id: number;
  ord: number;
  title: string;
  summary: string | null;
  week_from: number | null;
  week_to: number | null;
  gate: string | null;
  gate_passed_at: string | null;
  items?: LearningItem[];
  current?: boolean;
}

export interface LearningLog {
  id: number;
  plan_id: number;
  item_id: number | null;
  item_title?: string | null;
  date: string;
  minutes: number;
  note: string | null;
}

export interface LearningPlanDetail {
  plan: LearningPlan;
  week: number;
  phases: LearningPhase[];
  hours_by_week: { week: number; start: string; minutes: number }[];
  minutes_total: number;
  core_done: number;
  core_total: number;
  gates_passed: number;
  behind: number;
}

export interface LearningDay {
  plan: LearningPlan;
  week: number;
  week_start: string;
  phase: LearningPhase | null;
  due: LearningItem[];
  week_total: number;
  week_done: number;
  done_today: LearningItem[];
  logs: LearningLog[];
  minutes_today: number;
  minutes_week: number;
}

export type LearningItemIn = Partial<Pick<LearningItem,
  "phase_id" | "title" | "notes" | "kind" | "tier" | "resource" | "url" | "week" | "weeks" | "est_hours" |
  "status" | "done_at">>;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `${method} ${path} failed ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const learningApi = {
  plans: (today: string) => req<LearningPlanDetail[]>("GET", `/api/learning/plans?today=${today}`),
  updatePlan: (id: number, body: Partial<Pick<LearningPlan, "title" | "emoji" | "goal" | "start_date" | "weekly_hours" | "status">>) =>
    req<LearningPlanDetail>("PATCH", `/api/learning/plans/${id}`, body),
  passGate: (phaseId: number, on: string | null) =>
    req<LearningPhase>("PATCH", `/api/learning/phases/${phaseId}`, { gate_passed_at: on }),
  day: (date: string) => req<LearningDay[]>("GET", `/api/learning/day/${date}`),
  createItem: (body: LearningItemIn & { plan_id: number; title: string }) =>
    req<LearningItem>("POST", "/api/learning/items", body),
  updateItem: (id: number, body: LearningItemIn) => req<LearningItem>("PATCH", `/api/learning/items/${id}`, body),
  setStatus: (id: number, status: LearningItemStatus, on?: string) =>
    req<LearningItem>("PATCH", `/api/learning/items/${id}`, status === "done" ? { status, done_at: on } : { status }),
  deleteItem: (id: number) => req<void>("DELETE", `/api/learning/items/${id}`),
  log: (body: { plan_id: number; item_id?: number | null; date: string; minutes: number; note?: string }) =>
    req<LearningLog>("POST", "/api/learning/logs", body),
  deleteLog: (id: number) => req<void>("DELETE", `/api/learning/logs/${id}`),
};

/** Invalidate these together after any learning mutation. */
export const LEARNING_KEYS = [["learning-day"], ["learning-plans"]] as const;

export const KIND_LABEL: Record<LearningKind, string> = {
  course: "Course", learn: "Learn", skill: "Skill", build: "Build", buy: "Buy", decide: "Decide",
};

export const TIER_LABEL: Record<LearningTier, string> = { core: "Core", pick: "Pick", later: "Later" };

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "wk 6" or "wk 6–9". */
export function weekSpan(i: Pick<LearningItem, "week" | "weeks">): string | null {
  if (i.week == null) return null;
  return i.weeks > 1 ? `wk ${i.week}–${i.week + i.weeks - 1}` : `wk ${i.week}`;
}
