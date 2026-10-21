// Plan ahead — goals (automatic progress), tasks, notes that resurface, birthdays.
// Client-side only: everything goes through the Next.js /api proxy.

/** A key from GET /goals/meta (domains/plans/metrics.py) — "manual", "ride_km", "sleep_hours", … */
export type GoalMetric = string;
export type MetricKind = "sum" | "ceiling" | "avg" | "level" | "best" | "streak" | "manual";

export interface Metric {
  key: GoalMetric;
  label: string;
  area: string;
  unit: string;
  kind: MetricKind;
  hint: string;
  param: "tag" | "contact" | "distance" | null;
  lower_is_better: boolean;
}
export type GoalStatus = "active" | "done" | "dropped";
export type GoalState =
  | "on_track" | "behind" | "achieved" | "missed"
  | "in_progress" | "overdue" | "not_started" | "done" | "dropped";

export interface Goal {
  id: number;
  title: string;
  emoji: string | null;
  area: string | null;
  priority: 1 | 2 | 3;
  start_date: string;
  deadline: string | null;
  metric: GoalMetric;
  metric_param: string | null;
  target: number | null;
  baseline: number | null;
  current: number | null;
  status: GoalStatus;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  // computed by the API
  state: GoalState;
  kind: MetricKind;
  unit: string;
  actual: number | null;
  pct: number | null;
  expected: number | null;
  /** ceiling: same window last year · streak: the run going now · level: start value. */
  compare: number | null;
  lower_is_better: boolean;
  needed_per_week: number | null;
  days_left: number | null;
  /** What the goal is tied to: tag name, person, distance — and the tag's emoji. */
  param_label: string | null;
  param_icon: string | null;
}

export type GoalIn = Partial<Pick<Goal,
  "title" | "emoji" | "area" | "priority" | "start_date" | "deadline" | "metric" |
  "metric_param" | "target" | "baseline" | "current" | "status" | "notes">>;

export type TaskKind = "task" | "note";
export type TaskRepeat = "weekly" | "monthly" | "yearly";

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  kind: TaskKind;
  due_date: string | null;
  remind_days: number | null;
  repeat: TaskRepeat | null;
  area: string | null;
  goal_id: number | null;
  done_at: string | null;
  created_at: string;
  days_until?: number | null;
}

export type TaskIn = Partial<Pick<Task,
  "title" | "notes" | "kind" | "due_date" | "remind_days" | "repeat" | "area" | "goal_id" | "done_at">>;

export interface Birthday {
  contact_id: number;
  name: string;
  emoji: string | null;
  group_: string | null;
  birthday: string;
  date: string;
  days_until: number;
  turning: number | null;
  last_seen: string | null;
  days_since_seen: number | null;
  days_together_this_year: number;
}

export interface Agenda {
  date: string;
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  notes: Task[];
  inbox_count: number;
  birthdays: Birthday[];
  goals: { on_track: number; total: number; behind: Goal[]; due_soon: Goal[] };
}

export interface AreaPlan {
  area: string;
  tasks: Task[];
  goals: Goal[];
}

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

export const plansApi = {
  agenda: (date: string) => req<Agenda>("GET", `/api/agenda?date=${date}`),
  birthdays: () => req<Birthday[]>("GET", "/api/birthdays"),

  goalsMeta: () => req<{ metrics: Metric[]; years: number[] }>("GET", "/api/goals/meta"),
  areaPlan: (area: string) => req<AreaPlan>("GET", `/api/plan/area/${area}`),
  goals: (year?: number) => req<Goal[]>("GET", `/api/goals${year ? `?year=${year}` : ""}`),
  createGoal: (body: GoalIn) => req<Goal>("POST", "/api/goals", body),
  updateGoal: (id: number, body: GoalIn) => req<Goal>("PATCH", `/api/goals/${id}`, body),
  deleteGoal: (id: number) => req<void>("DELETE", `/api/goals/${id}`),

  tasks: (params: { status?: "open" | "done" | "all"; kind?: TaskKind; done_on?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return req<Task[]>("GET", `/api/tasks${qs.size ? `?${qs}` : ""}`);
  },
  createTask: (body: TaskIn) => req<Task>("POST", "/api/tasks", body),
  updateTask: (id: number, body: TaskIn) => req<Task>("PATCH", `/api/tasks/${id}`, body),
  completeTask: (id: number, date: string) => req<Task>("POST", `/api/tasks/${id}/complete`, { date }),
  deleteTask: (id: number) => req<void>("DELETE", `/api/tasks/${id}`),
};

/** Everything plan-related a mutation can change — invalidate these together. */
export const PLAN_KEYS = [["agenda"], ["goals"], ["tasks"], ["birthdays"], ["area-plan"]] as const;
