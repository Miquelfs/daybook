"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import {
  Bike, Cake, Check, ChevronLeft, ChevronRight, Dumbbell, Earth, Footprints, ListChecks, Plane, Plus, StickyNote,
  Target, Trophy, Star, Waves,
} from "lucide-react";
import { plansApi, type Goal, type PlannedTrip, type Task } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { DUTY, ink } from "@/lib/duty";
import { SPORT_COLORS } from "@/lib/sport";
import { Block, Panel } from "./ui";
import { PlannedTripSheet, TripsAhead } from "./TripsAhead";

type Kind = "trip" | "trip_planned" | "event" | "achievement" | "birthday" | "logged" | "task" | "note" | "deadline"
  | "duty" | "training";
type Mark = {
  kind: Kind; label: string | null; id: number | null; time?: string | null;
  // duty
  code?: string;
  // training
  discipline?: string; minutes?: number; zone?: string; status?: string; optional?: boolean; activity_id?: string | null;
  // your own birthday
  self?: boolean; age?: number;
};

const DOT: Partial<Record<Kind, string>> = {
  task: "#A1A1AA", note: "#71717A", deadline: "#10B981", achievement: "#10B981", event: "#F59E0B", birthday: "#DB2777",
};
const ICON: Partial<Record<Kind, typeof Plane>> = {
  task: ListChecks, note: StickyNote, deadline: Target, achievement: Trophy, event: Star, birthday: Cake,
  trip: Earth, trip_planned: Plane,
};
const ORDER: Kind[] = ["duty", "training", "trip_planned", "trip", "birthday", "deadline", "task", "note", "event", "achievement"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const WORKING = new Set(["flying_duty", "standby", "ground_duty"]);

// Training sessions by discipline: the app's sport colours, gym in grey
function sport(disc?: string): { color: string; Icon: typeof Bike; name: string } {
  const d = (disc ?? "").toLowerCase();
  if (/cycl|ride|bik/.test(d)) return { color: SPORT_COLORS.ride, Icon: Bike, name: "Ride" };
  if (/run/.test(d)) return { color: SPORT_COLORS.run, Icon: Footprints, name: "Run" };
  if (/swim/.test(d)) return { color: SPORT_COLORS.swim, Icon: Waves, name: "Swim" };
  return { color: SPORT_COLORS.other, Icon: Dumbbell, name: "Gym" };
}

const sessionName = (label: string | null) => (label ?? "Session").replace(/^(Cycling|Running|Swimming|Strength) - /, "");
const duty = (m?: Mark) => DUTY[m?.label ?? ""] ?? DUTY.unknown;

function useMarks(month: Date) {
  const key = format(month, "yyyy-MM");
  return useQuery<Record<string, Mark[]>>({
    queryKey: ["plan-calendar", key],
    queryFn: () => fetch(`/api/calendar/marks?month=${key}&plan=1`).then((r) => (r.ok ? r.json() : {})),
    staleTime: 60_000,
  }).data ?? {};
}

/** A training session as a chip in a day cell: filled = done, outline = to do, dashed = optional, faded = missed. */
function SessionChip({ m, past, compact }: { m: Mark; past: boolean; compact?: boolean }) {
  const { color, Icon } = sport(m.discipline);
  const done = m.status === "completed";
  const missed = !done && past && !m.optional;
  return (
    <span className={`flex items-center justify-center gap-0.5 rounded-md px-1 h-[18px] text-[10px] font-semibold tabular-nums leading-none ${
            m.optional && !done ? "border border-dashed" : "border"} ${missed || (past && !done) ? "opacity-35" : ""}`}
          style={{ borderColor: color, background: done ? color : `color-mix(in srgb, ${color} 12%, transparent)`,
                   color: done ? "#09090B" : ink(color) }}>
      {done ? <Check size={10} strokeWidth={3} /> : <Icon size={10} strokeWidth={2.25} />}
      {!compact && m.minutes ? <span className="hidden sm:inline">{m.minutes}</span> : null}
    </span>
  );
}

/**
 * Plan → Calendar: how the days are really planned — the roster duty, the training placed
 * around it, and everything else dated (tasks, notes, trips, birthdays, goal deadlines).
 * Tap a day for its detail and to add a task or plan a trip from it; below, the next 30 days.
 */
export function PlanCalendar({ onEditTask, onNewTask, onEditGoal }: {
  onEditTask: (t: Task) => void;
  onNewTask: (date: string) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const today = localISODate();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(today);
  const [tripSheet, setTripSheet] = useState<{ trip?: PlannedTrip; start?: string } | null>(null);
  const router = useRouter();

  const marks = useMarks(month);
  const thisMonth = useMarks(startOfMonth(new Date()));
  const nextMonth = useMarks(addMonths(startOfMonth(new Date()), 1));
  // Lookups so a mark's id opens the real thing.
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks", "open", "all"], queryFn: () => plansApi.tasks({ status: "open" }) });
  const { data: goals = [] } = useQuery({
    queryKey: ["goals", new Date().getFullYear()], queryFn: () => plansApi.goals(new Date().getFullYear()),
  });

  function open(m: Mark) {
    if ((m.kind === "task" || m.kind === "note") && m.id != null) {
      const t = tasks.find((x) => x.id === m.id);
      if (t) onEditTask(t);
    } else if (m.kind === "deadline" && m.id != null) {
      const g = goals.find((x) => x.id === m.id);
      if (g) onEditGoal(g);
    } else if (m.kind === "trip_planned" && m.id != null) {
      router.push(`/plan/trip/${m.id}`);
    }
  }

  const key = format(month, "yyyy-MM");
  const lead = (month.getDay() + 6) % 7;
  const days = getDaysInMonth(month);
  const dayItems = (marks[selected] ?? thisMonth[selected] ?? nextMonth[selected] ?? [])
    .filter((m) => m.kind !== "logged")
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const selDuty = dayItems.find((m) => m.kind === "duty");
  const selTraining = dayItems.filter((m) => m.kind === "training");
  const selOther = dayItems.filter((m) => m.kind !== "duty" && m.kind !== "training");

  // The month at a glance: working days vs off, and the training load placed around them
  const summary = useMemo(() => {
    const all = Object.values(marks).flat();
    const duties = all.filter((m) => m.kind === "duty");
    const sessions = all.filter((m) => m.kind === "training" && !m.optional);
    return {
      working: duties.filter((m) => WORKING.has(m.label ?? "")).length,
      off: duties.filter((m) => m.label === "day_off").length,
      vacation: duties.filter((m) => m.label === "vacation").length,
      sessions: sessions.length,
      done: sessions.filter((m) => m.status === "completed").length,
      hours: Math.round(sessions.reduce((s, m) => s + (m.minutes ?? 0), 0) / 60),
    };
  }, [marks]);

  // Next 30 days, from this and next month's marks (past trips, "logged" and plain days off left out).
  const ahead = useMemo(() => {
    const all = { ...thisMonth, ...nextMonth };
    const out: [string, Mark[], Mark | undefined][] = [];
    for (let i = 0; i <= 30; i++) {
      const d = format(addDays(parseISO(today), i), "yyyy-MM-dd");
      const day = all[d] ?? [];
      // A planned trip only on its first day in the list.
      const items = day.filter((m) => m.kind !== "logged" && m.kind !== "trip" && m.kind !== "duty"
        && !(m.kind === "trip_planned" && i > 0 && (all[format(addDays(parseISO(d), -1), "yyyy-MM-dd")] ?? [])
          .some((x) => x.kind === "trip_planned" && x.id === m.id)));
      const dm = day.find((m) => m.kind === "duty");
      if (items.length || (dm && WORKING.has(dm.label ?? ""))) {
        out.push([d, items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)), dm]);
      }
    }
    return out;
  }, [thisMonth, nextMonth, today]);

  function trainingRow(m: Mark, date: string, k: string) {
    const { color, Icon, name } = sport(m.discipline);
    const done = m.status === "completed";
    const missed = !done && date < today && !m.optional;
    const body = (
      <>
        <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: done ? color : `color-mix(in srgb, ${color} 14%, transparent)`, color: done ? "#09090B" : ink(color) }}>
          {done ? <Check size={14} strokeWidth={2.75} /> : <Icon size={14} strokeWidth={2} />}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block truncate text-sm ${missed ? "text-[#52525B] line-through" : "text-[#D4D4D8]"}`}>{sessionName(m.label)}</span>
          <span className="block text-[11px] text-[#71717A] tabular-nums">
            {name} · {m.minutes} min{m.zone ? ` · ${m.zone}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-widest"
              style={{ color: done ? ink("#4ADE80") : missed ? ink("#FB923C") : "#52525B" }}>
          {done ? "done" : missed ? "missed" : m.optional ? "optional" : ""}
        </span>
      </>
    );
    const href = done && m.activity_id ? `/activity/${m.activity_id}` : `/day/${date}`;
    return <Link key={k} href={href} className="flex items-center gap-3 py-2 hover:opacity-80">{body}</Link>;
  }

  function item(m: Mark, date: string, key: string) {
    if (m.kind === "training") return trainingRow(m, date, key);
    const Icon = ICON[m.kind] ?? Star;
    const clickable = m.kind !== "birthday" && m.kind !== "event" && m.kind !== "achievement";
    const body = (
      <>
        <Icon size={14} strokeWidth={1.75} className="shrink-0 ml-1.5 mr-1.5" style={{ color: DOT[m.kind] ?? (m.kind.startsWith("trip") ? "#0EA5E9" : "#71717A") }} />
        <span className="flex-1 min-w-0 truncate text-sm text-[#D4D4D8]">
          {m.time && <span className="tabular-nums text-[#71717A] mr-2">{m.time}</span>}
          {m.kind === "birthday" ? (m.self ? `Your birthday · ${m.age}` : `${m.label}'s birthday`)
            : m.kind === "deadline" ? `${m.label} — deadline` : m.label}
        </span>
      </>
    );
    if (m.kind === "birthday") return <Link key={key} href="/plan?tab=people" className="flex items-center gap-3 py-2">{body}</Link>;
    if (m.kind === "trip") return <Link key={key} href={`/day/${date}`} className="flex items-center gap-3 py-2 hover:opacity-80">{body}</Link>;
    return clickable
      ? <button key={key} onClick={() => open(m)} className="w-full flex items-center gap-3 py-2 text-left hover:opacity-80">{body}</button>
      : <div key={key} className="flex items-center gap-3 py-2">{body}</div>;
  }

  return (
    <div className="space-y-8">
      <TripsAhead />

      <Panel className="p-3 sm:p-4">
        {/* Month header */}
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => setMonth(subMonths(month, 1))} aria-label="Previous month"
                  className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronLeft size={18} /></button>
          <button onClick={() => { setMonth(startOfMonth(new Date())); setSelected(today); }}
                  className="text-base font-semibold text-[#FAFAFA] px-2 py-1 rounded-lg hover:bg-[#18181B]">
            {format(month, "MMMM yyyy")}
          </button>
          <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"
                  className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronRight size={18} /></button>
        </div>

        {/* The month at a glance */}
        {(summary.working + summary.off + summary.vacation + summary.sessions) > 0 && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-[#71717A] tabular-nums mb-3">
            {summary.working > 0 && <span><b className="text-[#D4D4D8]">{summary.working}</b> on duty</span>}
            {summary.off > 0 && <span><b className="text-[#D4D4D8]">{summary.off}</b> off</span>}
            {summary.vacation > 0 && <span><b style={{ color: ink(DUTY.vacation.color) }}>{summary.vacation}</b> vacation</span>}
            {summary.sessions > 0 && (
              <span><b className="text-[#D4D4D8]">{summary.sessions}</b> sessions · {summary.hours} h
                {summary.done > 0 && <> · <b style={{ color: ink("#4ADE80") }}>{summary.done} done</b></>}</span>
            )}
          </div>
        )}

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => <span key={i} className="text-center text-[10px] text-[#52525B] pb-1">{d}</span>)}
          {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
          {Array.from({ length: days }).map((_, i) => {
            const iso = `${key}-${String(i + 1).padStart(2, "0")}`;
            const ms = marks[iso] ?? [];
            const kinds = new Set(ms.map((m) => m.kind));
            const dm = ms.find((m) => m.kind === "duty");
            const dd = dm ? duty(dm) : null;
            const sessions = ms.filter((m) => m.kind === "training");
            const isSel = iso === selected;
            const past = iso < today;
            const dots = (["task", "note", "deadline", "achievement", "event", "birthday"] as Kind[]).filter((k) => kinds.has(k));
            const tint = dd && dm?.label !== "day_off" ? `color-mix(in srgb, ${dd.color} ${past ? 6 : 11}%, transparent)` : undefined;
            return (
              <button key={iso} onClick={() => setSelected(iso)}
                      title={dm ? `${dd!.label}${dm.time ? ` · ${dm.time}` : ""}` : undefined}
                      className={`relative flex flex-col items-stretch h-[4.25rem] sm:h-[4.75rem] rounded-xl p-1 text-left overflow-hidden transition-colors ${
                        isSel ? "ring-2 ring-[#F59E0B]" : iso === today ? "ring-1 ring-[#F59E0B]/60" : "hover:bg-[#18181B]"}`}
                      style={{ background: tint }}>
                {/* duty edge */}
                {dd && dm?.label !== "day_off" && (
                  <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: dd.color, opacity: past ? 0.45 : 1 }} />
                )}
                <span className="flex items-start justify-between gap-0.5">
                  <span className={`text-xs tabular-nums leading-none mt-0.5 ${
                    iso === today ? "font-bold text-[#F59E0B]" : past ? "text-[#52525B]" : "font-medium text-[#D4D4D8]"}`}>
                    {i + 1}
                  </span>
                  {dd && (
                    <span className="text-[8px] sm:text-[9px] font-semibold tracking-wide leading-none mt-0.5"
                          style={{ color: dm?.label === "day_off" ? "#52525B" : ink(dd.color), opacity: past ? 0.6 : 1 }}>
                      {dd.short}
                    </span>
                  )}
                </span>
                {dm?.time && dm.label !== "vacation" && (
                  <span className="hidden sm:block text-[9px] text-[#71717A] tabular-nums leading-tight mt-0.5 truncate">{dm.time}</span>
                )}
                <span className="mt-auto flex flex-wrap gap-0.5">
                  {sessions.slice(0, 2).map((m, k) => <SessionChip key={k} m={m} past={past} compact={sessions.length > 1} />)}
                  {sessions.length > 2 && <span className="text-[9px] text-[#71717A] self-center">+{sessions.length - 2}</span>}
                </span>
                {dots.length > 0 && (
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 flex gap-0.5 mt-3 sm:mt-0">
                    {dots.slice(0, 3).map((k) => <span key={k} className="w-1 h-1 rounded-full" style={{ background: DOT[k] }} />)}
                  </span>
                )}
                {(kinds.has("trip") || kinds.has("trip_planned")) && (
                  <span className={`absolute bottom-0 left-1.5 right-1.5 ${
                    kinds.has("trip") ? "h-0.5 rounded-full bg-sky-500" : "border-t border-dashed border-sky-500"}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-[#18181B] text-[10px] text-[#71717A]">
          {(["flying_duty", "standby", "ground_duty", "vacation"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="w-2.5 h-1 rounded-full" style={{ background: DUTY[k].color }} />{DUTY[k].label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SPORT_COLORS.ride }} />done
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: SPORT_COLORS.ride }} />planned
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm border border-dashed" style={{ borderColor: SPORT_COLORS.ride }} />optional
          </span>
        </div>
      </Panel>

      <Block title={selected === today ? `Today · ${format(parseISO(selected), "EEE d MMM")}` : format(parseISO(selected), "EEEE d MMMM")}
             action={
               <div className="flex items-center gap-3 text-xs">
                 <button onClick={() => onNewTask(selected)} className="inline-flex items-center gap-1 text-[#52525B] hover:text-[#A1A1AA]"><Plus size={12} /> Task</button>
                 <button onClick={() => setTripSheet({ start: selected })} className="inline-flex items-center gap-1 text-[#52525B] hover:text-[#A1A1AA]"><Plane size={12} /> Trip</button>
               </div>
             }>
        {dayItems.length === 0 ? (
          <p className="text-xs text-[#52525B] px-1">Nothing on this day.</p>
        ) : (
          <Panel className="overflow-hidden">
            {selDuty && (
              <Link href={`/day/${selected}`} className="flex items-center gap-3 px-4 py-3 hover:opacity-90"
                    style={{ background: `color-mix(in srgb, ${duty(selDuty).color} 12%, transparent)`,
                             borderLeft: `3px solid ${duty(selDuty).color}` }}>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold" style={{ color: ink(duty(selDuty).color) }}>{duty(selDuty).label}</span>
                  {selDuty.time && <span className="block text-xs text-[#A1A1AA] tabular-nums">{selDuty.time}</span>}
                </span>
                {selDuty.code && <span className="text-[10px] font-mono text-[#71717A]">{selDuty.code}</span>}
              </Link>
            )}
            {(selTraining.length > 0 || selOther.length > 0) && (
              <div className="px-4 py-1 divide-y divide-[#18181B]">
                {selTraining.map((m, i) => trainingRow(m, selected, `t${m.id}${i}`))}
                {selOther.map((m, i) => item(m, selected, `${m.kind}${m.id}${i}`))}
              </div>
            )}
          </Panel>
        )}
      </Block>

      <Block title="Next 30 days">
        {ahead.length === 0 ? (
          <p className="text-xs text-[#52525B] px-1">Nothing dated in the next month.</p>
        ) : (
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {ahead.map(([d, items, dm]) => (
              <div key={d} className="flex gap-4 py-2">
                <button onClick={() => { setSelected(d); setMonth(startOfMonth(parseISO(d))); }}
                        className="shrink-0 w-14 text-left pt-2">
                  <p className={`text-[10px] uppercase tracking-widest ${d === today ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
                    {d === today ? "Today" : format(parseISO(d), "EEE")}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-[#A1A1AA]">{format(parseISO(d), "d MMM")}</p>
                  {dm && dm.label !== "day_off" && (
                    <span className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ color: ink(duty(dm).color), background: `color-mix(in srgb, ${duty(dm).color} 14%, transparent)` }}>
                      {duty(dm).short}{dm.time && dm.label !== "vacation" ? ` ${dm.time.slice(0, 5)}` : ""}
                    </span>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  {items.length ? items.map((m, i) => item(m, d, `${m.kind}${m.id}${i}`))
                    : <p className="text-xs text-[#52525B] pt-3">{duty(dm).label}{dm?.time ? ` · ${dm.time}` : ""}</p>}
                </div>
              </div>
            ))}
          </Panel>
        )}
      </Block>

      {tripSheet && <PlannedTripSheet trip={tripSheet.trip} defaultStart={tripSheet.start} onClose={() => setTripSheet(null)} />}
    </div>
  );
}
