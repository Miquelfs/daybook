"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area,
} from "recharts";
import { format, parseISO, subDays, startOfWeek, addDays } from "date-fns";
import { ArrowRight, ChevronRight } from "lucide-react";
import { activityIcon, fmtDuration, fmtDistance } from "@/lib/api";
import { SPORT_COLORS, sportOf } from "@/lib/sport";
import { GoalRings } from "@/components/training/GoalRings";
import { localISODate } from "@/lib/dates";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── types ────────────────────────────────────────────────────────────────────
type Summary = {
  activity_count: number; total_km: number | null; total_hours: number | null; total_elevation_m: number | null;
  avg_hr: number | null; total_tss: number | null; prev_activity_count: number; prev_total_km: number | null;
  prev_label?: string;
};
type WeeklyRow = { week: string; week_start: string; activity_type: string; count: number; km: number; hours: number };
type SportRow = { sport: string; sport_label: string; count: number; km: number; hours: number };
type Act = {
  id: string; date: string; activity_type: string | null; name: string | null; start_time: string | null;
  duration_seconds: number | null; moving_time_seconds: number | null; distance_meters: number | null;
  elevation_gain_meters: number | null; avg_heart_rate: number | null; avg_speed_mps: number | null;
  training_stress_score: number | null;
};
type LoadRow = { date: string; ctl: number | null; atl: number | null; tsb: number | null; daily_tss: number };
type EffortRef = { activity_id: string; date: string; value: number } | null;
type EffortBest = { kind: "dist" | "power"; key: number; label: string; all_time: EffortRef; this_year: EffortRef; last_90d: EffortRef };
type Curve = { bucket: number; all_time_best: number | null; last_90d_best: number | null }[];
type Rec = { id: string; date: string; name: string | null; distance_meters: number | null; elevation_gain_meters: number | null } | null;
type Week = { week: number; start: string; end: string; phase_label: string; planned_min: number; done_min: number;
              sessions: number; done: number; is_current: boolean; is_past: boolean; recovery: boolean; block?: string | null };
type Overview = {
  goal: { id: number; name: string; race_date: string }; days_until_race: number; current_week: number;
  total_weeks: number; started: boolean; phase_label: string | null; weeks: Week[];
};
type DaySession = { id: number; session_type: string; effective_duration_min: number; intensity_zone: string; status: string };

type Period = { kind: "rolling"; weeks: number } | { kind: "year"; year: number };
const ROLLING = [{ label: "4 weeks", weeks: 4 }, { label: "3 months", weeks: 12 }, { label: "6 months", weeks: 26 }];
const SPORTS = ["ride", "run", "swim", "other"] as const;
const SPORT_LABEL: Record<string, string> = { ride: "Ride", run: "Run", swim: "Swim", other: "Gym & other" };
const TIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" }, itemStyle: { color: "#FAFAFA" },
};

const json = <T,>(url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)) as Promise<T>;
const fmtH = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, "0") : ""}` : `${Math.round(min)}m`);
const shortType = (t: string) => t.replace(/^Cycling - /, "").replace(/^Strength - /, "Gym · ");

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#0D0D0F] border border-[#27272A] rounded-2xl ${className}`}>{children}</div>;
}

// ── Mallorca 312 banner ──────────────────────────────────────────────────────
function RaceBanner({ onOpenRace }: { onOpenRace: () => void }) {
  const today = localISODate();
  const { data: goals } = useQuery<{ id: number; race_type: string }[]>({
    queryKey: ["omyra-goals-active"],
    queryFn: () => json(`${BASE}/race-plans/goals?status=active`),
  });
  const list = Array.isArray(goals) ? goals : [];
  const goal = list.find((g) => g.race_type === "mallorca_312") ?? list[0];
  const { data: ov } = useQuery<Overview>({
    queryKey: ["race-overview", goal?.id],
    queryFn: () => json(`${BASE}/race-plans/goals/${goal!.id}/overview`),
    enabled: !!goal,
  });
  const { data: day } = useQuery<{ sessions: DaySession[] }>({
    queryKey: ["race-today", today],
    queryFn: () => json(`/api/race-plans/day/${today}`),
    enabled: !!goal,
  });
  if (!goal) return null;
  if (!ov?.goal) return <div className="h-44 rounded-2xl bg-[#18181B] animate-pulse mb-8" />;

  const wk = ov.weeks.find((w) => w.is_current);
  const todays = (day?.sessions ?? []).filter((s) => s.status !== "skipped");
  const weekPct = wk && wk.planned_min ? Math.min(100, Math.round((wk.done_min / wk.planned_min) * 100)) : 0;
  const maxMin = Math.max(...ov.weeks.map((w) => w.planned_min), 60);

  return (
    <button onClick={onOpenRace} className="block w-full text-left mb-8 group">
      <Panel className="p-5 overflow-hidden relative transition-colors group-hover:border-[#3F3F46]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">
              {ov.goal.name} · {format(parseISO(ov.goal.race_date), "EEE d MMM yyyy")}
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{ov.days_until_race}</span>
              <span className="text-sm text-[#A1A1AA]">days to go</span>
            </p>
            <p className="text-xs text-[#A1A1AA] mt-1">
              {ov.started ? `Week ${ov.current_week} of ${ov.total_weeks}` : "Plan starts soon"}
              {ov.phase_label ? ` · ${ov.phase_label}` : ""}{wk?.recovery ? " · recovery week" : ""}{wk?.block ? ` · ${wk.block}` : ""}
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-[#F59E0B] mt-1">
            Race plan <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>

        {/* the whole plan, one bar per week — past solid, current amber, future faint */}
        <div className="flex items-end gap-[2px] h-10 mt-4" aria-hidden>
          {ov.weeks.map((w) => (
            <div key={w.week} className="flex-1 rounded-t-sm"
                 style={{
                   height: `${Math.max(8, (w.planned_min / maxMin) * 100)}%`,
                   background: w.is_current ? "#F59E0B" : w.is_past ? "var(--viz-alt)" : "var(--viz-grid)",
                   opacity: w.is_past && w.planned_min && w.done_min / w.planned_min < 0.6 ? 0.5 : 1,
                 }} />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#27272A]">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">This week</p>
            {wk ? (
              <>
                <p className="text-sm tabular-nums"><span className="font-semibold">{fmtH(wk.done_min)}</span>
                  <span className="text-[#71717A]"> / {fmtH(wk.planned_min)} · {wk.done}/{wk.sessions} sessions</span></p>
                <div className="h-1.5 bg-[#18181B] rounded-full overflow-hidden mt-1.5">
                  <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${weekPct}%` }} />
                </div>
              </>
            ) : <p className="text-sm text-[#71717A]">—</p>}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Today</p>
            {todays.length === 0 ? (
              <p className="text-sm text-[#A1A1AA]">Rest day</p>
            ) : todays.slice(0, 2).map((s) => (
              <p key={s.id} className="text-sm truncate">
                {s.status === "completed" ? "✓ " : ""}<span className="font-semibold">{shortType(s.session_type)}</span>
                <span className="text-[#71717A]"> · {fmtH(s.effective_duration_min)} {s.intensity_zone}</span>
              </p>
            ))}
          </div>
        </div>
      </Panel>
    </button>
  );
}

// ── form now ─────────────────────────────────────────────────────────────────
function FormCard() {
  const { data } = useQuery<LoadRow[]>({ queryKey: ["training-load-42"], queryFn: () => json(`${BASE}/training/load?range=42`) });
  const rows = (Array.isArray(data) ? data : []).filter((r) => r.ctl != null);
  if (rows.length < 7) return null;
  const last = rows[rows.length - 1];
  const weekAgo = rows[Math.max(0, rows.length - 8)];
  const form = (last.ctl ?? 0) - (last.atl ?? 0);
  const label = form > 5 ? "Fresh — ready for a big day" : form > -10 ? "Neutral — training normally"
    : form > -30 ? "Productive fatigue — the work is landing" : "Deep fatigue — plan easy days";
  const dFit = (last.ctl ?? 0) - (weekAgo.ctl ?? 0);
  return (
    <Section title="Form now">
      <Panel className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Fitness</p>
            <p className="text-2xl font-semibold tabular-nums">{Math.round(last.ctl ?? 0)}</p>
            <p className="text-xs text-[#71717A] tabular-nums">{dFit >= 0 ? "+" : ""}{dFit.toFixed(1)} this week</p>
          </div>
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Fatigue</p>
            <p className="text-2xl font-semibold tabular-nums">{Math.round(last.atl ?? 0)}</p>
            <p className="text-xs text-[#71717A]">7-day load</p>
          </div>
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Form</p>
            <p className={`text-2xl font-semibold tabular-nums ${form > 5 ? "text-emerald-400" : form < -30 ? "text-rose-400" : form < -10 ? "text-amber-400" : ""}`}>
              {form > 0 ? "+" : ""}{Math.round(form)}
            </p>
            <p className="text-xs text-[#71717A]">fitness − fatigue</p>
          </div>
        </div>
        <p className="text-sm text-[#A1A1AA] mt-3">{label}</p>
        <div className="mt-3 -mx-1">
          <ResponsiveContainer width="100%" height={70}>
            <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <Tooltip {...TIP} formatter={(v) => [Math.round(Number(v)), "Fitness"]}
                       labelFormatter={(d) => format(parseISO(String(d)), "d MMM")} />
              <Area type="monotone" dataKey="ctl" stroke="var(--viz-spd)" fill="var(--viz-spd)" fillOpacity={0.12}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-[#52525B] px-1">Fitness, last 6 weeks</p>
        </div>
      </Panel>
    </Section>
  );
}

// ── this week ────────────────────────────────────────────────────────────────
function ThisWeek() {
  const mon = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const start = localISODate(days[0]), end = localISODate(days[6]), today = localISODate();
  const { data } = useQuery<Act[]>({
    queryKey: ["training-activities", start, end, null],
    queryFn: () => json(`${BASE}/training/activities?start=${start}&end=${end}&limit=50`),
  });
  const acts = Array.isArray(data) ? data : [];
  const totalMin = acts.reduce((a, x) => a + (x.moving_time_seconds ?? x.duration_seconds ?? 0) / 60, 0);
  return (
    <Section title="This week" action={<span className="text-xs text-[#71717A] tabular-nums">{fmtH(totalMin)} · {acts.length} sessions</span>}>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const iso = localISODate(d);
          const mine = acts.filter((a) => a.date === iso);
          const mins = mine.reduce((a, x) => a + (x.moving_time_seconds ?? x.duration_seconds ?? 0) / 60, 0);
          const isToday = iso === today, future = iso > today;
          return (
            <Link key={iso} href={`/day/${iso}`}
                  className={`rounded-xl border px-1 py-2 flex flex-col items-center gap-1 min-h-[86px] transition-colors ${
                    isToday ? "border-[#F59E0B]/60 bg-[#F59E0B]/10" : "border-[#27272A] bg-[#0D0D0F] hover:border-[#3F3F46]"
                  } ${future ? "opacity-60" : ""}`}>
              <span className="text-[10px] text-[#71717A] uppercase">{format(d, "EEEEE")}</span>
              <span className={`text-sm font-semibold tabular-nums ${isToday ? "text-[#F59E0B]" : ""}`}>{format(d, "d")}</span>
              <span className="flex flex-wrap justify-center gap-0.5 text-sm leading-none">
                {mine.slice(0, 3).map((a) => <span key={a.id}>{activityIcon(a.activity_type)}</span>)}
              </span>
              {mins > 0 && <span className="text-[10px] text-[#A1A1AA] tabular-nums">{fmtH(mins)}</span>}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ── activity row ─────────────────────────────────────────────────────────────
function paceOf(a: Act): string | null {
  if (!a.avg_speed_mps) return null;
  const s = sportOf(a.activity_type);
  if (s === "run" || /walk|hik/i.test(a.activity_type ?? "")) {
    const spk = 1000 / a.avg_speed_mps;
    return `${Math.floor(spk / 60)}:${String(Math.round(spk % 60)).padStart(2, "0")} /km`;
  }
  return `${(a.avg_speed_mps * 3.6).toFixed(1)} km/h`;
}

function ActivityRow({ a }: { a: Act }) {
  const color = SPORT_COLORS[sportOf(a.activity_type)];
  const pace = paceOf(a);
  return (
    <Link href={`/activity/${encodeURIComponent(a.id)}`}
          className="flex items-center gap-3 px-3 py-3 hover:bg-[#18181B] transition-colors">
      <span className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
            style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
        {activityIcon(a.activity_type)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{a.name ?? a.activity_type ?? "Activity"}</p>
        <p className="text-xs text-[#71717A] tabular-nums truncate">
          {format(parseISO(a.date), "EEE d MMM")}
          {a.distance_meters ? ` · ${fmtDistance(a.distance_meters)}` : ""}
          {` · ${fmtDuration(a.moving_time_seconds ?? a.duration_seconds)}`}
          {pace ? ` · ${pace}` : ""}
          {a.elevation_gain_meters && a.elevation_gain_meters > 50 ? ` · ↑${Math.round(a.elevation_gain_meters)} m` : ""}
        </p>
      </div>
      {a.training_stress_score ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#18181B] text-[#A1A1AA] tabular-nums shrink-0">
          {Math.round(a.training_stress_score)} TSS
        </span>
      ) : null}
      <ChevronRight size={14} className="text-[#3F3F46] shrink-0" />
    </Link>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
export function TrainingOverview({ onOpenRace }: { onOpenRace: () => void }) {
  const [period, setPeriod] = useState<Period>({ kind: "rolling", weeks: 12 });
  const [filter, setFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const thisYear = new Date().getFullYear();
  const { data: yearsRaw } = useQuery<number[]>({ queryKey: ["training-years"], queryFn: () => json(`${BASE}/training/years`) });
  const years = (Array.isArray(yearsRaw) ? yearsRaw : []).filter((y) => y < thisYear).slice(0, 6);

  const isYear = period.kind === "year";
  const start = isYear ? `${period.year}-01-01` : format(subDays(new Date(), period.weeks * 7), "yyyy-MM-dd");
  const end = isYear && period.year < thisYear ? `${period.year}-12-31` : format(new Date(), "yyyy-MM-dd");
  const summaryUrl = isYear ? `${BASE}/training/summary?start=${start}&end=${end}` : `${BASE}/training/summary?days=${period.weeks * 7}`;

  const { data: summary } = useQuery<Summary>({ queryKey: ["training-summary", start, end], queryFn: () => json(summaryUrl) });
  const { data: weeklyRaw } = useQuery<WeeklyRow[]>({ queryKey: ["training-weekly", start, end], queryFn: () => json(`${BASE}/training/weekly?start=${start}&end=${end}`) });
  const { data: sportsRaw } = useQuery<SportRow[]>({ queryKey: ["training-sports", start, end], queryFn: () => json(`${BASE}/training/sport-breakdown?start=${start}&end=${end}`) });
  const { data: actsRaw } = useQuery<Act[]>({
    queryKey: ["training-activities", start, end, filter],
    queryFn: () => json(`${BASE}/training/activities?${new URLSearchParams({ start, end, limit: "100", ...(filter ? { sport: filter } : {}) })}`),
  });
  const { data: records } = useQuery<{ longest_ride: Rec; longest_run: Rec; highest_elevation_ride: Rec }>({ queryKey: ["training-records"], queryFn: () => json(`${BASE}/training/records`) });
  const { data: runCurve } = useQuery<Curve>({ queryKey: ["training-curve-run"], queryFn: () => json(`${BASE}/training/curve?sport=run&channel=pace`) });
  const { data: runEfforts } = useQuery<EffortBest[]>({ queryKey: ["training-efforts", "run"], queryFn: () => json(`${BASE}/training/efforts?sport=run`) });
  const { data: rideEfforts } = useQuery<EffortBest[]>({ queryKey: ["training-efforts", "ride"], queryFn: () => json(`${BASE}/training/efforts?sport=ride`) });
  const { data: bikeCurve } = useQuery<Curve>({ queryKey: ["training-curve-bike"], queryFn: () => json(`${BASE}/training/curve?sport=ride&channel=pace`) });

  const weekly = Array.isArray(weeklyRaw) ? weeklyRaw : [];
  const sports = Array.isArray(sportsRaw) ? sportsRaw : [];
  const acts = Array.isArray(actsRaw) ? actsRaw : [];

  // hours per week, stacked by sport family
  type WeekAgg = { week_start: string; ride: number; run: number; swim: number; other: number };
  const byWeek = new Map<string, WeekAgg>();
  for (const r of weekly) {
    const row = byWeek.get(r.week) ?? { week_start: r.week_start, ride: 0, run: 0, swim: 0, other: 0 };
    row[sportOf(r.activity_type)] += r.hours;
    byWeek.set(r.week, row);
  }
  let weeklyAgg = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  const monthly = isYear || weeklyAgg.length > 30;
  if (monthly) {
    const byMonth = new Map<string, WeekAgg>();
    for (const w of weeklyAgg) {
      const m = w.week_start.slice(0, 7) + "-01";
      const row = byMonth.get(m) ?? { week_start: m, ride: 0, run: 0, swim: 0, other: 0 };
      for (const k of SPORTS) row[k] += w[k];
      byMonth.set(m, row);
    }
    weeklyAgg = [...byMonth.values()].sort((a, b) => a.week_start.localeCompare(b.week_start));
  }
  const present = SPORTS.filter((s) => weeklyAgg.some((w) => w[s] > 0));

  // sport mix (by time)
  const mix = SPORTS.map((s) => ({ s, hours: sports.filter((x) => sportOf(x.sport) === s).reduce((a, x) => a + x.hours, 0),
                                    km: sports.filter((x) => sportOf(x.sport) === s).reduce((a, x) => a + x.km, 0),
                                    n: sports.filter((x) => sportOf(x.sport) === s).reduce((a, x) => a + x.count, 0) }))
    .filter((m) => m.hours > 0);
  const totalH = mix.reduce((a, m) => a + m.hours, 0);

  const kmDelta = summary?.prev_total_km ? (summary.total_km ?? 0) - summary.prev_total_km : null;
  const nDelta = summary ? summary.activity_count - summary.prev_activity_count : null;

  return (
    <>
      <RaceBanner onOpenRace={onOpenRace} />
      <FormCard />
      <ThisWeek />

      <Section title={isYear ? `Activities · ${period.year}` : "Recent"} action={
        <div className="flex gap-1">
          {[null, "cycling", "running", "swimming"].map((s) => (
            <button key={s ?? "all"} onClick={() => setFilter(s)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${filter === s ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {s ? activityIcon(s) : "All"}
            </button>
          ))}
        </div>}>
        <Panel className="overflow-hidden divide-y divide-[#18181B]">
          {acts.slice(0, showAll ? 100 : 6).map((a) => <ActivityRow key={a.id} a={a} />)}
          {acts.length === 0 && <p className="text-sm text-[#71717A] px-4 py-4">No activities in this period.</p>}
          {acts.length > 6 && (
            <button onClick={() => setShowAll(!showAll)} className="w-full text-xs text-[#71717A] hover:text-[#F59E0B] py-2.5">
              {showAll ? "Show less" : `Show all ${acts.length}`}
            </button>
          )}
        </Panel>
      </Section>

      <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[...ROLLING.map((r) => ({ key: `r${r.weeks}`, label: r.label, p: { kind: "rolling", weeks: r.weeks } as Period })),
          { key: `y${thisYear}`, label: "This year", p: { kind: "year", year: thisYear } as Period },
          ...years.map((y) => ({ key: `y${y}`, label: String(y), p: { kind: "year", year: y } as Period }))].map(({ key, label, p }) => {
          const active = p.kind === period.kind && (p.kind === "year" ? p.year === (period as { year: number }).year : p.weeks === (period as { weeks: number }).weeks);
          return (
            <button key={key} onClick={() => setPeriod(p)}
                    className={`shrink-0 px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${active ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {label}
            </button>
          );
        })}
      </div>

      <Panel className="p-4 mb-8">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Time", value: summary?.total_hours != null ? `${summary.total_hours}h` : "—" },
            { label: "Distance", value: summary?.total_km != null ? `${Math.round(summary.total_km)} km` : "—",
              sub: kmDelta != null ? `${kmDelta >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(kmDelta))} km vs ${summary?.prev_label === "same dates last year" ? "last year" : "prev"}` : null },
            { label: "Climbing", value: summary?.total_elevation_m ? `${summary.total_elevation_m.toLocaleString()} m` : "—" },
          ].map((k) => (
            <div key={k.label}>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{k.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{k.value}</p>
              {k.sub && <p className="text-xs text-[#71717A] tabular-nums">{k.sub}</p>}
            </div>
          ))}
        </div>
        <p className="text-xs text-[#71717A] mt-3 tabular-nums">
          {summary?.activity_count ?? "—"} sessions{nDelta != null ? ` (${nDelta >= 0 ? "+" : ""}${nDelta} vs prev)` : ""}
          {summary?.avg_hr ? ` · avg HR ${summary.avg_hr} bpm` : ""}
          {summary?.total_tss ? ` · ${summary.total_tss} TSS` : ""}
        </p>
      </Panel>

      <Section title={monthly ? "Monthly hours" : "Weekly hours"}>
        <Panel className="p-4">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={weeklyAgg} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="var(--viz-grid)" vertical={false} strokeDasharray="2 4" />
              <XAxis dataKey="week_start" tickFormatter={(d) => format(parseISO(d), monthly ? "MMM" : "d MMM")} tick={{ fill: "var(--viz-axis)", fontSize: 11 }}
                     tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fill: "var(--viz-axis)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TIP} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
                       formatter={(v, n) => [`${Number(v).toFixed(1)} h`, SPORT_LABEL[String(n)] ?? n]}
                       labelFormatter={(d) => monthly ? format(parseISO(String(d)), "MMMM yyyy") : `Week of ${format(parseISO(String(d)), "d MMM")}`} />
              {present.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="h" fill={SPORT_COLORS[s]} maxBarSize={monthly ? 34 : 26} isAnimationActive={false}
                     radius={i === present.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} stroke="var(--viz-gap)" strokeWidth={1} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          {present.length > 1 && (
            <div className="flex gap-3 text-xs text-[#71717A] mt-2">
              {present.map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SPORT_COLORS[s] }} />{SPORT_LABEL[s]}</span>
              ))}
            </div>
          )}
        </Panel>
      </Section>

      {mix.length > 0 && (
        <Section title="Sport mix">
          <Panel className="p-4">
            <div className="flex h-3 rounded-full overflow-hidden gap-[2px] mb-4">
              {mix.map((m) => <div key={m.s} style={{ flexGrow: m.hours, flexBasis: 0, background: SPORT_COLORS[m.s] }} />)}
            </div>
            <div className="space-y-2">
              {mix.map((m) => (
                <div key={m.s} className="flex items-center gap-3 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SPORT_COLORS[m.s] }} />
                  <span className="text-[#A1A1AA] w-14">{SPORT_LABEL[m.s]}</span>
                  <span className="text-[#FAFAFA] tabular-nums w-14">{m.hours.toFixed(1)} h</span>
                  <span className="text-[#71717A] tabular-nums flex-1">{m.km ? `${Math.round(m.km)} km · ` : ""}{m.n} sessions</span>
                  <span className="text-[#A1A1AA] tabular-nums">{Math.round((m.hours / totalH) * 100)}%</span>
                </div>
              ))}
            </div>
          </Panel>
        </Section>
      )}

      <section className="mb-8"><GoalRings /></section>

      <Section title="Best efforts">
        {(Array.isArray(rideEfforts) && rideEfforts.length > 0) || (Array.isArray(runEfforts) && runEfforts.length > 0) ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {Array.isArray(rideEfforts) && rideEfforts.length > 0 && <EffortTable title="Cycling" sport="ride" rows={rideEfforts} />}
            {Array.isArray(runEfforts) && runEfforts.length > 0 && <EffortTable title="Running" sport="run" rows={runEfforts} />}
          </div>
        ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <BestTable title="Cycling" curve={bikeCurve} rows={[[10000, "10K"], [20000, "20K"], [40000, "40K"], [50000, "50K"], [100000, "100K"], [160000, "100 mi"], [200000, "200K"]]}
                     fmt={(s) => `${(3600 / s).toFixed(1)} km/h`} />
          <BestTable title="Running" curve={runCurve} rows={[[1000, "1K"], [5000, "5K"], [10000, "10K"], [21097, "Half"], [42195, "Marathon"]]}
                     fmt={(s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} /km`} />
        </div>
        )}
      </Section>

      <Section title="Records">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Longest ride", r: records?.longest_ride, v: (r: NonNullable<Rec>) => `${Math.round((r.distance_meters ?? 0) / 1000)} km` },
            { label: "Most climbing", r: records?.highest_elevation_ride, v: (r: NonNullable<Rec>) => `${Math.round(r.elevation_gain_meters ?? 0).toLocaleString()} m` },
            { label: "Longest run", r: records?.longest_run, v: (r: NonNullable<Rec>) => `${((r.distance_meters ?? 0) / 1000).toFixed(1)} km` },
          ].map(({ label, r, v }) => (
            r ? (
              <Link key={label} href={`/activity/${encodeURIComponent(r.id)}`} className="block">
                <Panel className="p-3 h-full hover:border-[#3F3F46] transition-colors">
                  <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
                  <p className="text-lg font-semibold tabular-nums">{v(r)}</p>
                  <p className="text-[10px] text-[#71717A] truncate">{format(parseISO(r.date), "d MMM yyyy")}</p>
                </Panel>
              </Link>
            ) : (
              <Panel key={label} className="p-3"><p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p><p className="text-lg">—</p></Panel>
            )
          ))}
        </div>
      </Section>
    </>
  );
}

function BestTable({ title, curve, rows, fmt }: { title: string; curve: Curve | undefined; rows: [number, string][]; fmt: (s: number) => string }) {
  const map = Object.fromEntries((Array.isArray(curve) ? curve : []).map((c) => [c.bucket, c]));
  const shown = rows.filter(([m]) => map[m]?.all_time_best);
  return (
    <Panel className="overflow-hidden">
      <p className="text-xs text-[#A1A1AA] px-4 pt-3 pb-2">{title}</p>
      {shown.length === 0 && <p className="text-xs text-[#52525B] px-4 pb-3">No data yet.</p>}
      {shown.map(([m, label]) => {
        const b = map[m];
        const recent = b.last_90d_best && b.all_time_best && b.last_90d_best <= b.all_time_best * 1.0001;
        return (
          <div key={m} className="flex items-center justify-between px-4 py-2 border-t border-[#18181B] text-xs">
            <span className="text-[#A1A1AA] w-16">{label}</span>
            <span className="tabular-nums text-[#FAFAFA]">{fmt(b.all_time_best!)}{recent && <span className="text-amber-400"> · PR in 90d</span>}</span>
            <span className="tabular-nums text-[#71717A] text-right w-24">{b.last_90d_best && !recent ? `90d ${fmt(b.last_90d_best)}` : ""}</span>
          </div>
        );
      })}
    </Panel>
  );
}

function clockS(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function EffortTable({ title, sport, rows }: { title: string; sport: "run" | "ride"; rows: EffortBest[] }) {
  const fmt = (r: EffortBest, v: number) =>
    r.kind === "power" ? `${Math.round(v)} W` : clockS(v);
  const sub = (r: EffortBest, v: number) =>
    r.kind === "power" ? "" : sport === "run" ? `${clockS(v / (r.key / 1000))} /km` : `${(r.key / 1000 / (v / 3600)).toFixed(1)} km/h`;
  const dist = rows.filter((r) => r.kind === "dist"), power = rows.filter((r) => r.kind === "power");
  const Line = ({ r }: { r: EffortBest }) => (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 px-4 py-2 border-t border-[#18181B] text-xs">
      <span className="text-[#A1A1AA]">{r.label}</span>
      {r.all_time ? (
        <Link href={`/activity/${encodeURIComponent(r.all_time.activity_id)}`} className="min-w-0 hover:text-[#F59E0B]">
          <span className="tabular-nums text-[#FAFAFA] font-semibold">{fmt(r, r.all_time.value)}</span>
          <span className="text-[#71717A] tabular-nums"> {sub(r, r.all_time.value)}</span>
          <span className="block text-[10px] text-[#52525B]">{r.all_time.date}</span>
        </Link>
      ) : <span>—</span>}
      <span className="text-right text-[10px] text-[#71717A] tabular-nums leading-tight">
        {r.this_year && r.this_year.activity_id !== r.all_time?.activity_id ? <>this year {fmt(r, r.this_year.value)}</> : r.this_year ? <span className="text-amber-400">PR this year</span> : null}
        {r.last_90d && r.last_90d.activity_id !== r.this_year?.activity_id && <><br />90d {fmt(r, r.last_90d.value)}</>}
      </span>
    </div>
  );
  return (
    <Panel className="overflow-hidden">
      <p className="text-xs text-[#A1A1AA] px-4 pt-3 pb-2">{title}</p>
      {dist.map((r) => <Line key={`d${r.key}`} r={r} />)}
      {power.length > 0 && <p className="px-4 pt-3 pb-1 text-[10px] text-[#52525B] uppercase tracking-widest border-t border-[#27272A]">Power</p>}
      {power.map((r) => <Line key={`p${r.key}`} r={r} />)}
    </Panel>
  );
}
