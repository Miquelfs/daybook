"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Activity, Plane, MapPin, Clock, Scale, CalendarRange, TrendingDown, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area,
} from "recharts";
import {
  wellnessApi, type StressContexts, type FlightPhysioRollup, type StressPlaces, type StressInsights, type DayCard,
} from "@/lib/wellness-api";

const CTX_EMOJI: Record<string, string> = {
  "in-flight": "✈️", exercise: "🏃", airport: "🛫", home: "🏠", elsewhere: "📍",
};
const CTX_LABEL: Record<string, string> = {
  "in-flight": "In flight", exercise: "Exercise", airport: "Airport", home: "Home", elsewhere: "Elsewhere",
};

// Stress reads 0-100; colour the bar by intensity.
// Theme-aware (globals.css) — the dark-mode yellows and greens wash out on paper.
function stressColor(v: number): string {
  if (v >= 40) return "var(--viz-stress)";
  if (v >= 25) return "var(--viz-mid)";
  return "var(--viz-calm)";
}
function deltaColor(v: number): string {
  if (v >= 15) return "var(--viz-hot)";
  if (v <= -5) return "var(--viz-calm)";
  return "var(--viz-ref)";
}

const fmtDur = (min: number) => (min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`);

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-[#E4E4E7]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function WhatStressesYou() {
  const { data } = useQuery<StressContexts>({
    queryKey: ["stress-contexts", 90],
    queryFn: () => wellnessApi.stressContexts(90),
    staleTime: 300_000,
  });
  // Exercise isn't life stress — the watch reads effort as stress, so it would always
  // top the list. Shown apart, as a footnote.
  const all = data?.contexts ?? [];
  const rows = all.filter((r) => r.context !== "exercise");
  const exercise = all.find((r) => r.context === "exercise");
  const max = Math.max(60, ...rows.map((r) => r.avg_stress));

  return (
    <Card title="What stresses you" icon={<Activity size={15} style={{ color: "var(--viz-stress)" }} />}>
      <p className="text-[11px] text-[#52525B] mb-3">Average stress by where you were · last 90 days</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No context data yet — it fills in as the CIRQA syncs.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.context}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#D4D4D8]">{CTX_EMOJI[r.context] ?? "•"} {CTX_LABEL[r.context] ?? r.context}</span>
                <span className="tabular-nums text-[#71717A]">
                  <span className="font-semibold text-[#E4E4E7]">{r.avg_stress}</span> · {fmtDur(r.minutes)} · {r.days}d
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.avg_stress / max) * 100}%`, background: stressColor(r.avg_stress) }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {exercise && (
        <p className="text-[11px] text-[#52525B] mt-3">
          🏃 Exercise ({fmtDur(exercise.minutes)}) is left out — the watch reads effort as stress.
        </p>
      )}
    </Card>
  );
}

function StressfulPlaces() {
  const { data } = useQuery<StressPlaces>({
    queryKey: ["stress-places", 180],
    queryFn: () => wellnessApi.stressPlaces(180),
    staleTime: 300_000,
  });
  const rows = data?.places ?? [];
  const max = Math.max(8, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <Card title="Stressful places" icon={<MapPin size={15} style={{ color: "var(--viz-stress)" }} />}>
      <p className="text-[11px] text-[#52525B] mb-3">
        Stress vs your baseline{data?.baseline != null ? ` (${data.baseline})` : ""}, by place · last 180 days · home excluded
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No away-from-home place data yet — builds from your GPS visits as the CIRQA syncs.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, 12).map((r) => (
            <div key={r.place_id}>
              <div className="flex items-center justify-between text-xs mb-1 gap-2">
                <span className="text-[#D4D4D8] truncate">
                  📍 {r.name}
                  {r.city && r.city !== r.name && <span className="text-[#52525B]"> · {r.city}</span>}
                </span>
                <span className="tabular-nums text-[#71717A] shrink-0">
                  <span className="font-semibold" style={{ color: deltaColor(r.delta) }}>
                    {r.delta > 0 ? "+" : ""}{r.delta}
                  </span> · {fmtDur(r.minutes)} · {r.days}d
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.delta) / max) * 100}%`, background: deltaColor(r.delta) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const BY_OPTIONS: { key: "airport" | "phase" | "captain"; label: string }[] = [
  { key: "airport", label: "Airport" },
  { key: "phase", label: "Phase" },
  { key: "captain", label: "Captain" },
];

export function FlightLoadRollup() {
  const [by, setBy] = useState<"airport" | "phase" | "captain">("airport");
  const { data } = useQuery<FlightPhysioRollup>({
    queryKey: ["flight-physio-rollup", by],
    queryFn: () => wellnessApi.flightPhysioRollup(by),
    staleTime: 300_000,
  });
  const rows = data?.buckets ?? [];
  const max = Math.max(20, ...rows.map((r) => Math.abs(r.avg_stress_delta)));

  return (
    <Card title="Flight load" icon={<Plane size={15} style={{ color: "var(--viz-spd)" }} />}>
      <div className="flex gap-1 mb-3">
        {BY_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setBy(o.key)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              by === o.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[#52525B] mb-3">
        {by === "airport" ? "Approach stress spike by arrival airport"
          : by === "phase" ? "Takeoff vs landing, on average"
          : "Your landing stress spike by pilot flying"} · Δ vs day baseline
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No flight physio yet — snapshots build as you fly with the CIRQA.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#D4D4D8] font-medium">{r.key}</span>
                <span className="tabular-nums" style={{ color: deltaColor(r.avg_stress_delta) }}>
                  {r.avg_stress_delta >= 0 ? "+" : ""}{r.avg_stress_delta}
                  <span className="text-[#52525B] ml-1.5">· {r.n}×</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.avg_stress_delta) / max) * 100}%`, background: deltaColor(r.avg_stress_delta) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Built from everything logged: trend, rhythm by kind of day, drivers, extreme days ──

const KIND_COLOR: Record<string, string> = { flying: "var(--viz-stress)", standby: "var(--viz-mid)", off: "var(--viz-calm)" };
const TIP = { background: "#111113", border: "1px solid #27272A", borderRadius: 8, fontSize: 11 };   // light: globals.css
const PERIODS = [30, 90, 180] as const;
const hours = (min: number | null) => (min == null ? "—" : `${(min / 60).toFixed(1)}h`);

function Overview({ d }: { d: StressInsights }) {
  const o = d.overview;
  const diff = o.avg != null && o.prev_avg != null ? o.avg - o.prev_avg : null;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">Average stress · last {d.days} days</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums" style={{ color: o.avg != null ? stressColor(o.avg) : undefined }}>
              {o.avg ?? "—"}
            </span>
            {diff != null && (
              <span className="inline-flex items-center gap-1 text-xs"
                    style={{ color: diff > 1 ? "var(--viz-stress)" : diff < -1 ? "var(--viz-calm)" : "var(--viz-ref)" }}>
                {diff > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {diff > 0 ? "+" : ""}{diff} vs the {d.days} days before
              </span>
            )}
          </p>
        </div>
        <div className="text-right text-xs text-[#71717A] space-y-1 shrink-0">
          <p><span className="text-[#E4E4E7] font-medium tabular-nums">{hours(o.rest_min_per_day)}</span> at rest / day</p>
          <p><span className="text-[#E4E4E7] font-medium tabular-nums">{hours(o.stressed_min_per_day)}</span> stressed / day</p>
        </div>
      </div>
      {o.series.length > 3 && (
        <div className="h-16 mt-3 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={o.series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="stressFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--viz-stress)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--viz-stress)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, "dataMax + 5"]} />
              <XAxis dataKey="date" hide />
              <Tooltip
                contentStyle={TIP}
                labelFormatter={(l) => format(parseISO(String(l)), "EEE d MMM")}
                formatter={(v) => [v, "Stress"]}
              />
              <Area dataKey="v" stroke="var(--viz-stress)" strokeWidth={1.5} fill="url(#stressFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function Rhythm({ d }: { d: StressInsights }) {
  const kinds = d.rhythm.kinds;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const rows = Array.from({ length: 24 }, (_, h) => ({
    h, ...Object.fromEntries(kinds.map((k) => [k.key, k.hours[h]])),
  }));
  return (
    <Card title="Your stress through the day" icon={<Clock size={15} style={{ color: "var(--viz-stress)" }} />}>
      <p className="text-[11px] text-[#52525B] mb-3">Average by hour, by kind of day · workouts left out · last {d.days} days</p>
      {kinds.length === 0 ? (
        <p className="text-xs text-[#52525B]">Not enough days yet.</p>
      ) : (
        <>
          <div className="h-44 -ml-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="h" ticks={[0, 3, 6, 9, 12, 15, 18, 21]} tickFormatter={(h) => `${String(h).padStart(2, "0")}h`}
                       tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, "dataMax + 5"]} tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={TIP}
                  labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(Number(h) + 1).padStart(2, "0")}:00`}
                />
                {kinds.filter((k) => !hidden.has(k.key)).map((k) => (
                  <Line key={k.key} dataKey={k.key} name={k.label} stroke={KIND_COLOR[k.key]} strokeWidth={1.8}
                        dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {kinds.map((k) => (
              <button key={k.key} onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(k.key)) n.delete(k.key); else n.add(k.key); return n; })}
                      className={`w-full flex items-center gap-2 text-xs text-left transition-opacity ${hidden.has(k.key) ? "opacity-35" : ""}`}>
                <span className="w-3 h-[2px] rounded-full" style={{ background: KIND_COLOR[k.key] }} />
                <span className="text-[#D4D4D8]">{k.label}</span>
                <span className="text-[#52525B]">· {k.days}d</span>
                <span className="ml-auto tabular-nums text-[#71717A]">
                  awake avg <span className="text-[#E4E4E7] font-medium">{k.awake_avg ?? "—"}</span> · peaks {String(k.peak_hour).padStart(2, "0")}:00
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Drivers({ d }: { d: StressInsights }) {
  const dr = d.drivers;
  const max = Math.max(4, ...dr.groups.flatMap((g) => g.rows.map((r) => Math.abs(r.delta))));
  return (
    <Card title="What moves your daily stress" icon={<Scale size={15} style={{ color: "var(--viz-stress)" }} />}>
      <p className="text-[11px] text-[#52525B] mb-3">
        Day average vs yours{dr.baseline != null ? ` (${Math.round(dr.baseline)})` : ""} · {dr.days ?? 0} days · at least 3 days per row
      </p>
      {dr.groups.length === 0 ? (
        <p className="text-xs text-[#52525B]">Not enough days yet.</p>
      ) : (
        <div className="space-y-4">
          {dr.groups.map((g) => (
            <div key={g.key}>
              <p className="text-[10px] uppercase tracking-widest text-[#52525B] mb-1.5">{g.label}</p>
              <div className="space-y-1.5">
                {g.rows.map((r) => {
                  const w = (Math.abs(r.delta) / max) * 50;
                  const color = r.delta > 1 ? "var(--viz-stress)" : r.delta < -1 ? "var(--viz-calm)" : "var(--viz-ref)";
                  return (
                    <div key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-2 text-xs">
                      <span className="text-[#D4D4D8] truncate">{r.icon ? `${r.icon} ` : ""}{r.label}</span>
                      <div className="relative h-2">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-[#3F3F46]" />
                        <div className="absolute inset-y-0 rounded-full"
                             style={{ background: color, width: `${w}%`, left: r.delta >= 0 ? "50%" : `${50 - w}%` }} />
                      </div>
                      <span className="text-right tabular-nums">
                        <span className="font-semibold" style={{ color }}>{r.delta > 0 ? "+" : ""}{r.delta}</span>
                        <span className="text-[#52525B]"> · {r.days}d</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DayList({ title, days }: { title: string; days: DayCard[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-[#52525B] mb-2">{title}</p>
      <div className="space-y-1.5">
        {days.map((x) => (
          <Link key={x.date} href={`/day/${x.date}`}
                className="block rounded-lg border border-[#27272A] bg-[#131316] px-3 py-2 hover:border-[#3F3F46] transition-colors">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-[#E4E4E7]">{format(parseISO(x.date), "EEE d MMM")}</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: stressColor(x.avg) }}>{x.avg}</span>
            </div>
            {(x.context.length > 0 || x.tags.length > 0) && (
              <p className="text-[10px] text-[#71717A] truncate mt-0.5">{[...x.context, ...x.tags].join(" · ")}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Extremes({ d }: { d: StressInsights }) {
  if (d.extremes.high.length === 0) return null;
  return (
    <Card title="Your hottest and calmest days" icon={<CalendarRange size={15} style={{ color: "var(--viz-stress)" }} />}>
      <div className="grid grid-cols-2 gap-3">
        <DayList title="Most stressful" days={d.extremes.high} />
        <DayList title="Calmest" days={d.extremes.low} />
      </div>
    </Card>
  );
}

// Life-wide stress insights for the Correlations page: the trend, your stress
// through the day by kind of day, what moves it (duty, sleep, training, tags),
// extreme days, where you were, and the flight-physio rollups.
export function StressLifeInsights() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const { data } = useQuery<StressInsights>({
    queryKey: ["stress-insights", days],
    queryFn: () => wellnessApi.stressInsights(days),
    staleTime: 300_000,
  });
  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-1">
        {PERIODS.map((p) => (
          <button key={p} onClick={() => setDays(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs tabular-nums transition-colors ${
                    p === days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
            {p}d
          </button>
        ))}
      </div>
      {data ? (
        <>
          <Overview d={data} />
          <Rhythm d={data} />
          <Drivers d={data} />
          <Extremes d={data} />
        </>
      ) : (
        <div className="h-40 animate-pulse bg-[#18181B] rounded-xl" />
      )}
      <WhatStressesYou />
      <StressfulPlaces />
      <FlightLoadRollup />
    </div>
  );
}
