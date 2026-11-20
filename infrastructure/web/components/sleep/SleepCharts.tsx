"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { format, parseISO, startOfISOWeek, addDays } from "date-fns";
import type { SleepNight } from "@/lib/api";

export const STAGE = {
  deep: { label: "Deep", color: "var(--viz-deep)" },
  rem: { label: "REM", color: "var(--viz-rem)" },
  light: { label: "Light", color: "var(--viz-light)" },
  awake: { label: "Awake", color: "var(--viz-i5)" },
} as const;

const AXIS = { fontSize: 10, fill: "var(--viz-axis)" };
const TOOLTIP_BOX = "rounded-lg border border-[#27272A] bg-[#0D0D0F] px-3 py-2 text-xs shadow-none";
/** More nights than this and each bar becomes a week's average — 180 bars of 2 px say nothing. */
const WEEKLY_FROM = 45;

export function hm(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
/** Bed/wake on one axis that runs 18:00 → 14:00 next day (minutes after 18:00). */
const onAxis = (t: string | null) => { const m = toMin(t); return m == null ? null : (m - 18 * 60 + 1440) % 1440; };
const axisClock = (v: number) => { const m = (v + 18 * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

type Row = {
  key: string; label: string; weekly: boolean; nights: number;
  deep: number | null; rem: number | null; light: number | null; awake: number | null; asleep: number | null;
  score: number | null; bed: number | null; wake: number | null; window: [number, number] | null;
};

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const h = (s: number | null | undefined) => (s ? +(s / 3600).toFixed(2) : null);

/** One row per night — every date of the period, so a night without data is a gap, not a squeezed bar —
 *  or per ISO week when the period is long. */
function rows(nights: SleepNight[], start: string, end: string): Row[] {
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const dates: string[] = [];
  for (let d = parseISO(start); format(d, "yyyy-MM-dd") <= end; d = addDays(d, 1)) dates.push(format(d, "yyyy-MM-dd"));
  const weekly = dates.length > WEEKLY_FROM;
  const groups = new Map<string, SleepNight[]>();
  for (const d of dates) {
    const key = weekly ? format(startOfISOWeek(parseISO(d)), "yyyy-MM-dd") : d;
    if (!groups.has(key)) groups.set(key, []);
    const n = byDate.get(d);
    if (n?.asleep_s) groups.get(key)!.push(n);
  }
  return [...groups.entries()].map(([key, g]) => {
    const bed = avg(g.map((n) => onAxis(n.bed)));
    const wake = avg(g.map((n) => onAxis(n.wake)));
    return {
      key, weekly, nights: g.length,
      label: weekly ? `Week of ${format(parseISO(key), "d MMM")}` : format(parseISO(key), "EEE d MMM"),
      deep: h(avg(g.map((n) => n.deep_s))), rem: h(avg(g.map((n) => n.rem_s))),
      light: h(avg(g.map((n) => n.light_s))), awake: h(avg(g.map((n) => n.awake_s))),
      asleep: avg(g.map((n) => n.asleep_s)), score: avg(g.map((n) => n.score)),
      bed, wake, window: bed != null && wake != null && wake > bed ? [bed, wake] : null,
    };
  });
}

function ticks(rs: Row[]): string[] {
  const step = Math.max(1, Math.ceil(rs.length / 7));
  return rs.filter((_, i) => i % step === 0).map((r) => r.key);
}

function StageTip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  if (!r.nights) return <div className={TOOLTIP_BOX}><p className="text-[#A1A1AA]">{r.label}</p><p className="text-[#52525B]">No data</p></div>;
  return (
    <div className={TOOLTIP_BOX}>
      <p className="text-[#A1A1AA] mb-1">{r.label}{r.weekly ? ` · ${r.nights} night${r.nights > 1 ? "s" : ""}, average` : ""}</p>
      <p className="text-[#FAFAFA] font-medium tabular-nums">{hm(r.asleep)} asleep{r.score != null ? ` · score ${Math.round(r.score)}` : ""}</p>
      {(["deep", "rem", "light", "awake"] as const).map((k) => r[k] != null && (
        <p key={k} className="flex items-center gap-1.5 text-[#A1A1AA] tabular-nums">
          <span className="w-2 h-2 rounded-full" style={{ background: STAGE[k].color }} />
          {STAGE[k].label} {hm((r[k] as number) * 3600)}
        </p>
      ))}
      {r.window && <p className="text-[#71717A] mt-1 tabular-nums">{axisClock(r.window[0])} → {axisClock(r.window[1])}</p>}
    </div>
  );
}

/** Hours per night, stacked deep → REM → light → awake: the bar is the time in bed, so nothing pokes
 *  over 100 % and a short night is a short bar. */
export function StagesChart({ nights, start, end, needH }: { nights: SleepNight[]; start: string; end: string; needH: number }) {
  const data = rows(nights, start, end);
  const weekly = data[0]?.weekly;
  const top = Math.max(needH + 1, ...data.map((r) => (r.deep ?? 0) + (r.rem ?? 0) + (r.light ?? 0) + (r.awake ?? 0)));
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -28 }} barCategoryGap={weekly ? "20%" : "18%"}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="key" tick={AXIS} ticks={ticks(data)} tickLine={false} axisLine={false}
                 tickFormatter={(d) => format(parseISO(d), "d MMM")} />
          <YAxis tick={AXIS} domain={[0, Math.ceil(top)]} tickFormatter={(v) => `${v}h`} tickLine={false} axisLine={false}
                 allowDecimals={false} />
          <Tooltip content={<StageTip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
          <ReferenceLine y={needH} stroke="var(--viz-ref)" strokeDasharray="4 4"
                         label={{ value: `${needH}h`, position: "insideTopRight", fill: "var(--viz-axis)", fontSize: 10 }} />
          {(["deep", "rem", "light", "awake"] as const).map((k, i, all) => (
            <Bar key={k} dataKey={k} stackId="s" fill={STAGE[k].color} name={STAGE[k].label} isAnimationActive={false}
                 radius={i === all.length - 1 ? [2, 2, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[#71717A]">
        {(["deep", "rem", "light", "awake"] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: STAGE[k].color }} />{STAGE[k].label}
          </span>
        ))}
        {weekly && <span className="ml-auto">each bar = a week&apos;s average night</span>}
      </div>
    </div>
  );
}

/** When you slept: a bar from bedtime to wake-up per night (or per week), on a 6 pm → 2 pm axis. */
export function WindowChart({ nights, start, end, bed, wake }: {
  nights: SleepNight[]; start: string; end: string; bed?: string | null; wake?: string | null;
}) {
  const data = rows(nights, start, end).filter((r) => r.window || !r.nights);
  const lo = Math.max(0, Math.floor((Math.min(...data.map((r) => r.window?.[0] ?? 1e9)) - 30) / 60) * 60);
  const hi = Math.min(20 * 60, Math.ceil((Math.max(...data.map((r) => r.window?.[1] ?? 0)) + 30) / 60) * 60);
  if (!data.some((r) => r.window)) return <p className="text-xs text-[#52525B]">No bed and wake times in this period.</p>;
  const b = onAxis(bed ?? null), w = onAxis(wake ?? null);
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barCategoryGap="18%">
        <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
        <XAxis dataKey="key" tick={AXIS} ticks={ticks(data)} tickLine={false} axisLine={false}
               tickFormatter={(d) => format(parseISO(d), "d MMM")} />
        <YAxis tick={AXIS} reversed domain={[lo, hi]} ticks={Array.from({ length: Math.floor((hi - lo) / 120) + 1 }, (_, i) => lo + i * 120)}
               tickFormatter={axisClock} tickLine={false} axisLine={false} />
        <Tooltip content={<StageTip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
        {b != null && <ReferenceLine y={b} stroke="var(--viz-ref)" strokeDasharray="4 4" />}
        {w != null && <ReferenceLine y={w} stroke="var(--viz-ref)" strokeDasharray="4 4" />}
        <Bar dataKey="window" fill="var(--viz-deep)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
