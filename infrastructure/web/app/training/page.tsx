"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { activityIcon, fmtDuration, fmtDistance } from "@/lib/api";
import { injuriesApi, type Injury, ZONE_LABELS } from "@/lib/injuries-api";
import { Activity, Zap, List, TrendingUp, Target, Map } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type TrainingSummary = {
  activity_count: number;
  total_km: number | null;
  total_hours: number | null;
  total_elevation_m: number | null;
  avg_hr: number | null;
  total_tss: number | null;
  prev_activity_count: number;
  prev_total_km: number | null;
  period_days: number;
};

type WeeklyRow = {
  week: string;
  week_start: string;
  activity_type: string;
  count: number;
  km: number;
  hours: number;
  elevation_m: number;
  tss: number;
};

type SportRow = {
  sport: string;
  sport_label: string;
  count: number;
  km: number;
  hours: number;
  elevation_m: number;
  avg_hr: number | null;
};

type Activity = {
  id: string;
  date: string;
  activity_type: string | null;
  name: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  moving_time_seconds: number | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_speed_mps: number | null;
  avg_power_watts: number | null;
  calories: number | null;
  training_stress_score: number | null;
  has_polyline: number;
};

const PERIODS = [
  { label: "4W", weeks: 4 },
  { label: "3M", weeks: 12 },
  { label: "6M", weeks: 24 },
];

const SPORT_COLORS: Record<string, string> = {
  running: "#F59E0B",
  trail_running: "#F59E0B",
  treadmill_running: "#F59E0B",
  cycling: "#3B82F6",
  road_biking: "#3B82F6",
  indoor_cycling: "#60A5FA",
  lap_swimming: "#06B6D4",
  open_water_swimming: "#0891B2",
  swimming: "#06B6D4",
  walking: "#22C55E",
  hiking: "#84CC16",
  strength_training: "#A855F7",
  tennis_v2: "#F97316",
  tennis: "#F97316",
  paddelball: "#FB923C",
  other: "#71717A",
};

function sportColor(sport: string) {
  return SPORT_COLORS[sport.toLowerCase()] ?? SPORT_COLORS.other;
}

function KpiCard({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: number | null }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={`text-xs mt-0.5 ${delta >= 0 ? "text-emerald-500" : "text-red-400"}`}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(Math.round(delta))} vs prev
        </p>
      )}
      {sub && delta === undefined && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

const SPORT_TYPES = [
  "running", "cycling", "swimming", "hiking", "walking",
  "strength_training", "yoga", "tennis", "rowing", "other",
];

type ActivityForm = {
  date: string;
  activity_type: string;
  name: string;
  duration_minutes: string;
  distance_km: string;
  elevation_m: string;
  avg_heart_rate: string;
  user_notes: string;
  user_rating: number | null;
};

function AddActivitySheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ActivityForm>({
    date: new Date().toISOString().slice(0, 10),
    activity_type: "running",
    name: "",
    duration_minutes: "",
    distance_km: "",
    elevation_m: "",
    avg_heart_rate: "",
    user_notes: "",
    user_rating: null,
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof ActivityForm, value: string | number | null) =>
    setForm(f => ({ ...f, [key]: value }));

  async function save() {
    if (!form.activity_type) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        date: form.date,
        activity_type: form.activity_type,
        name: form.name || form.activity_type,
        duration_seconds: form.duration_minutes ? parseFloat(form.duration_minutes) * 60 : null,
        distance_meters: form.distance_km ? parseFloat(form.distance_km) * 1000 : null,
        elevation_gain_meters: form.elevation_m ? parseFloat(form.elevation_m) : null,
        avg_heart_rate: form.avg_heart_rate ? parseFloat(form.avg_heart_rate) : null,
        user_notes: form.user_notes || null,
        user_rating: form.user_rating,
      };
      const res = await fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { onSaved(); onClose(); }
    } finally { setSaving(false); }
  }

  const RATING_COLORS: Record<number, string> = {
    1: "#EF4444", 2: "#EF4444", 3: "#F97316", 4: "#F59E0B", 5: "#EAB308",
    6: "#84CC16", 7: "#22C55E", 8: "#22C55E", 9: "#10B981", 10: "#10B981",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Log activity manually</h2>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">×</button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SPORT_TYPES.map(s => (
              <button key={s} type="button" onClick={() => set("activity_type", s)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors capitalize ${form.activity_type === s ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {activityIcon(s)} {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[#71717A] mb-1 block">Date</label>
              <input type="date" className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" value={form.date} onChange={e => set("date", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Name (optional)</label>
              <input className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="e.g. Morning run" value={form.name} onChange={e => set("name", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[#71717A] mb-1 block">Duration (min)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="60" value={form.duration_minutes} onChange={e => set("duration_minutes", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Distance (km)</label>
              <input type="number" min={0} step="0.1" className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="5.0" value={form.distance_km} onChange={e => set("distance_km", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Elevation (m)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="100" value={form.elevation_m} onChange={e => set("elevation_m", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Avg HR (bpm)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="145" value={form.avg_heart_rate} onChange={e => set("avg_heart_rate", e.target.value)} /></div>
          </div>
          <div>
            <label className="text-xs text-[#71717A] mb-2 block">How did it feel?</label>
            <div className="flex gap-1.5 flex-wrap">
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <button key={n} type="button" onClick={() => set("user_rating", form.user_rating === n ? null : n)}
                  className="w-8 h-8 rounded-lg text-xs font-semibold transition-all"
                  style={form.user_rating === n ? { backgroundColor: RATING_COLORS[n], color: "#09090B" } : { backgroundColor: "#18181B", color: "#52525B" }}>{n}</button>
              ))}
            </div>
          </div>
          <div><label className="text-xs text-[#71717A] mb-1 block">Notes</label>
            <textarea rows={2} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] resize-none placeholder:text-[#3F3F46]"
              placeholder="How did it go?" value={form.user_notes} onChange={e => set("user_notes", e.target.value)} /></div>
          <button disabled={saving} onClick={save}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1">
            {saving ? "Saving…" : "Log activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

import FitnessFreshnessChart from "@/components/training/FitnessFreshnessChart";
import TrainingLogCalendar from "@/components/training/TrainingLogCalendar";
import { VolumeChart, ProgressComparisonChart } from "@/components/training/ProgressChart";
import OmyraTab from "@/components/training/OmyraTab";
import { TrainingRouteMap } from "@/components/training/TrainingRouteMap";
import RelativeEffortChart from "@/components/training/RelativeEffortChart";
import { GoalRings } from "@/components/training/GoalRings";

const TABS = [
  { key: "overview", label: "Overview", icon: <Activity size={13} /> },
  { key: "omyra", label: "Omyra", icon: <Target size={13} /> },
  { key: "load", label: "Load", icon: <Zap size={13} /> },
  { key: "log", label: "Log", icon: <List size={13} /> },
  { key: "progress", label: "Progress", icon: <TrendingUp size={13} /> },
  { key: "map", label: "Map", icon: <Map size={13} /> },
] as const;
type Tab = typeof TABS[number]["key"];

// Run best-effort distances (metres → label)
const RUN_DISTANCES: [number, string][] = [
  [400, "400m"], [1000, "1K"], [1609, "1 mile"], [5000, "5K"],
  [10000, "10K"], [15000, "15K"], [21097, "Half Marathon"], [42195, "Marathon"],
];

// Cycling best-effort distances
const BIKE_DISTANCES: [number, string][] = [
  [10000, "10K"], [20000, "20K"], [40000, "40K"], [50000, "50K"],
  [80000, "80K"], [100000, "100K"], [160000, "100 miles"], [200000, "200K"],
];

function fmtPace(sPerKm: number): string {
  const mins = Math.floor(sPerKm / 60);
  const secs = Math.round(sPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}/km`;
}

function fmtSpeed(sPerKm: number): string {
  return `${(3600 / sPerKm).toFixed(1)} km/h`;
}

function fmtActivityPace(a: { avg_speed_mps: number | null; activity_type: string | null }): string | null {
  if (!a.avg_speed_mps || a.avg_speed_mps <= 0) return null;
  const type = (a.activity_type ?? "").toLowerCase();
  const isRun = type.includes("run") || type.includes("treadmill") || type.includes("walk") || type.includes("hik");
  if (isRun) {
    const sPerKm = 1000 / a.avg_speed_mps;
    const mins = Math.floor(sPerKm / 60);
    const secs = Math.round(sPerKm % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}/km`;
  }
  return `${(a.avg_speed_mps * 3.6).toFixed(1)} km/h`;
}

type ActivityRecord = {
  id: string;
  date: string;
  name: string | null;
  activity_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  elevation_gain_meters: number | null;
} | null;

type Records = {
  longest_ride: ActivityRecord;
  longest_run: ActivityRecord;
  highest_elevation_ride: ActivityRecord;
};


export default function TrainingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [weeks, setWeeks] = useState(12);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [sportBreakdownMetric, setSportBreakdownMetric] = useState<"hours" | "km" | "count">("hours");
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), weeks * 7), "yyyy-MM-dd");
  const days = weeks * 7;

  const { data: summary } = useQuery<TrainingSummary>({
    queryKey: ["training-summary", days],
    queryFn: () => fetch(`${BASE}/training/summary?days=${days}`).then(r => r.json()),
  });

  const { data: weekly = [] } = useQuery<WeeklyRow[]>({
    queryKey: ["training-weekly", start, end],
    queryFn: () => fetch(`${BASE}/training/weekly?start=${start}&end=${end}`).then(r => r.json()),
  });

  const { data: sports = [] } = useQuery<SportRow[]>({
    queryKey: ["training-sports", start, end],
    queryFn: () => fetch(`${BASE}/training/sport-breakdown?start=${start}&end=${end}`).then(r => r.json()),
  });

  const { data: activities = [] } = useQuery<Activity[]>({
    queryKey: ["training-activities", start, end, sportFilter],
    queryFn: () => {
      const params = new URLSearchParams({ start, end, limit: "100" });
      if (sportFilter) params.set("sport", sportFilter);
      return fetch(`${BASE}/training/activities?${params}`).then(r => r.json());
    },
  });

  const { data: records } = useQuery<Records>({
    queryKey: ["training-records"],
    queryFn: () => fetch(`${BASE}/training/records`).then(r => r.json()),
    enabled: tab === "overview",
  });


  const { data: allInjuries = [] } = useQuery<Injury[]>({
    queryKey: ["injuries-list"],
    queryFn: () => injuriesApi.list(),
  });
  // Map activity_id → injuries for quick lookup in the activity list
  const injuryByActivity = allInjuries.reduce<Record<string, Injury[]>>((acc, inj) => {
    if (inj.activity_id) {
      if (!acc[inj.activity_id]) acc[inj.activity_id] = [];
      acc[inj.activity_id].push(inj);
    }
    return acc;
  }, {});

  // Best efforts: pace curve for run + bike
  const { data: runCurve = [] } = useQuery<{ bucket: number; all_time_best: number | null; last_90d_best: number | null }[]>({
    queryKey: ["training-curve-run"],
    queryFn: () => fetch(`${BASE}/training/curve?sport=run&channel=pace`).then(r => r.json()),
    enabled: tab === "overview",
  });

  const { data: bikeCurve = [] } = useQuery<{ bucket: number; all_time_best: number | null; last_90d_best: number | null }[]>({
    queryKey: ["training-curve-bike"],
    queryFn: () => fetch(`${BASE}/training/curve?sport=ride&channel=pace`).then(r => r.json()),
    enabled: tab === "overview",
  });

  // Aggregate weekly by week
  const weeklyAgg = Object.values(
    weekly.reduce<Record<string, { week: string; week_start: string; km: number; tss: number; hours: number }>>(
      (acc, r) => {
        if (!acc[r.week]) acc[r.week] = { week: r.week, week_start: r.week_start, km: 0, tss: 0, hours: 0 };
        acc[r.week].km += r.km;
        acc[r.week].tss += r.tss;
        acc[r.week].hours += r.hours;
        return acc;
      }, {}
    )
  ).sort((a, b) => a.week.localeCompare(b.week));

  const kmDelta = summary && summary.prev_total_km
    ? (summary.total_km ?? 0) - summary.prev_total_km : null;

  // Build best effort lookup maps
  const runBestMap = Object.fromEntries(runCurve.map(r => [r.bucket, r]));
  const bikeBestMap = Object.fromEntries(bikeCurve.map(r => [r.bucket, r]));

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Health</Link>
            <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Load, fitness & race readiness</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="mt-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors">
            + Log
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 w-full overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${tab === t.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── LOAD tab ─────────────────────────────────────────────────────── */}
      {tab === "load" && (
        <section className="space-y-6">
          <div>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Fitness & Freshness (CTL / ATL / TSB)</h2>
            <p className="text-xs text-[#52525B] mb-3">Daily training load model. Click any point to see what drove that day.</p>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <FitnessFreshnessChart />
            </div>
          </div>
          <div>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Weekly Relative Effort</h2>
            <p className="text-xs text-[#52525B] mb-3">Weekly activity load with 3-week rolling band. Amber zone = normal range. Uses Garmin&apos;s native activity load, not the CTL/ATL model input.</p>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <RelativeEffortChart />
            </div>
          </div>
        </section>
      )}

      {/* ── LOG tab ──────────────────────────────────────────────────────── */}
      {tab === "log" && (
        <section className="space-y-4">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Training log</h2>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
            <TrainingLogCalendar />
          </div>
        </section>
      )}

      {/* ── PROGRESS tab ─────────────────────────────────────────────────── */}
      {tab === "progress" && (
        <section className="space-y-8">
          <div>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Volume over time</h2>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <VolumeChart />
            </div>
          </div>
          <div>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Year-over-year comparison</h2>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <ProgressComparisonChart />
            </div>
          </div>
        </section>
      )}

      {/* ── OMYRA tab ─────────────────────────────────────────────────────── */}
      {tab === "omyra" && <OmyraTab />}

      {/* ── MAP tab ──────────────────────────────────────────────────────── */}
      {tab === "map" && (
        <section className="space-y-4">
          <TrainingRouteMap />
        </section>
      )}

      {/* ── OVERVIEW tab ─────────────────────────────────────────────────── */}
      {tab === "overview" && <>

      <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 w-fit mb-6">
        {PERIODS.map(p => (
          <button key={p.weeks} onClick={() => setWeeks(p.weeks)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${weeks === p.weeks ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <KpiCard label="Distance" value={summary?.total_km ? `${summary.total_km} km` : "—"} delta={kmDelta} />
        <KpiCard label="Time" value={summary?.total_hours ? `${summary.total_hours}h` : "—"} sub="moving" />
        <KpiCard label="Activities" value={summary?.activity_count?.toString() ?? "—"} delta={summary ? summary.activity_count - summary.prev_activity_count : null} />
        <KpiCard label="Elevation" value={summary?.total_elevation_m ? `${summary.total_elevation_m.toLocaleString()} m` : "—"} sub="total gain" />
        <KpiCard label="Avg HR" value={summary?.avg_hr ? `${summary.avg_hr} bpm` : "—"} sub="across workouts" />
        <KpiCard label="TSS" value={summary?.total_tss ? `${summary.total_tss}` : "—"} sub="training stress" />
      </div>

      {/* Goals */}
      <section className="mb-8">
        <GoalRings />
      </section>

      {/* Weekly bar chart */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Weekly distance (km)</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyAgg} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="week_start" tickFormatter={d => format(parseISO(d), "d MMM")}
                tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v} km`, "Distance"]} labelFormatter={(d) => format(parseISO(String(d)), "d MMM")} />
              <Bar dataKey="km" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Sport breakdown */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Sport breakdown</h2>
          <div className="flex gap-1">
            {(["hours", "km", "count"] as const).map(m => (
              <button key={m} onClick={() => setSportBreakdownMetric(m)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${sportBreakdownMetric === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {m === "hours" ? "Time" : m === "km" ? "Distance" : "Activities"}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 flex gap-4 items-center">
          <div style={{ width: 150, height: 150, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sports} dataKey={sportBreakdownMetric} nameKey="sport_label" cx="50%" cy="50%" outerRadius={65} innerRadius={38} strokeWidth={0}>
                  {sports.map(s => <Cell key={s.sport} fill={sportColor(s.sport)} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE}
                  formatter={(v, _, p) => [
                    sportBreakdownMetric === "hours" ? `${Number(v).toFixed(1)}h`
                    : sportBreakdownMetric === "km" ? `${v} km`
                    : `${v} sessions`,
                    p.payload?.sport_label
                  ]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            {sports.map(s => {
              const val = sportBreakdownMetric === "hours" ? `${s.hours.toFixed(1)}h`
                : sportBreakdownMetric === "km" ? `${s.km} km`
                : `${s.count}×`;
              const total = sports.reduce((a, x) => a + (sportBreakdownMetric === "hours" ? x.hours : sportBreakdownMetric === "km" ? x.km : x.count), 0);
              const pct = total > 0 ? Math.round(((sportBreakdownMetric === "hours" ? s.hours : sportBreakdownMetric === "km" ? s.km : s.count) / total) * 100) : 0;
              return (
                <div key={s.sport}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sportColor(s.sport) }} />
                      <span className="text-xs text-[#A1A1AA] truncate">{s.sport_label}</span>
                    </div>
                    <div className="flex gap-2 text-xs text-[#52525B] tabular-nums flex-shrink-0">
                      <span>{val}</span>
                      <span className="text-[#3F3F46]">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-0.5 bg-[#18181B] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: sportColor(s.sport) }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Best Efforts */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Best efforts — Running</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
          {RUN_DISTANCES.map(([metres, label], i) => {
            const best = runBestMap[metres];
            return (
              <div key={metres} className={`flex items-center justify-between px-4 py-2.5 ${i < RUN_DISTANCES.length - 1 ? "border-b border-[#18181B]" : ""}`}>
                <span className="text-xs text-[#A1A1AA]">{label}</span>
                <div className="flex gap-4 text-xs tabular-nums">
                  {best?.last_90d_best ? (
                    <span className="text-blue-400">{fmtPace(best.last_90d_best)} <span className="text-[#3F3F46]">90d</span></span>
                  ) : <span className="text-[#3F3F46]">—</span>}
                  {best?.all_time_best ? (
                    <span className="text-amber-400">{fmtPace(best.all_time_best)} <span className="text-[#3F3F46]">PR</span></span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {runCurve.length === 0 && (
            <p className="text-xs text-[#52525B] px-4 py-4">No running data yet — pace curves build after stream data is fetched.</p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Best efforts — Cycling</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
          {BIKE_DISTANCES.map(([metres, label], i) => {
            const best = bikeBestMap[metres];
            return (
              <div key={metres} className={`flex items-center justify-between px-4 py-2.5 ${i < BIKE_DISTANCES.length - 1 ? "border-b border-[#18181B]" : ""}`}>
                <span className="text-xs text-[#A1A1AA]">{label}</span>
                <div className="flex gap-4 text-xs tabular-nums">
                  {best?.last_90d_best ? (
                    <span className="text-blue-400">{fmtSpeed(best.last_90d_best)} <span className="text-[#3F3F46]">90d</span></span>
                  ) : <span className="text-[#3F3F46]">—</span>}
                  {best?.all_time_best ? (
                    <span className="text-amber-400">{fmtSpeed(best.all_time_best)} <span className="text-[#3F3F46]">PR</span></span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {bikeCurve.length === 0 && (
            <p className="text-xs text-[#52525B] px-4 py-4">No cycling pace data yet.</p>
          )}
        </div>
      </section>

      {/* All-time records */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">All-time records</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
          {[
            {
              label: "Longest ride",
              rec: records?.longest_ride,
              fmt: (r: NonNullable<ActivityRecord>) => `${((r.distance_meters ?? 0) / 1000).toFixed(1)} km`,
            },
            {
              label: "Longest run",
              rec: records?.longest_run,
              fmt: (r: NonNullable<ActivityRecord>) => `${((r.distance_meters ?? 0) / 1000).toFixed(1)} km`,
            },
            {
              label: "Highest elevation ride",
              rec: records?.highest_elevation_ride,
              fmt: (r: NonNullable<ActivityRecord>) => `${Math.round(r.elevation_gain_meters ?? 0).toLocaleString()} m D+`,
            },
          ].map(({ label, rec, fmt }, i, arr) => (
            <div key={label} className={`flex items-center justify-between px-4 py-3 ${i < arr.length - 1 ? "border-b border-[#18181B]" : ""}`}>
              <div>
                <span className="text-xs text-[#A1A1AA]">{label}</span>
                {rec && <p className="text-xs text-[#52525B] mt-0.5 truncate max-w-[200px]">{rec.name ?? ""} · {rec.date}</p>}
              </div>
              <span className="text-sm font-semibold text-amber-400 tabular-nums ml-4 flex-shrink-0">
                {rec ? fmt(rec) : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Activity log */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Activities</h2>
          <div className="flex gap-1 flex-wrap">
            {[null, "running", "cycling", "swimming", "walking"].map(s => (
              <button key={s ?? "all"} onClick={() => { setSportFilter(s); setExpandedId(null); }}
                className={`px-2 py-1 rounded text-xs transition-colors ${sportFilter === s ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {s ? activityIcon(s) : "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-[#18181B]">
          {activities.map(a => {
            const isExpanded = expandedId === a.id;
            const pace = fmtActivityPace(a);
            const linkedInjuries = injuryByActivity[a.id] ?? [];
            const hasActiveInjury = linkedInjuries.some(i => i.status !== "resolved");
            return (
              <div key={a.id}>
                {/* Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  className="w-full flex items-center justify-between py-3 hover:bg-[#0D0D0F] rounded-lg px-2 -mx-2 transition-colors text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg flex-shrink-0">{activityIcon(a.activity_type)}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-[#FAFAFA] truncate">{a.name ?? a.activity_type ?? "Activity"}</p>
                        {hasActiveInjury && (
                          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 leading-tight">
                            ⚠ injury
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#52525B]">{format(parseISO(a.date), "EEE d MMM")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#A1A1AA] tabular-nums flex-shrink-0 ml-3">
                    {a.distance_meters ? <span>{fmtDistance(a.distance_meters)}</span> : null}
                    {a.duration_seconds ? <span>{fmtDuration(a.duration_seconds)}</span> : null}
                    {pace ? <span className="text-[#71717A]">{pace}</span> : null}
                    <span className={`text-[#3F3F46] transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mx-2 mb-3 bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
                    {/* Stats grid */}
                    <div className="grid grid-cols-3 gap-0 divide-x divide-y divide-[#18181B]">
                      {[
                        { label: "Distance", value: fmtDistance(a.distance_meters) },
                        { label: "Duration", value: fmtDuration(a.duration_seconds) },
                        { label: pace?.includes("/km") ? "Avg pace" : "Avg speed", value: pace },
                        { label: "Avg HR", value: a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)} bpm` : null },
                        { label: "Max HR", value: a.max_heart_rate ? `${Math.round(a.max_heart_rate)} bpm` : null },
                        { label: "Elevation", value: a.elevation_gain_meters ? `↑ ${Math.round(a.elevation_gain_meters)} m` : null },
                        { label: "Power", value: a.avg_power_watts ? `${Math.round(a.avg_power_watts)} W` : null },
                        { label: "Calories", value: a.calories ? `${Math.round(a.calories)} kcal` : null },
                        { label: "TSS", value: a.training_stress_score ? `${Math.round(a.training_stress_score)}` : null },
                      ].filter(s => s.value).map(({ label, value }) => (
                        <div key={label} className="px-4 py-3">
                          <p className="text-[10px] text-[#52525B] uppercase tracking-wider mb-0.5">{label}</p>
                          <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
                        </div>
                      ))}
                    </div>
                    {/* Injury flags in expanded panel */}
                    {linkedInjuries.length > 0 && (
                      <div className="border-t border-[#18181B] px-4 py-2.5 space-y-1">
                        {linkedInjuries.map(inj => (
                          <div key={inj.id} className="flex items-center justify-between text-xs">
                            <span className="text-orange-400">
                              ⚠ {ZONE_LABELS[inj.zone] ?? inj.zone}{inj.side ? ` (${inj.side})` : ""} — pain {inj.pain_scale}/10
                            </span>
                            <span className={`capitalize px-1.5 py-0.5 rounded text-[10px] ${
                              inj.status === "active" ? "bg-orange-500/20 text-orange-400" :
                              inj.status === "recovering" ? "bg-yellow-500/20 text-yellow-400" :
                              "bg-emerald-500/20 text-emerald-400"
                            }`}>{inj.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Open full detail link */}
                    <div className="border-t border-[#18181B] px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] text-[#52525B]">
                        {a.start_time ? format(parseISO(a.start_time), "HH:mm") : ""}{a.has_polyline ? " · GPS" : ""}
                      </span>
                      <Link href={`/activity/${a.id}`}
                        className="text-xs text-[#F59E0B] hover:text-[#D97706] transition-colors"
                        onClick={e => e.stopPropagation()}>
                        Full details + map →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {activities.length === 0 && (
            <p className="text-xs text-[#52525B] py-6 text-center">No activities in this period</p>
          )}
        </div>
      </section>

      {showAdd && (
        <AddActivitySheet onClose={() => setShowAdd(false)} onSaved={() => {
          qc.invalidateQueries({ queryKey: ["training-activities"] });
          qc.invalidateQueries({ queryKey: ["training-summary"] });
        }} />
      )}

      </>}

    </main>
  );
}
