import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Goal, GoalState, Task } from "@/lib/plans-api";

/** "Today", "Tomorrow", "Fri", "24 Oct", "3d overdue". */
export function dueLabel(due: string, today: string): string {
  const n = differenceInCalendarDays(parseISO(due), parseISO(today));
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return format(parseISO(due), "EEE");
  return format(parseISO(due), n > 300 ? "d MMM yyyy" : "d MMM");
}

/** Seconds → "40:30" or "1:45:00". */
export function fmtTime(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** "40", "40:30", "1:45:00" → seconds (a bare number is minutes). */
export function parseTime(s: string): number | null {
  const parts = s.trim().split(":").map(Number);
  if (!s.trim() || parts.some((p) => Number.isNaN(p))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Units that count whole things — never "4.1 books". */
const WHOLE = new Set(["books", "sessions", "days", "flights", "landings", "countries", "trips", "visits", "months", "steps", "m"]);

export function fmtNum(v: number, unit: string): string {
  if (unit === "time") return fmtTime(v);
  if (unit === "€") return `€${Math.round(v).toLocaleString("en-GB")}`;
  const n = Math.abs(v) >= 100 || WHOLE.has(unit)
    ? Math.round(v).toLocaleString("en-GB")
    : String(Math.round(v * 10) / 10);
  if (!unit) return n;
  return unit.startsWith("/") ? `${n}${unit}` : `${n} ${unit}`;
}

/** One line under the bar — what the number means right now. */
export function goalSummary(g: Goal): string {
  const u = g.unit;
  const a = g.actual;
  if (a == null) {
    if (g.state === "overdue" && g.deadline) return `Deadline was ${format(parseISO(g.deadline), "d MMM")}`;
    if (g.state === "not_started") return `Starts ${format(parseISO(g.start_date), "d MMM")}`;
    if (g.days_left != null) return `${g.days_left} days left`;
    return "";
  }
  const of = g.target != null ? ` / ${fmtNum(g.target, u)}` : "";
  switch (g.kind) {
    case "ceiling":
      if (g.target != null) return `${a} of ${g.target} days allowed`;
      return g.compare != null ? `${a} days · ${g.compare} by now last year` : `${a} days so far`;
    case "streak":
      return `Best ${a} days in a row${of ? ` of ${g.target}` : ""} · now ${g.compare ?? 0}`;
    case "avg":
      return `${fmtNum(a, u)} on average${g.target != null ? ` · target ${fmtNum(g.target, u)}` : ""}`;
    case "best":
      return `Best ${fmtNum(a, u)}${g.target != null ? ` · target ${fmtNum(g.target, u)}` : ""}`;
    case "level": {
      const from = g.compare != null ? ` · from ${fmtNum(g.compare, u)}` : "";
      const pace = g.state === "behind" && g.expected != null ? ` · pace says ${fmtNum(g.expected, u)}` : "";
      return `${fmtNum(a, u)}${of}${pace || from}`;
    }
    default: {
      const base = `${fmtNum(a, u)}${of}`;
      if (g.state === "behind" && g.expected != null) return `${base} · ${fmtNum(g.expected - a, u)} behind pace`;
      if (g.needed_per_week != null && g.needed_per_week > 0 && g.state === "on_track")
        return `${base} · ${fmtNum(g.needed_per_week, u)}/wk to go`;
      return base;
    }
  }
}

export const STATE_STYLE: Record<GoalState, { label: string; cls: string }> = {
  on_track:    { label: "On track",    cls: "text-emerald-400 bg-emerald-500/10" },
  behind:      { label: "Behind",      cls: "text-amber-400 bg-amber-500/10" },
  achieved:    { label: "Achieved", cls: "text-emerald-400 bg-emerald-500/15" },
  missed:      { label: "Missed",      cls: "text-rose-400 bg-rose-500/10" },
  in_progress: { label: "In progress", cls: "text-[#A1A1AA] bg-[#18181B]" },
  overdue:     { label: "Overdue",     cls: "text-rose-400 bg-rose-500/10" },
  not_started: { label: "Not started", cls: "text-[#71717A] bg-[#18181B]" },
  done:        { label: "Done", cls: "text-emerald-400 bg-emerald-500/15" },
  dropped:     { label: "Dropped",     cls: "text-[#52525B] bg-[#18181B]" },
};

export function taskMeta(t: Task, today: string): string[] {
  const bits: string[] = [];
  if (t.due_date) bits.push(dueLabel(t.due_date, today));
  if (t.repeat) bits.push(`↻ ${t.repeat}`);
  return bits;
}

// ── Birthdays: stored 'YYYY-MM-DD' / '--MM-DD', typed and shown day-first ───

/** Stored form → what the input shows: '14-03-1992' or '14-03'. */
export function birthdayInput(stored: string | null | undefined): string {
  if (!stored) return "";
  if (stored.startsWith("--")) return `${stored.slice(5, 7)}-${stored.slice(2, 4)}`;
  return `${stored.slice(8, 10)}-${stored.slice(5, 7)}-${stored.slice(0, 4)}`;
}
