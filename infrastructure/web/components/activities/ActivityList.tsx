"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, GitCompareArrows, X } from "lucide-react";
import { ActionButton, Empty, Hero, Panel, Pill, Skeleton } from "@/components/ui/kit";
import { activityIcon } from "@/lib/api";
import { FAMILY_LABEL, SPORT_COLORS, sportFamily, sportOf, type SportFamily } from "@/lib/sport";
import { localISODate } from "@/lib/dates";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Row {
  id: string; date: string; source: string; activity_type: string | null; name: string | null; start_time: string | null;
  duration_seconds: number | null; moving_time_seconds: number | null; distance_meters: number | null;
  elevation_gain_meters: number | null; avg_heart_rate: number | null; max_heart_rate: number | null;
  avg_speed_mps: number | null; calories: number | null;
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

function ActivityLine({ r, ref_, mark, picking, picked, onPick }: {
  r: Row; ref_: Row | null; mark?: "from" | "similar";
  picking: boolean; picked: boolean; onPick: () => void;
}) {
  const d = new Date(`${r.date}T12:00:00`);
  const km = (r.distance_meters ?? 0) > 50 ? r.distance_meters! / 1000 : null;
  const color = SPORT_COLORS[sportOf(r.activity_type)];
  const inner = (
    <>
      {picking && (
        <span className={`w-5 h-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
          picked ? "bg-[#F59E0B] border-[#F59E0B] text-[#0D0D0F]" : "border-[#3F3F46]"}`}>
          {picked && <Check size={12} strokeWidth={3} />}
        </span>
      )}
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
          {mark === "from" && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">you came from here</span>}
          {mark === "similar" && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">similar to this</span>}
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
        {ref_ && ref_.id !== r.id && <Diff r={r} ref_={ref_} />}
      </div>
    </>
  );
  const cls = `px-4 py-2.5 flex items-center gap-3 hover:bg-[#18181B] transition-colors ${
    mark ? "bg-[#F59E0B]/10" : picked ? "bg-[#18181B]" : ""}`;
  return picking
    ? <button id={`a-${r.id}`} onClick={onPick} className={`w-full text-left ${cls}`}>{inner}</button>
    : <Link id={`a-${r.id}`} href={`/activity/${encodeURIComponent(r.id)}`} className={cls}>{inner}</Link>;
}

/** The picked activities side by side: one column each, the first is the reference the others are measured against. */
function CompareTable({ rows, onClose, onRemove }: { rows: Row[]; onClose: () => void; onRemove: (id: string) => void }) {
  const ref_ = rows[0];
  const sportSet = new Set(rows.map((r) => sportOf(r.activity_type)));
  type Metric = { label: string; v: (r: Row) => number | null; fmt: (r: Row) => string | null; better?: "high" | "low" };
  const all: Metric[] = [
    { label: "Distance", v: (r) => (r.distance_meters ?? 0) > 50 ? r.distance_meters! : null,
      fmt: (r) => (r.distance_meters ?? 0) > 50 ? `${(r.distance_meters! / 1000).toFixed(1)} km` : null },
    { label: "Moving time", v: (r) => secs(r) || null, fmt: (r) => secs(r) ? dur(secs(r)) : null },
    { label: sportSet.size === 1 && sportSet.has("ride") ? "Speed" : "Pace", v: (r) => speed(r) || null, fmt: pace, better: "high" },
    { label: "Climb", v: (r) => r.elevation_gain_meters, fmt: (r) => r.elevation_gain_meters ? `+${Math.round(r.elevation_gain_meters)} m` : null },
    { label: "Avg heart rate", v: (r) => r.avg_heart_rate, fmt: (r) => r.avg_heart_rate ? `${r.avg_heart_rate} bpm` : null },
    { label: "Max heart rate", v: (r) => r.max_heart_rate, fmt: (r) => r.max_heart_rate ? `${r.max_heart_rate} bpm` : null },
    { label: "Power", v: (r) => r.avg_power_watts, fmt: (r) => r.avg_power_watts ? `${r.avg_power_watts} W` : null, better: "high" },
    { label: "Speed per beat", v: (r) => speed(r) && r.avg_heart_rate ? (speed(r) * 3600) / r.avg_heart_rate : null,
      fmt: (r) => speed(r) && r.avg_heart_rate ? `${((speed(r) * 3600) / r.avg_heart_rate).toFixed(1)} m/beat` : null, better: "high" },
    { label: "Load", v: (r) => r.training_stress_score, fmt: (r) => r.training_stress_score ? `${Math.round(r.training_stress_score)} TSS` : null },
    { label: "Temperature", v: (r) => r.temp_c, fmt: (r) => r.temp_c != null ? `${Math.round(r.temp_c)}°C` : null },
    { label: "Calories", v: (r) => r.calories, fmt: (r) => r.calories ? `${r.calories} kcal` : null },
  ];
  const metrics = all.filter((m) => rows.some((r) => m.v(r) != null));

  return (
    <Panel className="overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-[#18181B]">
        <p className="text-xs uppercase tracking-widest text-[#52525B]">Side by side · against the first</p>
        <button onClick={onClose} className="text-xs text-[#71717A] hover:text-[#A1A1AA] inline-flex items-center gap-1"><X size={12} />Close</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-[#18181B]">
              <th className="w-28" />
              {rows.map((r, i) => (
                <th key={r.id} className="px-3 py-2.5 text-left font-normal align-top min-w-[120px]">
                  <Link href={`/activity/${encodeURIComponent(r.id)}`} className="text-sm font-medium hover:underline block truncate max-w-[160px]">
                    {activityIcon(r.activity_type)} {r.name ?? "Activity"}
                  </Link>
                  <span className="text-xs text-[#71717A]">
                    {new Date(`${r.date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                    {i === 0 ? " · reference" : ""}
                  </span>
                  <button onClick={() => onRemove(r.id)} className="ml-1.5 text-[#52525B] hover:text-rose-400 align-middle" title="Take it out"><X size={11} /></button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#18181B]">
            {metrics.map((m) => {
              const vals = rows.map((r) => m.v(r));
              const nums = vals.filter((v): v is number => v != null);
              const best = m.better && nums.length > 1 ? (m.better === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
              return (
                <tr key={m.label}>
                  <td className="px-4 py-2 text-[10px] uppercase tracking-widest text-[#52525B] whitespace-nowrap">{m.label}</td>
                  {rows.map((r, i) => {
                    const v = vals[i], v0 = vals[0];
                    const pct = i > 0 && v != null && v0 ? Math.round(((v - v0) / v0) * 100) : null;
                    return (
                      <td key={r.id} className="px-3 py-2">
                        <span className={best != null && v === best ? "font-semibold text-emerald-400" : "text-[#D4D4D8]"}>{m.fmt(r) ?? "—"}</span>
                        {pct != null && pct !== 0 && <span className="text-[11px] text-[#71717A] ml-1.5">{pct > 0 ? "+" : ""}{pct}%</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Every activity, filterable and sortable. Compare: pick 2–4 to see them side by side, or one to find similar ones. */
export function ActivityList() {
  const [family, setFamily] = useState<SportFamily | null>(null);
  const [period, setPeriod] = useState<Period>("12m");
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [similarTo, setSimilarTo] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const sp = p.get("sport") as SportFamily | null;
    if (sp && sp in FAMILY_LABEL) setFamily(sp);
    const from = p.get("from");
    if (from) setFromId(from);
  }, []);

  const [start, end] = periodRange(period);
  const { data } = useQuery<Row[]>({
    queryKey: ["activity-list", start, end],
    queryFn: () => fetch(`${BASE}/training/activities?${new URLSearchParams({ start, end, limit: "3000" })}`).then((r) => r.json()),
  });
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // came from an activity older than the period: widen to all time; then bring it into view
  useEffect(() => {
    if (!fromId || !data) return;
    if (!byId.has(fromId) && period !== "all") { setPeriod("all"); return; }
    if (byId.has(fromId)) requestAnimationFrame(() => document.getElementById(`a-${fromId}`)?.scrollIntoView({ block: "center" }));
  }, [fromId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const simRef = similarTo ? byId.get(similarTo) ?? null : null;
  const present = useMemo(() => {
    const n: Partial<Record<SportFamily, number>> = {};
    rows.forEach((r) => { const f = sportFamily(r.activity_type); n[f] = (n[f] ?? 0) + 1; });
    return (Object.keys(FAMILY_LABEL) as SportFamily[]).filter((f) => n[f]).map((f) => ({ f, n: n[f]! }));
  }, [rows]);

  const shown = useMemo(() => {
    let out = rows.filter((r) => !family || sportFamily(r.activity_type) === family);
    if (simRef) {
      const base = (simRef.distance_meters ?? 0) > 1000 ? "distance" : "time";
      const v0 = value(simRef, base);
      const fam = sportFamily(simRef.activity_type);
      out = rows.filter((r) => sportFamily(r.activity_type) === fam && v0 && Math.abs(value(r, base) - v0) <= SIMILAR * v0);
    }
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => `${r.name ?? ""} ${r.activity_type ?? ""}`.toLowerCase().includes(needle));
    return [...out].sort((a, b) => (value(a, sort) - value(b, sort)) * (asc ? 1 : -1));
  }, [rows, family, simRef, q, sort, asc]);

  function pick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));
  }
  function startPicking() {
    setPicking(true);
    if (fromId && byId.has(fromId) && !picked.length) setPicked([fromId]);
  }
  function stopPicking() {
    setPicking(false); setPicked([]); setShowCompare(false);
  }

  const km = shown.reduce((a, r) => a + (r.distance_meters ?? 0), 0) / 1000;
  const hours = shown.reduce((a, r) => a + secs(r), 0) / 3600;
  const years = Array.from(new Set(rows.map((r) => r.date.slice(0, 4)))).sort().reverse();
  const from = fromId ? byId.get(fromId) ?? null : null;
  const pickedRows = picked.map((id) => byId.get(id)).filter((r): r is Row => !!r);

  return (
    <div className="space-y-6 pb-16">
      <header>
        <Link href={from ? `/activity/${encodeURIComponent(from.id)}` : "/omyra"}
              className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← {from ? from.name ?? "The activity" : "Omyra"}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Everything you&apos;ve done — filter, sort, compare</p>
          </div>
          <div className="shrink-0 mt-1">
            {picking
              ? <button onClick={stopPicking} className="text-xs text-[#71717A] hover:text-[#A1A1AA] inline-flex items-center gap-1"><X size={12} />Done comparing</button>
              : <ActionButton icon={GitCompareArrows} onClick={startPicking}>Compare</ActionButton>}
          </div>
        </div>
      </header>

      {!data ? <Skeleton h={480} /> : (
        <>
          {showCompare && pickedRows.length >= 2 ? (
            <CompareTable rows={pickedRows} onClose={() => setShowCompare(false)}
                          onRemove={(id) => { const left = picked.filter((x) => x !== id); setPicked(left); if (left.length < 2) setShowCompare(false); }} />
          ) : (
            <Hero eyebrow={simRef ? `Similar to ${simRef.name ?? "this one"}` : family ? FAMILY_LABEL[family] : "All sports"}
                  value={shown.length} unit={shown.length === 1 ? "activity" : "activities"}
                  sub={[km >= 1 ? `${Math.round(km).toLocaleString("en-GB")} km` : null, hours ? `${Math.round(hours)} h` : null,
                        simRef ? `same sport, within ±${SIMILAR * 100} % of its ${(simRef.distance_meters ?? 0) > 1000 ? "distance" : "time"}` : null]
                        .filter(Boolean).join(" · ")} />
          )}

          {picking && !showCompare && (
            <p className="text-xs text-[#71717A]">
              Pick up to 4 to see side by side (the first is the reference), or one to find the ones like it.
            </p>
          )}

          {simRef ? (
            <div className="flex items-center gap-3">
              <Pill on onClick={() => setSimilarTo(null)}>Similar to {simRef.name ?? "this one"} <X size={11} /></Pill>
            </div>
          ) : (
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
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1 text-xs overflow-x-auto [scrollbar-width:none]">
              <span className="text-[#52525B] uppercase tracking-widest text-[10px] mr-1">Sort</span>
              {SORTS.map((x) => (
                <button key={x.key} onClick={() => (sort === x.key ? setAsc(!asc) : (setSort(x.key), setAsc(false)))}
                        className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors ${
                          sort === x.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                  {x.label}{sort === x.key && (asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              ))}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names…"
                   className="ml-auto w-40 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1 text-xs text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#52525B]" />
          </div>

          {shown.length === 0 ? <Empty>Nothing matches — widen the period or the filter.</Empty> : (
            <Panel className="overflow-hidden divide-y divide-[#18181B]">
              {(simRef ? [simRef, ...shown.filter((r) => r.id !== simRef.id)] : shown).slice(0, limit).map((r) => (
                <ActivityLine key={r.id} r={r} ref_={simRef ?? (picking && pickedRows[0] ? pickedRows[0] : null)}
                              mark={simRef?.id === r.id ? "similar" : fromId === r.id && !picking ? "from" : undefined}
                              picking={picking} picked={picked.includes(r.id)} onPick={() => pick(r.id)} />
              ))}
              {shown.length > limit && (
                <button onClick={() => setLimit(limit + 100)} className="w-full text-xs text-[#71717A] hover:text-[#A1A1AA] py-2.5">
                  Show more ({shown.length - limit} left)
                </button>
              )}
            </Panel>
          )}
        </>
      )}

      {/* The compare bar: what's picked, and what to do with it */}
      {picking && picked.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[600] w-[calc(100%-2rem)] max-w-xl">
          <Panel className="px-4 py-3 flex items-center gap-3">
            <p className="text-sm flex-1 min-w-0 truncate">
              <span className="font-semibold tabular-nums">{picked.length}</span>
              <span className="text-[#71717A]"> picked · {pickedRows.map((r) => r.name ?? "Activity").join(", ")}</span>
            </p>
            {picked.length === 1 && (
              <button className="text-xs text-[#A1A1AA] hover:text-[#FAFAFA] shrink-0"
                      onClick={() => { setSimilarTo(picked[0]); setShowCompare(false); window.scrollTo({ top: 0 }); }}>
                Find similar
              </button>
            )}
            {picked.length >= 2 && (
              <ActionButton icon={GitCompareArrows} onClick={() => { setShowCompare(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                Compare {picked.length}
              </ActionButton>
            )}
            <button onClick={() => { setPicked([]); setShowCompare(false); }} className="text-[#52525B] hover:text-[#A1A1AA] shrink-0" title="Clear"><X size={14} /></button>
          </Panel>
        </div>
      )}
    </div>
  );
}
