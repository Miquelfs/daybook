import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Goal, GoalState, Task } from "@/lib/plans-api";

/** "Today", "Tomorrow", "in 5d", "Fri 24 Oct", "3d overdue". */
export function dueLabel(due: string, today: string): string {
  const n = differenceInCalendarDays(parseISO(due), parseISO(today));
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return format(parseISO(due), "EEE");
  return format(parseISO(due), n > 300 ? "d MMM yyyy" : "d MMM");
}

export function fmtNum(v: number, unit: string): string {
  if (unit === "€") return `€${Math.round(v).toLocaleString("en-GB")}`;
  const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-GB") : String(Math.round(v * 10) / 10);
  return unit ? `${n} ${unit}` : n;
}

/** One line under the bar — what the number means right now. */
export function goalSummary(g: Goal): string {
  const u = g.unit;
  if (g.lower_is_better && g.actual != null) {
    if (g.target != null) return `${g.actual} of ${g.target} days allowed`;
    if (g.compare != null) return `${g.actual} days · ${g.compare} by this date last year`;
    return `${g.actual} days so far`;
  }
  if (g.actual == null) {
    if (g.state === "overdue" && g.deadline) return `Deadline was ${format(parseISO(g.deadline), "d MMM")}`;
    if (g.days_left != null) return `${g.days_left} days left`;
    return g.notes ?? "";
  }
  const base = g.target != null ? `${fmtNum(g.actual, u)} / ${fmtNum(g.target, u)}` : fmtNum(g.actual, u);
  if (g.state === "behind" && g.expected != null)
    return `${base} · ${fmtNum(g.expected - g.actual, u)} behind pace`;
  if (g.needed_per_week != null && g.needed_per_week > 0 && ["on_track", "behind", "in_progress"].includes(g.state))
    return `${base} · ${fmtNum(g.needed_per_week, u)}/wk to go`;
  return base;
}

export const STATE_STYLE: Record<GoalState, { label: string; cls: string; bar: string }> = {
  on_track:    { label: "On track",    cls: "text-emerald-400 bg-emerald-500/10", bar: "bg-emerald-500" },
  behind:      { label: "Behind",      cls: "text-amber-400 bg-amber-500/10",     bar: "bg-amber-500" },
  achieved:    { label: "Achieved",    cls: "text-emerald-300 bg-emerald-500/15", bar: "bg-emerald-400" },
  missed:      { label: "Missed",      cls: "text-red-400 bg-red-500/10",         bar: "bg-red-500/70" },
  in_progress: { label: "In progress", cls: "text-sky-400 bg-sky-500/10",         bar: "bg-sky-500" },
  overdue:     { label: "Overdue",     cls: "text-red-400 bg-red-500/10",         bar: "bg-red-500/70" },
  not_started: { label: "Not started", cls: "text-[#71717A] bg-[#18181B]",        bar: "bg-[#3F3F46]" },
  done:        { label: "Done",        cls: "text-emerald-300 bg-emerald-500/15", bar: "bg-emerald-400" },
  dropped:     { label: "Dropped",     cls: "text-[#52525B] bg-[#18181B]",        bar: "bg-[#3F3F46]" },
};

export function taskMeta(t: Task, today: string): string[] {
  const bits: string[] = [];
  if (t.due_date) bits.push(dueLabel(t.due_date, today));
  if (t.repeat) bits.push(`↻ ${t.repeat}`);
  if (t.area) bits.push(t.area);
  return bits;
}
