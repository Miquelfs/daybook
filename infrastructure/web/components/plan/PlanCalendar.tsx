"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { addDays, addMonths, format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import { Cake, ChevronLeft, ChevronRight, Earth, ListChecks, Plane, Plus, StickyNote, Target, Trophy, Star } from "lucide-react";
import { plansApi, type Goal, type PlannedTrip, type Task } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { Block, Panel } from "./ui";
import { PlannedTripSheet, TripsAhead } from "./TripsAhead";

type Kind = "trip" | "trip_planned" | "event" | "achievement" | "birthday" | "logged" | "task" | "note" | "deadline";
type Mark = { kind: Kind; label: string | null; id: number | null; time?: string | null };

const DOT: Partial<Record<Kind, string>> = {
  task: "#A1A1AA", note: "#71717A", deadline: "#10B981", achievement: "#10B981", event: "#F59E0B", birthday: "#DB2777",
};
const ICON: Partial<Record<Kind, typeof Plane>> = {
  task: ListChecks, note: StickyNote, deadline: Target, achievement: Trophy, event: Star, birthday: Cake,
  trip: Earth, trip_planned: Plane,
};
const ORDER: Kind[] = ["trip_planned", "trip", "birthday", "deadline", "task", "note", "event", "achievement"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function useMarks(month: Date) {
  const key = format(month, "yyyy-MM");
  return useQuery<Record<string, Mark[]>>({
    queryKey: ["plan-calendar", key],
    queryFn: () => fetch(`/api/calendar/marks?month=${key}&plan=1`).then((r) => (r.ok ? r.json() : {})),
    staleTime: 60_000,
  }).data ?? {};
}

/**
 * Plan → Calendar: everything dated ahead in one place — tasks and notes due,
 * trips (planned and past), birthdays, goal deadlines. Tap a day for its items
 * and to add a task or plan a trip from it; below, the next 30 days as a list.
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

  // Next 30 days, from this and next month's marks (past trips and "logged" left out).
  const ahead = useMemo(() => {
    const all = { ...thisMonth, ...nextMonth };
    const out: [string, Mark[]][] = [];
    for (let i = 0; i <= 30; i++) {
      const d = format(addDays(parseISO(today), i), "yyyy-MM-dd");
      // A planned trip only on its first day in the list.
      const items = (all[d] ?? []).filter((m) => m.kind !== "logged" && m.kind !== "trip"
        && !(m.kind === "trip_planned" && i > 0 && (all[format(addDays(parseISO(d), -1), "yyyy-MM-dd")] ?? [])
          .some((x) => x.kind === "trip_planned" && x.id === m.id)));
      if (items.length) out.push([d, items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))]);
    }
    return out;
  }, [thisMonth, nextMonth, today]);

  function item(m: Mark, date: string, key: string) {
    const Icon = ICON[m.kind] ?? Star;
    const clickable = m.kind !== "birthday" && m.kind !== "event" && m.kind !== "achievement";
    const body = (
      <>
        <Icon size={14} strokeWidth={1.75} className="shrink-0" style={{ color: DOT[m.kind] ?? (m.kind.startsWith("trip") ? "#0EA5E9" : "#71717A") }} />
        <span className="flex-1 min-w-0 truncate text-sm text-[#D4D4D8]">
          {m.time && <span className="tabular-nums text-[#71717A] mr-2">{m.time}</span>}
          {m.kind === "birthday" ? `${m.label}'s birthday` : m.kind === "deadline" ? `${m.label} — deadline` : m.label}
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

      <Panel className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => setMonth(subMonths(month, 1))} aria-label="Previous month"
                  className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronLeft size={16} /></button>
          <button onClick={() => { setMonth(startOfMonth(new Date())); setSelected(today); }}
                  className="text-sm font-semibold text-[#FAFAFA] px-2 py-1 rounded-lg hover:bg-[#18181B]">
            {format(month, "MMMM yyyy")}
          </button>
          <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"
                  className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((d, i) => <span key={i} className="text-[10px] text-[#52525B] pb-1">{d}</span>)}
          {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
          {Array.from({ length: days }).map((_, i) => {
            const iso = `${key}-${String(i + 1).padStart(2, "0")}`;
            const kinds = new Set((marks[iso] ?? []).map((m) => m.kind));
            const isSel = iso === selected;
            const dots = (["task", "note", "deadline", "achievement", "event", "birthday"] as Kind[]).filter((k) => kinds.has(k));
            return (
              <button key={iso} onClick={() => setSelected(iso)}
                      className={`relative flex items-center justify-center h-11 rounded-lg text-sm tabular-nums transition-colors ${
                        isSel ? "bg-[#F59E0B] text-black font-semibold"
                          : iso === today ? "ring-1 ring-[#F59E0B] text-[#FAFAFA]"
                          : iso < today ? "text-[#52525B] hover:bg-[#18181B]" : "text-[#D4D4D8] hover:bg-[#18181B]"}`}>
                {i + 1}
                {dots.length > 0 && (
                  <span className="absolute bottom-1.5 flex gap-0.5">
                    {dots.slice(0, 4).map((k) => (
                      <span key={k} className="w-1 h-1 rounded-full" style={{ background: isSel ? "#000" : DOT[k] }} />
                    ))}
                  </span>
                )}
                {(kinds.has("trip") || kinds.has("trip_planned")) && (
                  <span className={`absolute bottom-0 left-1 right-1 ${
                    kinds.has("trip") ? "h-0.5 rounded-full bg-sky-500" : "border-t border-dashed border-sky-500"}`} />
                )}
              </button>
            );
          })}
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
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {dayItems.map((m, i) => item(m, selected, `${m.kind}${m.id}${i}`))}
          </Panel>
        )}
      </Block>

      <Block title="Next 30 days">
        {ahead.length === 0 ? (
          <p className="text-xs text-[#52525B] px-1">Nothing dated in the next month.</p>
        ) : (
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {ahead.map(([d, items]) => (
              <div key={d} className="flex gap-4 py-2">
                <button onClick={() => { setSelected(d); setMonth(startOfMonth(parseISO(d))); }}
                        className="shrink-0 w-12 text-left pt-2">
                  <p className={`text-[10px] uppercase tracking-widest ${d === today ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
                    {d === today ? "Today" : format(parseISO(d), "EEE")}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-[#A1A1AA]">{format(parseISO(d), "d MMM")}</p>
                </button>
                <div className="flex-1 min-w-0">
                  {items.map((m, i) => item(m, d, `${m.kind}${m.id}${i}`))}
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
