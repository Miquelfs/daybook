"use client";

import { useId } from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, CartesianGrid,
} from "recharts";
import type { ActivityAnalysis, AnalysisIntervals, ZoneShare, Climb } from "@/lib/api";

// ── tokens (defined in globals.css, themed for dark + paper) ──────────────────
const I = ["--viz-i1", "--viz-i2", "--viz-i3", "--viz-i4", "--viz-i5", "--viz-i6", "--viz-i7"].map((v) => `var(${v})`);
const HR_RAMP = [I[0], I[2], I[3], I[4], I[6]];          // 5 zones
const PW_RAMP = I;                                       // 7 zones
const C = {
  hr: "var(--viz-hr)", spd: "var(--viz-spd)", pw: "var(--viz-pw)", alt: "var(--viz-alt)", cad: "var(--viz-cad)",
  grid: "var(--viz-grid)", axis: "var(--viz-axis)", ref: "var(--viz-ref)", gap: "var(--viz-gap)",
};
const SYNC = "activity";
const AXIS = { tick: { fill: C.axis, fontSize: 11 }, axisLine: false, tickLine: false } as const;

// ── formatting ───────────────────────────────────────────────────────────────
const kmh = (mps: number) => mps * 3.6;
function paceFromKmh(v: number): string {
  if (!v || v <= 0) return "—";
  const s = 3600 / v;
  return `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, "0")}`;
}
function hms(s: number | null | undefined): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : m >= 10 ? `${m} min` : `${m}:${sec.toString().padStart(2, "0")}`;
}
/** Race-clock time: 4:09, 23:12, 1:02:10. */
function clock(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  const ss = sec.toString().padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
const xLabel = (unit: "km" | "min") => (v: number) => (unit === "km" ? `${v.toFixed(1)} km` : `${Math.round(v)} min`);

// ── building blocks ──────────────────────────────────────────────────────────
function Card({ title, headline, unit, aside, verdict, children }: {
  title: string; headline: React.ReactNode; unit?: string; aside?: React.ReactNode; verdict?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{title}</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold tabular-nums">
            {headline}
            {unit && <span className="text-sm text-[#A1A1AA] font-normal"> {unit}</span>}
          </span>
          {aside && <span className="text-xs text-[#71717A] tabular-nums text-right">{aside}</span>}
        </div>
        {verdict && <p className="text-sm text-[#A1A1AA] mb-4">{verdict}</p>}
        {children}
      </div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  if (value === null || value === undefined || value === "—") return null;
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#71717A] tabular-nums">{sub}</p>}
    </div>
  );
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">{children}</div>;
}

/** Stacked share bar with 2px surface gaps + one legend row per zone (minutes, range, share). */
function ZoneBar({ zones, ramp, unit }: { zones: ZoneShare[]; ramp: string[]; unit: string }) {
  const shown = zones.filter((z) => z.secs > 0);
  return (
    <div className="mb-4">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px] mb-3" role="img"
           aria-label={zones.map((z) => `${z.zone} ${z.pct}%`).join(", ")}>
        {shown.map((z) => (
          <div key={z.zone} style={{ flexGrow: z.secs, flexBasis: 0, background: ramp[zones.indexOf(z)] }}
               title={`${z.zone} ${z.label}: ${hms(z.secs)} (${z.pct}%)`} />
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Time in zone · ranges in {unit}</p>
        {zones.map((z, i) => (
          <div key={z.zone} className="flex items-center gap-2 text-xs" title={`${z.zone} ${z.label}: ${z.hi == null ? `${z.lo}+` : `${z.lo}–${z.hi}`} ${unit}`}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ramp[i] }} />
            <span className="text-[#A1A1AA] w-24 shrink-0">{z.zone} {z.label}</span>
            <span className="text-[#52525B] w-[4.5rem] shrink-0 tabular-nums whitespace-nowrap">
              {z.hi == null ? `${z.lo}+` : `${z.lo}–${z.hi}`}
            </span>
            <div className="flex-1 h-1.5 bg-[#18181B] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${z.pct}%`, background: ramp[i] }} />
            </div>
            <span className="text-[#A1A1AA] tabular-nums w-[6.5rem] text-right whitespace-nowrap">
              {z.secs > 0 ? `${hms(z.secs)} · ${z.pct}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitBar({ parts }: { parts: { label: string; pct: number; color: string }[] }) {
  const shown = parts.filter((p) => p.pct > 0);
  return (
    <div className="mb-4">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px] mb-2">
        {shown.map((p) => <div key={p.label} style={{ flexGrow: p.pct, flexBasis: 0, background: p.color }} />)}
      </div>
      <div className="flex justify-between text-xs text-[#71717A] tabular-nums">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.label} {p.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function ChartTip({ active, payload, label, unit, fmt, name }: {
  active?: boolean; payload?: { value: number }[]; label?: number; unit: "km" | "min";
  fmt: (v: number) => string; name: string;
}) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="bg-[#09090B] border border-[#27272A] rounded-lg px-2.5 py-1.5 text-xs shadow">
      <p className="text-[#71717A]">{xLabel(unit)(Number(label))}</p>
      <p className="text-[#FAFAFA] tabular-nums">{name} {fmt(payload[0].value)}</p>
    </div>
  );
}

/** One measure over distance/time. Crosshair is synced across every chart on the page. */
function SeriesChart({ data, k, color, unit, name, fmt, domain, height = 130, children, area = false, yTick, reversed }: {
  data: (ActivityAnalysis["series"]["points"][number] & { pace?: number })[]; k: "hr" | "spd" | "pw" | "cad" | "pace";
  color: string; unit: "km" | "min"; name: string; fmt: (v: number) => string;
  domain?: [number | string, number | string]; height?: number; children?: React.ReactNode; area?: boolean;
  yTick?: (v: number) => string; reversed?: boolean;
}) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} syncId={SYNC} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="2 4" />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={xLabel(unit)} {...AXIS}
               minTickGap={40} />
        <YAxis domain={domain ?? ["auto", "auto"]} tickFormatter={yTick ?? ((v: number) => `${Math.round(v)}`)}
               width={44} reversed={reversed} allowDecimals={false} {...AXIS} />
        {children}
        <Tooltip cursor={{ stroke: C.ref, strokeWidth: 1 }}
                 content={<ChartTip unit={unit} fmt={fmt} name={name} />} />
        {area ? (
          <Area type="monotone" dataKey={k} stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2}
                dot={false} isAnimationActive={false} connectNulls={false} />
        ) : (
          <Line type="monotone" dataKey={k} stroke={color} strokeWidth={2} dot={false}
                isAnimationActive={false} connectNulls={false} />
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

// ── cards ────────────────────────────────────────────────────────────────────
function HeartRateCard({ a }: { a: ActivityAnalysis }) {
  const hr = a.hr!;
  const pts = a.series.points;
  const plan = hr.plan;
  return (
    <Card title="Heart rate" headline={hr.avg} unit="bpm avg" aside={`max ${hr.max} bpm`} verdict={hr.verdict}>
      {plan && (
        <p className={`text-xs mb-4 -mt-2 ${plan.ok ? "text-emerald-400" : "text-amber-400"}`}>
          {plan.ok ? "✓" : "△"} Planned {plan.zone} — {plan.reps
            ? `HR reached ${plan.zone} in ${plan.reps_reaching} of ${plan.reps} reps (it lags short reps — pace is the better gauge)`
            : `${plan.pct_at_or_below}% at or below ${plan.zone}`}
        </p>
      )}
      <ZoneBar zones={hr.zones} ramp={HR_RAMP} unit="bpm" />
      {pts.some((p) => p.hr) && (
        <div className="mb-4">
          <SeriesChart data={pts} k="hr" color={C.hr} unit={a.series.x_unit} name="HR" area
                       fmt={(v) => `${Math.round(v)} bpm`} domain={["dataMin - 8", "dataMax + 4"]}>
            {hr.zones.slice(1).map((z, i) => (
              <ReferenceArea key={z.zone} y1={z.lo} y2={z.hi ?? z.lo + 40} fill={HR_RAMP[i + 1]} fillOpacity={0.07}
                             ifOverflow="hidden" />
            ))}
            {hr.threshold_hr && (
              <ReferenceLine y={hr.threshold_hr} stroke={C.ref} strokeDasharray="4 4"
                             label={{ value: "threshold", fill: C.axis, fontSize: 10, position: "insideTopRight" }} />
            )}
          </SeriesChart>
        </div>
      )}
      <Tiles>
        <Tile label="Best 20 min" value={hr.peak_20min ? `${hr.peak_20min} bpm` : null} />
        <Tile label="HR drift" value={hr.drift_bpm != null ? `${hr.drift_bpm > 0 ? "+" : ""}${hr.drift_bpm} bpm` : null}
              sub="last third vs first" />
        <Tile label="Durability"
              value={hr.decoupling_pct != null ? `${hr.decoupling_pct.toFixed(1)}%` : null}
              sub={hr.durability === "durable" ? "pace held, HR steady" : hr.durability === "borderline"
                ? "some cardiac drift" : hr.durability === "fading" ? "HR rose for the same output" : undefined} />
        {hr.above_threshold_min != null && hr.above_threshold_min > 0 && (
          <Tile label="Above threshold" value={`${hr.above_threshold_min} min`} />
        )}
      </Tiles>
    </Card>
  );
}

function PaceCard({ a }: { a: ActivityAnalysis }) {
  const p = a.pace!;
  const run = a.sport === "run" || a.sport === "hike";
  const fmt = (mps: number | null) => (mps == null ? null : run ? `${paceFromKmh(kmh(mps))} /km` : `${kmh(mps).toFixed(1)} km/h`);
  const avgKmh = kmh(p.avg_mps);
  const pts = a.series.points;
  const terrain = [
    { label: "Climbing", v: p.climb_mps, pct: p.terrain_pct.climb },
    { label: "Flat", v: p.flat_mps, pct: p.terrain_pct.flat },
    { label: "Descending", v: p.descent_mps, pct: p.terrain_pct.descent },
  ].filter((t) => t.v != null);
  const maxV = Math.max(...terrain.map((t) => t.v as number), 0.1);
  // run pace chart: s/km, walk breaks (< 3 km/h) dropped, clipped at 1.6× avg; axis on 15 s steps
  const pacePts = run
    ? pts.map((x) => ({ ...x, pace: x.spd && x.spd > 3 ? Math.min(3600 / x.spd, (3600 / avgKmh) * 1.6) : undefined }))
    : [];
  const paces = pacePts.map((x) => x.pace).filter((v): v is number => v != null);
  const paceDomain: [number, number] = paces.length
    ? [Math.floor((Math.min(...paces) - 5) / 15) * 15, Math.ceil((Math.max(...paces) + 5) / 15) * 15]
    : [0, 600];
  return (
    <Card title={run ? "Pace" : "Speed"}
          headline={run ? paceFromKmh(avgKmh) : avgKmh.toFixed(1)} unit={run ? "/km avg" : "km/h avg"}
          aside={<>moving {hms(p.moving_s)}{p.stopped_s > 60 && <><br />stopped {hms(p.stopped_s)}</>}</>}
          verdict={p.verdict}>
      {pts.some((x) => x.spd) && (run ? (
        <div className="mb-4">
          {/* pace on a reversed axis: faster = higher */}
          <SeriesChart data={pacePts}
                       k="pace" color={C.spd} unit={a.series.x_unit} name="Pace" reversed
                       fmt={(v) => `${clock(v)} /km`} yTick={(v) => clock(v)} domain={paceDomain}>
            <ReferenceLine y={3600 / avgKmh} stroke={C.ref} strokeDasharray="4 4"
                           label={{ value: "avg", fill: C.axis, fontSize: 10, position: "insideTopRight" }} />
          </SeriesChart>
        </div>
      ) : (
        <div className="mb-4">
          <SeriesChart data={pts} k="spd" color={C.spd} unit={a.series.x_unit} name="Speed"
                       fmt={(v) => `${v.toFixed(1)} km/h`} domain={[0, "dataMax + 2"]}>
            <ReferenceLine y={avgKmh} stroke={C.ref} strokeDasharray="4 4"
                           label={{ value: "avg", fill: C.axis, fontSize: 10, position: "insideTopRight" }} />
          </SeriesChart>
        </div>
      ))}
      {terrain.length > 1 && (
        <div className="mb-4 space-y-1.5">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">By terrain</p>
          {terrain.map((t) => (
            <div key={t.label} className="flex items-center gap-2 text-xs">
              <span className="text-[#A1A1AA] w-20 shrink-0">{t.label}</span>
              <div className="flex-1 h-1.5 bg-[#18181B] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${((t.v as number) / maxV) * 100}%`, background: C.spd }} />
              </div>
              <span className="text-[#FAFAFA] tabular-nums w-20 text-right">{fmt(t.v)}</span>
              <span className="text-[#52525B] tabular-nums w-10 text-right">{t.pct}%</span>
            </div>
          ))}
        </div>
      )}
      {a.intervals && <RepsTable iv={a.intervals} run={run} />}
      <Tiles>
        {p.split && (
          <Tile label={a.sport === "ride" ? "Halves (flats)" : "Halves"}
                value={`${p.split.pct > 0 ? "+" : ""}${p.split.pct}%`}
                sub={`${fmt(p.split.first_mps)} → ${fmt(p.split.second_mps)}`} />
        )}
        {p.gap_mps && <Tile label="Grade-adjusted" value={fmt(p.gap_mps)} sub="effort-equivalent flat pace" />}
        {run && p.consistency_cv != null && (
          <Tile label="Steadiness" value={p.consistency_cv <= 8 ? "Steady" : p.consistency_cv <= 15 ? "Variable" : "Choppy"}
                sub={`±${p.consistency_cv}% on flat ground`} />
        )}
        {!run && Object.entries(p.best).map(([label, v]) => (
          <Tile key={label} label={`Best ${label}`} value={run ? clock(v) : `${v.toFixed(1)} km/h`}
                sub={run ? `${paceFromKmh((Number(label.split(" ")[0]) * 3600) / v)} /km` : undefined} />
        ))}
      </Tiles>
    </Card>
  );
}

/** The work set, rep by rep — what an interval session is actually judged on. */
function RepsTable({ iv, run }: { iv: AnalysisIntervals; run: boolean }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">
        Reps · found from {iv.source}{iv.avg_recovery_s ? ` · ~${clock(iv.avg_recovery_s)} recoveries` : ""}
      </p>
      <div className="text-xs tabular-nums">
        {iv.reps.map((r, i) => (
          <div key={i} className="flex items-center gap-3 py-1 border-b border-[#18181B] last:border-0">
            <span className="text-[#52525B] w-5">{i + 1}</span>
            <span className="text-[#A1A1AA] w-12">{clock(r.secs)}</span>
            <span className="text-[#FAFAFA] font-medium w-20">
              {run && r.pace_s_km ? `${clock(r.pace_s_km)} /km` : r.avg_w ? `${r.avg_w} W` : "—"}
            </span>
            {run && r.avg_w ? <span className="text-[#71717A] w-14">{r.avg_w} W</span> : null}
            <span className="text-[#71717A] ml-auto">
              {r.max_hr ? `HR ${r.avg_hr}→${r.max_hr}` : ""}{r.zone_reached ? ` · ${r.zone_reached}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** How the watts were estimated, and how far to trust them. */
function EstimateNote({ e }: { e: NonNullable<NonNullable<ActivityAnalysis["power"]>["estimated"]> }) {
  const m = e.hr_model;
  return (
    <p className="text-xs text-[#71717A] -mt-2 mb-4 leading-relaxed">
      No power meter — physics from speed, gradient{e.wind ? ", wind" : ""} and {e.mass_kg} kg (rider + bike)
      {m ? <>, blended on the flats with your heart rate → power line from {m.rides} trainer ride{m.rides > 1 ? "s" : ""} (±{m.rmse_w} W)</> : null}.
      {e.climb_agreement_pct != null
        ? <> On {e.climb_min} min of climbing the HR line read {Math.abs(e.climb_agreement_pct)}% {e.climb_agreement_pct < 0 ? "low" : "high"} — rescaled to match physics there.</>
        : m && e.hr_scale !== 1 ? <> HR line scaled ×{e.hr_scale} (your usual outdoor offset).</> : null}
      {" "}Climbs ±5%, flats ±10–15%.
    </p>
  );
}

function PowerCard({ a }: { a: ActivityAnalysis }) {
  const p = a.power!;
  const pts = a.series.points;
  const maxBest = Math.max(...p.bests.map((b) => b.watts), 1);
  return (
    <Card title={a.sport === "run" ? "Running power" : p.indoor ? "Power · trainer" : p.estimated ? "Power · estimated" : "Power"}
          headline={p.estimated ? <>~{p.np ?? p.avg}</> : p.np ?? p.avg} unit={p.np ? "W normalized" : "W avg"}
          aside={<>avg {p.avg} W · max {p.max} W{p.ftp && <><br />FTP {p.ftp} W</>}</>} verdict={p.verdict}>
      {p.estimated && <EstimateNote e={p.estimated} />}
      {pts.some((x) => x.pw) && (
        <div className="mb-4">
          <SeriesChart data={pts} k="pw" color={C.pw} unit={a.series.x_unit} name="Power" area
                       fmt={(v) => `${Math.round(v)} W`} domain={[0, "dataMax + 20"]}>
            {p.ftp && (
              <ReferenceLine y={p.ftp} stroke={C.ref} strokeDasharray="4 4"
                             label={{ value: "FTP", fill: C.axis, fontSize: 10, position: "insideTopRight" }} />
            )}
          </SeriesChart>
        </div>
      )}
      <Tiles>
        <Tile label="Intensity" value={p.if != null ? p.if.toFixed(2) : null} sub="NP ÷ FTP" />
        <Tile label="Load" value={p.tss != null ? `${p.tss} TSS` : null} />
        {/* kJ ≈ kcal is a cycling rule (~24% efficiency cancels the 4.18 kJ/kcal) — running power isn't on that scale */}
        <Tile label="Work" value={`${p.kj} kJ`} sub={a.sport === "ride" ? `≈ ${p.kj} kcal burned` : undefined} />
        <Tile label="Variability" value={p.vi != null ? p.vi.toFixed(2) : null}
              sub={p.vi == null ? undefined : p.vi < 1.05 ? "smooth" : p.vi < 1.15 ? "some surges" : "surgy"} />
        <Tile label="W/kg" value={p.wkg != null ? p.wkg.toFixed(2) : null} />
      </Tiles>
      {p.bests.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">Best efforts this {a.sport === "run" ? "run" : "ride"}</p>
          <div className="flex items-end gap-2 h-24">
            {p.bests.map((b) => (
              <div key={b.secs} className="flex-1 flex flex-col items-center justify-end h-full"
                   title={`${b.label}: ${b.watts} W${b.pct_ftp ? ` (${b.pct_ftp}% FTP)` : ""}`}>
                <span className="text-[11px] text-[#FAFAFA] tabular-nums mb-1">{b.watts}</span>
                <div className="w-full rounded-t" style={{ height: `${(b.watts / maxBest) * 70}%`, background: C.pw }} />
                <span className="text-[10px] text-[#71717A] mt-1">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {p.zones ? <ZoneBar zones={p.zones} ramp={PW_RAMP} unit="W" />
        : a.sport === "ride" && <p className="text-xs text-[#71717A]">Set your FTP (Training → zones) to see power zones and intensity.</p>}
    </Card>
  );
}

function gradeColor(g: number | undefined): string {
  if (g == null || g < 2) return C.alt;
  if (g < 4) return I[2];
  if (g < 7) return I[3];
  if (g < 10) return I[4];
  return I[6];
}

function ElevationCard({ a }: { a: ActivityAnalysis }) {
  const e = a.elevation!;
  const pts = a.series.points.filter((p) => p.alt != null);
  const gid = `grade${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // horizontal gradient: hard stops wherever the grade bucket changes
  const x0 = pts[0]?.x ?? 0, x1 = pts[pts.length - 1]?.x ?? 1;
  const stops: { o: number; c: string }[] = [];
  pts.forEach((p, i) => {
    const c = gradeColor(p.grade);
    const o = ((p.x - x0) / Math.max(1e-6, x1 - x0)) * 100;
    if (i === 0 || stops[stops.length - 1].c !== c) {
      if (i > 0) stops.push({ o, c: stops[stops.length - 1].c });
      stops.push({ o, c });
    }
  });
  stops.push({ o: 100, c: stops[stops.length - 1]?.c ?? C.alt });
  const climbs = [...e.climbs].sort((p, q) => q.gain_m - p.gain_m).slice(0, 6).sort((p, q) => p.from_km - q.from_km);
  return (
    <Card title="Elevation" headline={`↑ ${e.gain_m}`} unit="m"
          aside={<>↓ {e.loss_m} m<br />{e.min_m}–{e.max_m} m</>} verdict={e.verdict}>
      <div className="mb-2">
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={pts} syncId={SYNC} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
                {stops.map((s, i) => <stop key={i} offset={`${s.o}%`} stopColor={s.c} />)}
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="2 4" />
            <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={xLabel("km")} minTickGap={40} {...AXIS} />
            <YAxis domain={[(m: number) => Math.max(0, Math.floor((m - 15) / 10) * 10), (m: number) => Math.ceil((m + 15) / 10) * 10]}
                   tickFormatter={(v: number) => `${Math.round(v)}`} allowDecimals={false} width={44} {...AXIS} />
            {climbs.map((c) => (
              <ReferenceArea key={c.from_km} x1={c.from_km} x2={c.to_km} fill={C.ref} fillOpacity={0.06} ifOverflow="hidden" />
            ))}
            <Tooltip cursor={{ stroke: C.ref, strokeWidth: 1 }}
                     content={({ active, payload, label }) => {
                       const p = payload?.[0]?.payload as { alt?: number; grade?: number } | undefined;
                       if (!active || !p) return null;
                       return (
                         <div className="bg-[#09090B] border border-[#27272A] rounded-lg px-2.5 py-1.5 text-xs shadow">
                           <p className="text-[#71717A]">{Number(label).toFixed(1)} km</p>
                           <p className="text-[#FAFAFA] tabular-nums">{Math.round(p.alt ?? 0)} m
                             {p.grade != null && <span className="text-[#A1A1AA]"> · {p.grade > 0 ? "+" : ""}{p.grade}%</span>}
                           </p>
                         </div>
                       );
                     }} />
            <Area type="monotone" dataKey="alt" stroke={`url(#${gid})`} fill={`url(#${gid})`} fillOpacity={0.35}
                  strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#71717A] mb-4">
        {[["< 2%", C.alt], ["2–4%", I[2]], ["4–7%", I[3]], ["7–10%", I[4]], ["10%+", I[6]]].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: c }} />{l}</span>
        ))}
      </div>
      <SplitBar parts={[
        { label: "Climbing", pct: e.terrain_pct.climb, color: I[4] },
        { label: "Flat", pct: e.terrain_pct.flat, color: C.alt },
        { label: "Descending", pct: e.terrain_pct.descent, color: C.spd },
      ]} />
      <Tiles>
        <Tile label="Steepest 200 m" value={`${e.max_grade}%`} />
        <Tile label="Climbing density" value={`${e.m_per_km} m/km`} />
      </Tiles>
      {climbs.length > 0 && <ClimbList climbs={climbs} />}
    </Card>
  );
}

function ClimbList({ climbs }: { climbs: Climb[] }) {
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">Climbs</p>
      <div className="flex flex-col gap-2">
        {climbs.map((c) => (
          <div key={c.from_km} className="flex items-center gap-3 bg-[#18181B] rounded-lg px-3 py-2.5">
            <span className="text-[10px] font-semibold w-9 text-center py-0.5 rounded shrink-0 text-[#FAFAFA]"
                  style={{ background: gradeColor(c.avg_grade) }}>
              {c.category ? (c.category === "HC" ? "HC" : `Cat ${c.category}`) : "—"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm tabular-nums">
                {c.gain_m} m · {c.length_km} km at {c.avg_grade}%
                <span className="text-[#71717A]"> (max {c.max_grade}%)</span>
              </p>
              <p className="text-xs text-[#71717A] tabular-nums">
                km {c.from_km}–{c.to_km}
                {c.duration_s ? ` · ${hms(c.duration_s)}` : ""}
                {c.vam ? ` · VAM ${c.vam} m/h` : ""}
                {c.avg_hr ? ` · ${c.avg_hr} bpm` : ""}
                {c.avg_w ? ` · ${c.avg_w} W` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CadenceCard({ a }: { a: ActivityAnalysis }) {
  const c = a.cadence!;
  const max = Math.max(...c.bands.map((b) => b.pct), 1);
  return (
    <Card title="Cadence" headline={c.avg} unit={`${c.unit} avg`} aside={`max ${c.max} ${c.unit}`} verdict={c.verdict}>
      <div className="flex items-end gap-2 h-20">
        {c.bands.map((b) => (
          <div key={b.band} className="flex-1 flex flex-col items-center justify-end h-full" title={`${b.band}: ${b.pct}%`}>
            <span className="text-[11px] text-[#A1A1AA] tabular-nums mb-1">{b.pct}%</span>
            <div className="w-full rounded-t" style={{ height: `${(b.pct / max) * 60}%`, minHeight: b.pct ? 2 : 0, background: C.cad }} />
            <span className="text-[10px] text-[#71717A] mt-1">{b.band}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── page section ─────────────────────────────────────────────────────────────
export function ActivityAnalysisCards({ analysis }: { analysis: ActivityAnalysis }) {
  const a = analysis;
  return (
    <>
      {a.hr && <HeartRateCard a={a} />}
      {a.pace && <PaceCard a={a} />}
      {a.power && <PowerCard a={a} />}
      {a.elevation && <ElevationCard a={a} />}
      {a.cadence && <CadenceCard a={a} />}
    </>
  );
}
