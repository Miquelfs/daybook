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
  /** null → progress counts from 1 Jan of the deadline's year. */
  start_date: string | null;
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
  /** HH:MM, optional. */
  due_time: string | null;
  remind_days: number | null;
  repeat: TaskRepeat | null;
  area: string | null;
  goal_id: number | null;
  /** Part of a planned trip's checklist. */
  planned_trip_id: number | null;
  done_at: string | null;
  created_at: string;
  days_until?: number | null;
}

export type TaskIn = Partial<Pick<Task,
  "title" | "notes" | "kind" | "due_date" | "due_time" | "remind_days" | "repeat" | "area" | "goal_id" |
  "planned_trip_id" | "done_at">>;

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
  trips: PlannedTrip[];
}

export interface AreaPlan {
  area: string;
  tasks: Task[];
  goals: Goal[];
}

/** Why a tag is a tracked habit. */
export type HabitWhy = "pinned" | "goal" | "experiment";

export interface Habit {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string | null;
  is_negative: boolean;
  why: HabitWhy[];
  /** Amount tags (drinks, times): each day carries a number. */
  counted: boolean;
  amount_30: number | null;
  week: { date: string; done: boolean; count: number | null }[];   // last 7 days, oldest first
  rate_30: number;                           // % of the last 30 days on target (clean days for negative)
  count_30: number;
  this_year: number;
  total: number;
  last: string | null;
  streak_current: number;
  streak_best: number;
  streak_best_end: string | null;
}

/** Any tag, for Habits → Explore. */
export interface TagSummary {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string | null;
  is_negative: boolean;
  total: number;
  this_year: number;
  last: string;
  tracked: boolean;
}

export interface HabitDetail {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string | null;
  is_negative: boolean;
  why: HabitWhy[];
  year: number;
  years: number[];
  dates: string[];
  count: number;
  days_elapsed: number;
  rate: number;
  per_week: number | null;
  by_month: number[];
  by_weekday: number[];                      // Mon … Sun
  best_in_year: number;
  counted: boolean;
  counts: Record<string, number>;
  amount: number | null;
  amount_by_month: number[] | null;
  amount_per_day: number | null;
  amount_max: number | null;
  total: number;
  first: string | null;
  streak_current: number;
  streak_best: number;
  streak_best_end: string | null;
}

export interface PersonBirthday { stored: string; next: string; days_until: number; turning: number | null }

export interface Person {
  id: number;
  name: string;
  emoji: string | null;
  group_: string | null;
  total: number;
  this_year: number;
  last: string | null;
  days_since: number | null;
  birthday: PersonBirthday | null;
}

export interface PersonProfile {
  id: number;
  name: string;
  emoji: string | null;
  group_: string | null;
  birthday: PersonBirthday | null;
  year: number;
  years: number[];
  dates: string[];
  count: number;
  /** null when you weren't logging people yet at this point last year. */
  prev_same_period: number | null;
  per_month: number | null;
  share: number;
  /** Shares count from here when you started logging mid-year. */
  since: string | null;
  by_year: { year: number; days: number }[];
  by_month: number[];
  by_weekday: number[];
  total: number;
  first: string | null;
  last: string | null;
  days_since: number | null;
  longest_run: number;
  typical_gap: number | null;
  /** Explicit links only — trainings / trips marked "with", tennis, restaurants. */
  together: {
    activities: { id: string; date: string; type: string | null; name: string | null; distance_m: number | null }[];
    sports: { type: string; count: number }[];
    tennis: { sessions: number; as_partner: number; as_opponent: number } | null;
    restaurants: { id: number; name: string; date_visited: string; city: string | null }[];
    trips: {
      id: number; name: string | null; start: string; end: string; planned: boolean;
      countries: string[]; cover: string | null; nights: number; days_until: number | null;
    }[];
  };
  recent: string[];
}

export interface PlannedTrip {
  id: number;
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  notes: string | null;
  budget: number | null;
  adopted_start: string | null;
  adopted_end: string | null;
  nights: number;
  days_until: number;
  ongoing: boolean;
  with: Companion[];
  checklist_total: number;
  checklist_done: number;
}

/** A planned trip's page. */
export interface PlannedTripDetail extends PlannedTrip {
  days: { date: string; note: string | null }[];
  checklist: Task[];
  flights: { id: number; date: string; origin: string | null; destination: string | null;
             flight_number: string | null; airline: string | null; dep_time: string | null; arr_time: string | null }[];
}

export type PlannedTripIn = Partial<Pick<PlannedTrip, "name" | "destination" | "start_date" | "end_date" | "notes" | "budget">> & {
  contact_ids?: number[];
};

export interface Companion { id: number; name: string; emoji: string | null; group_: string | null }

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

  plannedTrips: () => req<PlannedTrip[]>("GET", "/api/planned-trips"),
  plannedTrip: (id: number) => req<PlannedTripDetail>("GET", `/api/planned-trips/${id}`),
  setTripDay: (id: number, day: string, note: string | null) =>
    req<void>("PUT", `/api/planned-trips/${id}/days/${day}`, { note }),
  planForTrip: (start: string, end: string) =>
    req<PlannedTripDetail | null>("GET", `/api/planned-trips/for-trip/${start}/${end}`),
  createPlannedTrip: (body: PlannedTripIn) => req<PlannedTrip>("POST", "/api/planned-trips", body),
  updatePlannedTrip: (id: number, body: PlannedTripIn) => req<PlannedTrip>("PATCH", `/api/planned-trips/${id}`, body),
  deletePlannedTrip: (id: number) => req<void>("DELETE", `/api/planned-trips/${id}`),
  habits: () => req<Habit[]>("GET", "/api/habits"),
  exploreTags: () => req<TagSummary[]>("GET", "/api/habits/explore"),
  track: (slug: string, on: boolean) => req<void>(on ? "POST" : "DELETE", `/api/habits/${encodeURIComponent(slug)}/track`),
  activityWith: (id: string) => req<Companion[]>("GET", `/api/companions/activity/${encodeURIComponent(id)}`),
  setActivityWith: (id: string, ids: number[]) =>
    req<Companion[]>("PUT", `/api/companions/activity/${encodeURIComponent(id)}`, { contact_ids: ids }),
  tripWith: (start: string, end: string) => req<Companion[]>("GET", `/api/companions/trip/${start}/${end}`),
  setTripWith: (start: string, end: string, ids: number[]) =>
    req<Companion[]>("PUT", `/api/companions/trip/${start}/${end}`, { contact_ids: ids }),
  habit: (slug: string, year: number) => req<HabitDetail>("GET", `/api/habits/${encodeURIComponent(slug)}?year=${year}`),
  people: () => req<Person[]>("GET", "/api/people"),
  person: (id: number, year: number) => req<PersonProfile>("GET", `/api/people/${id}?year=${year}`),
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
export const PLAN_KEYS = [["agenda"], ["goals"], ["tasks"], ["birthdays"], ["area-plan"], ["habits"], ["habit"], ["habit-tags"], ["people"], ["person"], ["planned-trips"], ["planned-trip"], ["plan-calendar"], ["calendar-marks"]] as const;
