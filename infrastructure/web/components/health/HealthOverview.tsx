"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ReferenceArea,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { HRContext } from "@/components/HRContext";
import { injuriesApi, type ActiveSummaryItem, ZONE_LABELS } from "@/lib/injuries-api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Day = {
  date: string; hrv: number | null; hrv_weekly: number | null; hrv_status: string | null;
  sleep_seconds: number | null; deep_seconds: number | null; rem_seconds: number | null; light_seconds: number | null;
  awake_seconds: number | null; sleep_score: number | null; resting_hr: number | null; stress_avg: number | null;
  body_battery_low: number | null; body_battery_high: number | null; steps: number | null;
  energy: number | null; mood: number | null; fatigue_score: number | null; recovery_status: string | null;
  sleep_debt: number | null;
};

const C = {
  hrv: "var(--viz-i4)", sleep: "var(--viz-spd)", deep: "var(--viz-deep)", rem: "var(--viz-rem)", light: "var(--viz-light)",
  rhr: "var(--viz-hr)", battery: "var(--viz-cad)", stress: "var(--viz-i5)", mood: "var(--viz-mood)", energy: "var(--viz-cad)",
  steps: "var(--viz-alt)", grid: "var(--viz-grid)", axis: "var(--viz-axis)", ref: "var(--viz-ref)",
};
const AXIS = { tick: { fill: C.axis, fontSize: 11 }, tickLine: false, axisLine: false } as const;
const TIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" }, itemStyle: { color: "#FAFAFA" },
};

const fmtD = (d: string) => format(parseISO(d), "d MMM");
const hm = (s: number | null | undefined) => (s ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : "—");
const vals = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x != null && !Number.isNaN(x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs: number[]) {
  const m = mean(xs);
  return m == null || xs.length < 3 ? null : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}
/** Change between the first and last third of the period (smoothed trend). */
function drift(xs: number[]) {
  if (xs.length < 9) return null;
  const k = Math.floor(xs.length / 3);
  return (mean(xs.slice(-k)) ?? 0) - (mean(xs.slice(0, k)) ?? 0);
}

function Card({ title, headline, unit, aside, verdict, children }: {
  title: string; headline: React.ReactNode; unit?: string; aside?: React.ReactNode; verdict?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{title}</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold tabular-nums">{headline}{unit && <span className="text-sm text-[#A1A1AA] font-normal"> {unit}</span>}</span>
          {aside && <span className="text-xs text-[#71717A] tabular-nums text-right">{aside}</span>}
        </div>
        {verdict && <p className="text-sm text-[#A1A1AA] mb-4">{verdict}</p>}
        {children}
      </div>
    </section>
  );
}

function Tiles({ items }: { items: { label: string; value: React.ReactNode; sub?: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      {items.map((t) => (
        <div key={t.label}>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{t.label}</p>
          <p className="text-base font-semibold tabular-nums">{t.value}</p>
          {t.sub && <p className="text-[11px] text-[#71717A] tabular-nums">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function Delta({ v, unit = "", goodUp = true, digits = 0 }: { v: number | null; unit?: string; goodUp?: boolean; digits?: number }) {
  if (v == null || Math.abs(v) < 10 ** -digits / 2) return <span className="text-[#71717A]">steady</span>;
  const good = goodUp ? v > 0 : v < 0;
  return <span className={good ? "text-emerald-400" : "text-amber-400"}>{v > 0 ? "↑" : "↓"} {Math.abs(v).toFixed(digits)}{unit}</span>;
}

// ── recovery hero ────────────────────────────────────────────────────────────
function RecoveryHero({ days }: { days: Day[] }) {
  const last = [...days].reverse().find((d) => d.hrv != null || d.sleep_seconds != null);
  if (!last) return null;
  const base = vals(days.slice(-30).map((d) => d.hrv));
  const hrvBase = mean(base), hrvSd = sd(base);
  const rhrBase = mean(vals(days.slice(-30).map((d) => d.resting_hr)));
  const hrvZ = last.hrv != null && hrvBase != null && hrvSd ? (last.hrv - hrvBase) / hrvSd : null;
  const sleepH = (last.sleep_seconds ?? 0) / 3600;

  let score = 0;
  if (hrvZ != null) score += hrvZ > 0.5 ? 2 : hrvZ > -0.5 ? 1 : hrvZ > -1.2 ? 0 : -1;
  if (last.sleep_seconds) score += sleepH >= 7.5 ? 2 : sleepH >= 6.5 ? 1 : 0;
  if (last.resting_hr && rhrBase) score += last.resting_hr <= rhrBase + 1 ? 1 : last.resting_hr <= rhrBase + 4 ? 0 : -1;
  const state = score >= 4 ? { label: "Recovered", tone: "text-emerald-400", note: "Green light — a good day for quality work." }
    : score >= 2 ? { label: "Steady", tone: "", note: "Normal day — train as planned, keep the easy days easy." }
    : { label: "Under-recovered", tone: "text-amber-400", note: "Signals are low — favour easy aerobic work or rest, sleep early." };

  const chip = (label: string, value: string, sub: React.ReactNode) => (
    <div className="bg-[#18181B] rounded-xl px-3 py-2.5">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-[#71717A] tabular-nums">{sub}</p>
    </div>
  );
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-5 mb-8">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">Last night · {format(parseISO(last.date), "EEE d MMM")}</p>
      <p className={`text-3xl font-semibold tracking-tight mt-1 ${state.tone}`}>{state.label}</p>
      <p className="text-sm text-[#A1A1AA] mt-1">{state.note}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {chip("HRV", last.hrv != null ? `${Math.round(last.hrv)} ms` : "—",
          hrvBase != null && last.hrv != null ? <Delta v={last.hrv - hrvBase} unit=" vs normal" /> : "")}
        {chip("Sleep", hm(last.sleep_seconds), last.sleep_score ? `score ${last.sleep_score}` : "")}
        {chip("Resting HR", last.resting_hr ? `${last.resting_hr} bpm` : "—",
          rhrBase && last.resting_hr ? <Delta v={last.resting_hr - rhrBase} goodUp={false} unit=" vs normal" /> : "")}
        {chip("Body battery", last.body_battery_high != null ? `${last.body_battery_high}` : "—",
          last.body_battery_low != null ? `low ${last.body_battery_low}` : "")}
      </div>
    </div>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
export function HealthOverview({ days: n }: { days: number }) {
  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), n - 1), "yyyy-MM-dd");
  // a longer window feeds the hero's 30-day "normal" even when the period is 2 weeks
  const start30 = format(subDays(new Date(), Math.max(n, 30) - 1), "yyyy-MM-dd");
  const { data: raw } = useQuery<Day[]>({
    queryKey: ["health-trends", start30, end],
    queryFn: () => fetch(`${BASE}/health/trends?start=${start30}&end=${end}`).then((r) => (r.ok ? r.json() : [])),
  });
  const { data: injuries = [] } = useQuery<ActiveSummaryItem[]>({ queryKey: ["injuries-active-summary"], queryFn: injuriesApi.activeSummary });
  const all = Array.isArray(raw) ? raw : [];
  const days = all.filter((d) => d.date >= start);

  // HRV
  const hrv = vals(days.map((d) => d.hrv));
  const hrvAvg = mean(hrv), hrvSd = sd(hrv);
  const hrvLow = days.filter((d) => d.hrv != null && hrvAvg != null && hrvSd && d.hrv < hrvAvg - hrvSd).length;
  // Sleep
  const sleep = vals(days.map((d) => d.sleep_seconds));
  const sleepAvg = mean(sleep), sleepSd = sd(sleep);
  const under7 = sleep.filter((s) => s < 7 * 3600).length;
  const stages = days.map((d) => {
    const deep = (d.deep_seconds ?? 0) / 3600, rem = (d.rem_seconds ?? 0) / 3600;
    const total = (d.sleep_seconds ?? 0) / 3600;
    const light = d.light_seconds != null ? d.light_seconds / 3600 : Math.max(0, total - deep - rem);
    return { date: d.date, deep, rem, light, total, score: d.sleep_score };
  });
  const deepPct = mean(stages.filter((s) => s.total > 0).map((s) => s.deep / s.total));
  const remPct = mean(stages.filter((s) => s.total > 0).map((s) => s.rem / s.total));
  const bestNight = [...days].filter((d) => d.sleep_score != null).sort((a, b) => (b.sleep_score ?? 0) - (a.sleep_score ?? 0))[0];
  // Resting HR
  const rhr = vals(days.map((d) => d.resting_hr));
  const rhrAvg = mean(rhr);
  // Battery
  const bat = days.map((d) => ({ date: d.date, range: d.body_battery_low != null && d.body_battery_high != null ? [d.body_battery_low, d.body_battery_high] : null }));
  const batHigh = mean(vals(days.map((d) => d.body_battery_high)));
  const batLow = mean(vals(days.map((d) => d.body_battery_low)));
  // Stress / mood
  const stress = vals(days.map((d) => d.stress_avg));
  const stressAvg = mean(stress);
  const moodAvg = mean(vals(days.map((d) => d.mood))), energyAvg = mean(vals(days.map((d) => d.energy)));
  // Steps
  const steps = vals(days.map((d) => d.steps));
  const stepsAvg = mean(steps);
  const over10k = steps.filter((s) => s >= 10000).length;

  const xTicks = { dataKey: "date", tickFormatter: fmtD, interval: "preserveStartEnd" as const, minTickGap: 28, ...AXIS };
  const activeInj = injuries.filter((i) => i.status === "active");

  return (
    <>
      <RecoveryHero days={all} />

      {injuries.length > 0 && (
        <Link href="/health/injuries" className="block mb-8">
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl px-4 py-3 flex items-center justify-between hover:bg-orange-500/15 transition-colors">
            <div>
              <p className="text-sm font-medium text-orange-400">
                ⚠ {activeInj.length ? `${activeInj.length} active injur${activeInj.length === 1 ? "y" : "ies"}` : `${injuries.length} recovering`}
              </p>
              <p className="text-xs text-[#A1A1AA] mt-0.5">
                {injuries.slice(0, 3).map((i) => `${ZONE_LABELS[i.zone] ?? i.zone}${i.side ? ` (${i.side})` : ""} ${i.pain_scale}/10`).join(" · ")}
              </p>
            </div>
            <span className="text-xs text-[#71717A]">View →</span>
          </div>
        </Link>
      )}

      {hrv.length > 2 && (
        <Card title="Heart-rate variability" headline={Math.round(hrvAvg ?? 0)} unit="ms avg"
              aside={<>range {Math.round(Math.min(...hrv))}–{Math.round(Math.max(...hrv))}<br /><Delta v={drift(hrv)} unit=" ms over the period" /></>}
              verdict={hrvLow === 0 ? "Every night inside your normal range — recovery is keeping up."
                : `${hrvLow} night${hrvLow > 1 ? "s" : ""} below your normal range — usually hard days, travel, alcohol or short sleep.`}>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={days} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis domain={["dataMin - 5", "dataMax + 5"]} allowDecimals={false} {...AXIS} />
              {hrvAvg != null && hrvSd != null && (
                <ReferenceArea y1={hrvAvg - hrvSd} y2={hrvAvg + hrvSd} fill={C.hrv} fillOpacity={0.08} ifOverflow="hidden" />
              )}
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))}
                       formatter={(v, name) => [`${Math.round(Number(v))} ms`, name === "hrv_weekly" ? "7-day avg" : "Night"]} />
              <Line dataKey="hrv_weekly" stroke={C.ref} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
              <Line dataKey="hrv" stroke={C.hrv} strokeWidth={2} isAnimationActive={false} connectNulls
                    dot={(p: { cx?: number; cy?: number; payload?: Day; index?: number }) => {
                      const low = p.payload?.hrv != null && hrvAvg != null && hrvSd != null && p.payload.hrv < hrvAvg - hrvSd;
                      return low ? <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill={C.hrv} stroke="var(--viz-gap)" strokeWidth={1.5} />
                        : <g key={p.index} />;
                    }} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-[#71717A] mt-1">Shaded = your normal range (avg ± 1 sd) · dots = low nights · dashed = 7-day avg</p>
        </Card>
      )}

      {sleep.length > 2 && (
        <Card title="Sleep" headline={hm(sleepAvg)} unit="avg"
              aside={<>{days.some((d) => d.sleep_score) ? `score ${Math.round(mean(vals(days.map((d) => d.sleep_score))) ?? 0)}` : ""}<br />±{Math.round((sleepSd ?? 0) / 60)} min night to night</>}
              verdict={under7 === 0 ? "7 h+ every night — excellent." : `${under7} of ${sleep.length} nights under 7 h${(sleepSd ?? 0) > 3600 ? " · bedtime is irregular" : ""}.`}>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={stages} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis allowDecimals={false} tickFormatter={(v) => `${v}h`} {...AXIS} />
              <ReferenceLine y={7} stroke={C.ref} strokeDasharray="4 4" label={{ value: "7 h", fill: C.axis, fontSize: 10, position: "insideTopRight" }} />
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))}
                       formatter={(v, name) => [hm(Number(v) * 3600), String(name)]} />
              <Bar dataKey="deep" name="Deep" stackId="s" fill={C.deep} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="rem" name="REM" stackId="s" fill={C.rem} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="light" name="Light" stackId="s" fill={C.light} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-3 text-[11px] text-[#71717A] mt-2">
            {[["Deep", C.deep], ["REM", C.rem], ["Light", C.light]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </div>
          <Tiles items={[
            { label: "Deep", value: deepPct != null ? `${Math.round(deepPct * 100)}%` : "—", sub: "of sleep · 15–25% ideal" },
            { label: "REM", value: remPct != null ? `${Math.round(remPct * 100)}%` : "—", sub: "20–25% ideal" },
            { label: "Best night", value: bestNight ? hm(bestNight.sleep_seconds) : "—", sub: bestNight ? `${fmtD(bestNight.date)} · ${bestNight.sleep_score}` : undefined },
          ]} />
        </Card>
      )}

      {rhr.length > 2 && (
        <Card title="Resting heart rate" headline={Math.round(rhrAvg ?? 0)} unit="bpm avg"
              aside={<>range {Math.min(...rhr)}–{Math.max(...rhr)}<br /><Delta v={drift(rhr)} goodUp={false} unit=" bpm over the period" /></>}
              verdict={(drift(rhr) ?? 0) <= -1 ? "Trending down — a classic sign of improving fitness."
                : (drift(rhr) ?? 0) >= 2 ? "Creeping up — watch for fatigue, illness or poor sleep." : "Stable."}>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={days} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} {...AXIS} />
              {rhrAvg != null && <ReferenceLine y={rhrAvg} stroke={C.ref} strokeDasharray="4 4" />}
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))} formatter={(v) => [`${v} bpm`, "Resting HR"]} />
              <Line dataKey="resting_hr" stroke={C.rhr} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <HRContext days={n} />

      {bat.some((b) => b.range) && (
        <Card title="Body battery" headline={Math.round(batHigh ?? 0)} unit="avg peak"
              aside={`avg low ${Math.round(batLow ?? 0)}`}
              verdict={(batHigh ?? 0) >= 80 ? "Charging well overnight." : (batHigh ?? 0) >= 60 ? "Partial recharge most nights."
                : "Rarely fully recharged — sleep and stress are draining you."}>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={bat} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} {...AXIS} />
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))}
                       formatter={(v) => { const r = v as unknown as number[]; return [`${r?.[0]} → ${r?.[1]}`, "Low → peak"]; }} />
              <Bar dataKey="range" fill={C.battery} radius={[3, 3, 3, 3]} maxBarSize={12} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-[#71717A] mt-1">Each bar spans the day&apos;s lowest to highest charge.</p>
        </Card>
      )}

      {stress.length > 2 && (
        <Card title="Stress" headline={Math.round(stressAvg ?? 0)} unit="avg / 100"
              aside={<Delta v={drift(stress)} goodUp={false} unit=" over the period" />}
              verdict={(stressAvg ?? 0) < 26 ? "Mostly rest-level stress." : (stressAvg ?? 0) < 51 ? "Low-to-medium stress — normal for working days."
                : "Medium-to-high — more calm time and earlier nights would help."}>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={days} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} />
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))} formatter={(v) => [v, "Stress"]} />
              <Area dataKey="stress_avg" stroke={C.stress} fill={C.stress} fillOpacity={0.15} strokeWidth={2} connectNulls isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {(moodAvg != null || energyAvg != null) && (
        <Card title="Mood & energy" headline={moodAvg != null ? moodAvg.toFixed(1) : "—"} unit="mood / 10"
              aside={energyAvg != null ? `energy ${energyAvg.toFixed(1)}` : undefined}
              verdict="From your daily check-in.">
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={days} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis domain={[0, 10]} ticks={[0, 5, 10]} {...AXIS} />
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))} />
              <Line dataKey="mood" name="Mood" stroke={C.mood} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="energy" name="Energy" stroke={C.energy} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-3 text-[11px] text-[#71717A] mt-2">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: C.mood }} />Mood</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: C.energy }} />Energy</span>
          </div>
        </Card>
      )}

      {steps.length > 2 && (
        <Card title="Steps" headline={Math.round(stepsAvg ?? 0).toLocaleString()} unit="avg / day"
              aside={`${over10k} of ${steps.length} days ≥ 10k`}
              verdict={(stepsAvg ?? 0) >= 10000 ? "Very active days." : (stepsAvg ?? 0) >= 7000 ? "Active." : "Fairly sedentary days — flight and desk days add up."}>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={days} syncId="health" margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="2 4" />
              <XAxis {...xTicks} />
              <YAxis tickFormatter={(v) => (v ? `${Math.round(v / 1000)}k` : "0")} allowDecimals={false} {...AXIS} />
              <ReferenceLine y={10000} stroke={C.ref} strokeDasharray="4 4" />
              <Tooltip {...TIP} labelFormatter={(d) => fmtD(String(d))} formatter={(v) => [Number(v).toLocaleString(), "Steps"]} />
              <Bar dataKey="steps" fill={C.steps} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </>
  );
}
