"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Empty, Hero, Panel, Pill, Skeleton } from "@/components/ui/kit";
import { activityIcon } from "@/lib/api";
import { FAMILY_LABEL, SPORT_COLORS, sportFamily, sportOf, type SportFamily } from "@/lib/sport";
import { localISODate } from "@/lib/dates";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Row {
  id: string; date: string; source: string; activity_type: string | null; name: string | null; start_time: string | null;
  duration_seconds: number | null; moving_time_seconds: number | null; distance_meters: number | null;
  elevation_gain_meters: number | null; avg_heart_rate: number | null; avg_speed_mps: number | null;
  avg_power_watts: number | null; training_stress_score: number | null; temp_c: number | null;
}

type Period = "3m" | "12m" | "all" | `y${number}`;
type SortKey = "date" | "distance" | "time" | "speed" | "climb" | "hr" | "temp";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Date" }, { key: "distance", label: "Distance" }, { key: "time", label: "Time" },
  { key: "speed", label: "Pace" }, { key: "climb", label: "Climb" }, { key: "hr", label: "Heart rate" },
  { key: "temp", label: "Temperature" },
];
const SIMILAR = 0.25;                     // ±25 % distance (or time, without distance)

const secs = (r: Row) => r.moving_time_seconds || r.duration_seconds || 0;
const speed = (r: Row) => r.avg_speed_mps || ((r.distance_meters ?? 0) > 50 && secs(r) ? r.distance_meters! / secs(r) : 0);

function dur(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Ride km/h · swim /100 m · run & walk /km — the way each sport is compared. */
function pace(r: Row): string | null {
  const v = speed(r);
  if (!v) return null;
  const s = sportOf(r.activity_type);
  if (s === "ride") return `${(v * 3.6).toFixed(1)} km/h`;
  const per = s === "swim" ? 100 / v : 1000 / v;
  return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, "0")} ${s === "swim" ? "/100m" : "/km"}`;
}

function value(r: Row, k: SortKey): number {
  switch (k) {
    case "date": return Date.parse(r.start_time ?? r.date) || 0;
    case "distance": return r.distance_meters ?? 0;
    case "time": return secs(r);
    case "speed": return speed(r);
    case "climb": return r.elevation_gain_meters ?? 0;
    case "hr": return r.avg_heart_rate ?? 0;
    case "temp": return r.temp_c ?? -99;
  }
}

function periodRange(p: Period): [string, string] {
  const today = new Date();
  const end = localISODate(today);
  if (p === "all") return ["2000-01-01", end];
  if (p.startsWith("y")) return [`${p.slice(1)}-01-01`, `${p.slice(1)}-12-31`];
  const d = new Date(today);
  d.setMonth(d.getMonth() - (p === "3m" ? 3 : 12));
  return [localISODate(d), end];
}

/** Difference against the activity you came from: faster / shorter in emerald — information, not a grade. */
function Diff({ r, ref_ }: { r: Row; ref_: Row }) {
  const parts: React.ReactNode[] = [];
  const v0 = speed(ref_), v = speed(r);
  if (v0 && v) {
    const s = sportOf(r.activity_type);
    if (s === "ride") {
      const d = (v - v0) * 3.6;
      if (Math.abs(d) >= 0.1) parts.push(<span key="v" className={d > 0 ? "text-emerald-400" : ""}>{d > 0 ? "+" : "−"}{Math.abs(d).toFixed(1)} km/h</span>);
    } else {
      const unit = s === "swim" ? 100 : 1000;
      const d = unit / v - unit / v0;                                  // s per km: negative = faster
      if (Math.abs(d) >= 1) parts.push(<span key="v" className={d < 0 ? "text-emerald-400" : ""}>{d < 0 ? "−" : "+"}{Math.round(Math.abs(d))} s{s === "swim" ? "/100m" : "/km"}</span>);
    }
  }
  if (r.avg_heart_rate && ref_.avg_heart_rate) {
    const d = r.avg_heart_rate - ref_.avg_heart_rate;
    if (d) parts.push(<span key="h">{d > 0 ? "+" : "−"}{Math.abs(d)} bpm</span>);
  }
  if (r.temp_c != null && ref_.temp_c != null) {
    const d = Math.round(r.temp_c - ref_.temp_c);
    if (Math.abs(d) >= 2) parts.push(<span key="t">{d > 0 ? "+" : "−"}{Math.abs(d)}°</span>);
  }
  if (!parts.length) return null;
  return <p className="text-[11px] text-[#71717A] tabular-nums flex gap-2 justify-end">{parts}</p>;
}

function ActivityLine({ r, ref_, pinned = false }: { r: Row; ref_: Row | null; pinned?: boolean }) {
  const d = new Date(`${r.date}T12:00:00`);
  const km = (r.distance_meters ?? 0) > 50 ? r.distance_meters! / 1000 : null;
  const color = SPORT_COLORS[sportOf(r.activity_type)];
  return (
    <Link href={`/activity/${encodeURIComponent(r.id)}`}
          className={`px-4 py-2.5 flex items-center gap-3 hover:bg-[#18181B] transition-colors ${pinned ? "bg-[#F59E0B]/10" : ""}`}>
      <div className="w-11 shrink-0 bg-[#18181B] rounded-xl py-1.5 text-center relative">
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full" style={{ background: color }} />
        <p className="text-sm font-semibold leading-none tabular-nums">{d.getDate()}</p>
        <p className="text-[10px] uppercase tracking-widest text-[#71717A] mt-1">
          {d.toLocaleDateString("en-GB", { month: "short" })}{d.getFullYear() !== new Date().getFullYear() ? ` ${String(d.getFullYear()).slice(2)}` : ""}
        </p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          <span className="mr-1.5">{activityIcon(r.activity_type)}</span>{r.name ?? (r.activity_type ?? "Activity").replace(/_/g, " ")}
          {pinned && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">this one</span>}
        </p>
        <p className="text-xs text-[#71717A] tabular-nums truncate">
          {[km != null ? `${km >= 100 ? Math.round(km) : km.toFixed(1)} km` : null, secs(r) ? dur(secs(r)) : null,
            r.elevation_gain_meters ? `+${Math.round(r.elevation_gain_meters)} m` : null,
            r.avg_heart_rate ? `${r.avg_heart_rate} bpm` : null, r.avg_power_watts ? `${r.avg_power_watts} W` : null,
            r.temp_c != null ? `${Math.round(r.temp_c)}°` : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{pace(r) ?? (r.training_stress_score ? `${Math.round(r.training_stress_score)} TSS` : "")}</p>
        {ref_ && !pinned && <Diff r={r} ref_={ref_} />}
      </div>
    </Link>
  );
}

/** Every activity, filterable and sortable — and "like this one": the activities similar to the one you came from. */
export function ActivityList() {
  const [family, setFamily] = useState<SportFamily | null>(null);
  const [period, setPeriod] = useState<Period>("12m");
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [likeId, setLikeId] = useState<string | null>(null);
  const [similar, setSimilar] = useState(true);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const like = p.get("like");
    const sp = p.get("sport") as SportFamily | null;
    if (sp && sp in FAMILY_LABEL) setFamily(sp);
    if (like) { setLikeId(like); setPeriod("all"); }
  }, []);

  const [start, end] = periodRange(period);
  const { data } = useQuery<Row[]>({
    queryKey: ["activity-list", start, end],
    queryFn: () => fetch(`${BASE}/training/activities?${new URLSearchParams({ start, end, limit: "3000" })}`).then((r) => r.json()),
  });
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const ref_ = likeId ? rows.find((r) => r.id === likeId) ?? null : null;
  useEffect(() => { if (ref_ && family === null) setFamily(sportFamily(ref_.activity_type)); }, [ref_]); // eslint-disable-line react-hooks/exhaustive-deps

  const present = useMemo(() => {
    const n: Partial<Record<SportFamily, number>> = {};
    rows.forEach((r) => { const f = sportFamily(r.activity_type); n[f] = (n[f] ?? 0) + 1; });
    return (Object.keys(FAMILY_LABEL) as SportFamily[]).filter((f) => n[f]).map((f) => ({ f, n: n[f]! }));
  }, [rows]);

  const shown = useMemo(() => {
    let out = rows.filter((r) => !family || sportFamily(r.activity_type) === family);
    if (ref_ && similar) {
      const base = (ref_.distance_meters ?? 0) > 1000 ? "distance" : "time";
      const v0 = value(ref_, base);
      if (v0) out = out.filter((r) => Math.abs(value(r, base) - v0) <= SIMILAR * v0);
    }
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => `${r.name ?? ""} ${r.activity_type ?? ""}`.toLowerCase().includes(needle));
    return [...out].sort((a, b) => (value(a, sort) - value(b, sort)) * (asc ? 1 : -1));
  }, [rows, family, ref_, similar, q, sort, asc]);

  const km = shown.reduce((a, r) => a + (r.distance_meters ?? 0), 0) / 1000;
  const hours = shown.reduce((a, r) => a + secs(r), 0) / 3600;
  const years = Array.from(new Set(rows.map((r) => r.date.slice(0, 4)))).sort().reverse();
  const backHref = ref_ ? `/activity/${encodeURIComponent(ref_.id)}` : "/omyra";

  return (
    <div className="space-y-6">
      <header>
        <Link href={backHref} className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← {ref_ ? ref_.name ?? "The activity" : "Omyra"}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
        <p className="text-sm text-[#71717A] mt-0.5">
          {ref_ ? <>Compared with <Link href={backHref} className="hover:underline">{ref_.name ?? "this activity"}</Link> · {new Date(`${ref_.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</>
            : "Everything you've done — filter, sort, compare"}
        </p>
      </header>

      {!data ? <Skeleton h={480} /> : (
        <>
          <Hero eyebrow={family ? FAMILY_LABEL[family] : "All sports"} value={shown.length} unit={shown.length === 1 ? "activity" : "activities"}
                sub={[km >= 1 ? `${Math.round(km).toLocaleString("en-GB")} km` : null, hours ? `${Math.round(hours)} h` : null,
                      ref_ && similar ? `within ±${SIMILAR * 100} % of its ${(ref_.distance_meters ?? 0) > 1000 ? "distance" : "time"}` : null]
                      .filter(Boolean).join(" · ")} />

          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Pill on={family === null} onClick={() => setFamily(null)}>All</Pill>
              {present.map(({ f, n }) => (
                <Pill key={f} on={family === f} onClick={() => setFamily(family === f ? null : f)}>
                  {FAMILY_LABEL[f]} <span className="opacity-60 tabular-nums">{n}</span>
                </Pill>
              ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(["3m", "12m", "all"] as Period[]).map((p) => (
                <Pill key={p} on={period === p} onClick={() => setPeriod(p)}>{p === "3m" ? "3 months" : p === "12m" ? "12 months" : "All time"}</Pill>
              ))}
              {years.slice(0, 6).map((y) => <Pill key={y} on={period === `y${y}`} onClick={() => setPeriod(`y${y}` as Period)}>{y}</Pill>)}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[#52525B] uppercase tracking-widest text-[10px] mr-1">Sort</span>
                {SORTS.map((x) => (
                  <button key={x.key} onClick={() => (sort === x.key ? setAsc(!asc) : (setSort(x.key), setAsc(false)))}
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors ${
                            sort === x.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                    {x.label}{sort === x.key && (asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                ))}
              </div>
              {ref_ && (
                <Pill on={similar} onClick={() => setSimilar(!similar)}>Similar {(ref_.distance_meters ?? 0) > 1000 ? "distance" : "length"}</Pill>
              )}
              {likeId && (
                <button className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA]"
                        onClick={() => { setLikeId(null); window.history.replaceState(null, "", "/activities"); }}>
                  <X size={12} />Stop comparing
                </button>
              )}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names…"
                     className="ml-auto w-40 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1 text-xs text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#52525B]" />
            </div>
          </div>

          {ref_ && (
            <Panel className="overflow-hidden"><ActivityLine r={ref_} ref_={ref_} pinned /></Panel>
          )}

          {shown.length === 0 ? <Empty>Nothing matches — widen the period or the filter.</Empty> : (
            <Panel className="overflow-hidden divide-y divide-[#18181B]">
              {shown.filter((r) => r.id !== ref_?.id).slice(0, limit).map((r) => <ActivityLine key={r.id} r={r} ref_={ref_} />)}
              {shown.length > limit && (
                <button onClick={() => setLimit(limit + 100)} className="w-full text-xs text-[#71717A] hover:text-[#A1A1AA] py-2.5">
                  Show more ({shown.length - limit} left)
                </button>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
