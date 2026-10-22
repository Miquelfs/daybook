"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { ArrowLeft, ArrowRight, Pencil, Plane, Plus } from "lucide-react";
import { plansApi, PLAN_KEYS, type Task } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { Avatar } from "@/components/plan/Avatar";
import { TaskRow } from "@/components/plan/TaskRow";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { PlannedTripSheet } from "@/components/plan/TripsAhead";
import { Block, Label, Panel } from "@/components/plan/ui";

/** One line for one day — saved when you leave the field. */
function DayLine({ tripId, date, index, initial }: { tripId: number; date: string; index: number; initial: string | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial ?? "");
  async function save() {
    if (value.trim() === (initial ?? "")) return;
    await plansApi.setTripDay(tripId, date, value.trim() || null);
    qc.invalidateQueries({ queryKey: ["planned-trip", tripId] });
  }
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="shrink-0 w-16">
        <p className="text-[10px] uppercase tracking-widest text-[#52525B]">Day {index + 1}</p>
        <p className="text-xs text-[#A1A1AA] tabular-nums">{format(parseISO(date), "EEE d MMM")}</p>
      </div>
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
             onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
             placeholder="Where / what — e.g. Taipei → Hualien by train"
             className="flex-1 min-w-0 bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none border-b border-transparent focus:border-[#27272A] py-1" />
    </div>
  );
}

/**
 * A planned trip — countdown, who, budget, a checklist (tasks), one line per
 * day and the flights logged in the window. After it happens it points to the
 * detected trip, whose page shows this plan next to what really happened.
 */
export default function PlannedTripPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const qc = useQueryClient();
  const today = localISODate();
  const [editing, setEditing] = useState(false);
  const [task, setTask] = useState<Task | "new" | null>(null);
  const [quick, setQuick] = useState("");
  const { data: t, isLoading } = useQuery({ queryKey: ["planned-trip", id], queryFn: () => plansApi.plannedTrip(id) });

  async function addItem() {
    if (!quick.trim()) return;
    await plansApi.createTask({ title: quick.trim(), planned_trip_id: id });
    setQuick("");
    PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
  }

  if (isLoading) return <main className="max-w-2xl mx-auto px-4 pt-8"><div className="h-48 rounded-2xl bg-[#18181B] animate-pulse" /></main>;
  if (!t) return <main className="max-w-2xl mx-auto px-4 pt-8 text-sm text-[#71717A]">Trip not found.</main>;

  const past = t.end_date < today;
  const dayN = t.ongoing ? t.days.findIndex((d) => d.date === today) + 1 : null;
  const pct = t.checklist_total ? Math.round((t.checklist_done / t.checklist_total) * 100) : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-8 space-y-8">
      <div>
        <Link href="/plan?tab=calendar" className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-3">
          <ArrowLeft size={12} /> Plan
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
            <p className="text-sm text-[#71717A] mt-0.5">
              {t.destination ? `${t.destination} · ` : ""}{format(parseISO(t.start_date), "d MMM")} – {format(parseISO(t.end_date), "d MMM yyyy")}
              {" · "}{t.nights} {t.nights === 1 ? "night" : "nights"}
            </p>
          </div>
          <button onClick={() => setEditing(true)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5">
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>

      {t.adopted_start && t.adopted_end && (
        <Link href={`/explore/trip/${t.adopted_start}/${t.adopted_end}`}
              className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
          It happened — see the trip, with this plan next to it <ArrowRight size={14} />
        </Link>
      )}

      <Panel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">{past ? "Back home" : t.ongoing ? "On the trip" : "Countdown"}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {t.ongoing ? dayN : past ? t.nights : t.days_until}
              </span>
              <span className="text-sm text-[#A1A1AA]">
                {t.ongoing ? `of ${t.days.length} days` : past ? "nights away" : t.days_until === 1 ? "day to go" : "days to go"}
              </span>
            </p>
          </div>
          <Plane size={22} strokeWidth={1.5} className="text-[#52525B] mt-1" />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#27272A]">
          <div>
            <Label>With</Label>
            {t.with.length ? (
              <div className="flex -space-x-2 mt-1">{t.with.map((p) => <Avatar key={p.id} name={p.name} emoji={p.emoji} size={26} />)}</div>
            ) : <p className="text-sm text-[#52525B] mt-1">Solo</p>}
          </div>
          <div>
            <Label>Budget</Label>
            <p className="text-xl font-semibold tabular-nums">{t.budget != null ? `€${Math.round(t.budget).toLocaleString("en-GB")}` : "—"}</p>
          </div>
          <div>
            <Label>Checklist</Label>
            <p className="text-xl font-semibold tabular-nums">{t.checklist_done}/{t.checklist_total}</p>
            {t.checklist_total > 0 && (
              <div className="h-1 bg-[#18181B] rounded-full mt-1">
                <div className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-[#F59E0B]"}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Block title="Checklist" note="Bookings, packing, things to sort before you go.">
        <Panel className="px-4 py-1">
          <div className="divide-y divide-[#18181B]">
            {t.checklist.map((x) => <TaskRow key={x.id} task={x} today={today} onEdit={setTask} hideArea />)}
          </div>
          <div className={`flex items-center gap-3 py-2 ${t.checklist.length ? "border-t border-[#18181B]" : ""}`}>
            <Plus size={15} className="text-[#52525B] shrink-0" />
            <input value={quick} onChange={(e) => setQuick(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
                   placeholder="Book hotel in Taipei, pack bike bag…"
                   className="flex-1 bg-transparent py-1 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none" />
            <button onClick={() => setTask("new")} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">More…</button>
          </div>
        </Panel>
      </Block>

      <Block title="Day by day" note="One line per day — enough to remember the shape of it.">
        <Panel className="px-4 py-1 divide-y divide-[#18181B]">
          {t.days.map((d, i) => <DayLine key={d.date} tripId={id} date={d.date} index={i} initial={d.note} />)}
        </Panel>
      </Block>

      <Block title="Flights" action={
        <Link href="/explore/passenger-flights" className="text-xs text-[#52525B] hover:text-[#A1A1AA]">Log a flight →</Link>
      }>
        {t.flights.length === 0 ? (
          <p className="text-xs text-[#52525B] px-1">
            Flights you log between {format(addDays(parseISO(t.start_date), -1), "d MMM")} and {format(addDays(parseISO(t.end_date), 1), "d MMM")} show up here.
          </p>
        ) : (
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {t.flights.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 w-16 text-xs text-[#71717A] tabular-nums">{format(parseISO(f.date), "EEE d MMM")}</span>
                <span className="flex-1 min-w-0 text-sm text-[#FAFAFA] font-mono">
                  {f.origin ?? "—"} → {f.destination ?? "—"}
                  {f.flight_number && <span className="text-xs text-[#52525B] font-sans ml-2">{f.flight_number}</span>}
                </span>
                {f.dep_time && <span className="text-xs text-[#71717A] tabular-nums">{f.dep_time}{f.arr_time ? `–${f.arr_time}` : ""}</span>}
              </div>
            ))}
          </Panel>
        )}
      </Block>

      {t.notes && (
        <Block title="Notes">
          <Panel className="p-4 text-sm text-[#A1A1AA] whitespace-pre-line">{t.notes}</Panel>
        </Block>
      )}

      {editing && <PlannedTripSheet trip={t} onClose={() => { setEditing(false); qc.invalidateQueries({ queryKey: ["planned-trip", id] }); }} />}
      {task && (
        <TaskSheet task={task === "new" ? undefined : task} defaultTripId={id}
                   onClose={() => { setTask(null); qc.invalidateQueries({ queryKey: ["planned-trip", id] }); }} />
      )}
    </main>
  );
}
