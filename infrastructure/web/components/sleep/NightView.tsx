"use client";

import {
  Area, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Block, Hero, Panel, Stat, Stats } from "@/components/ui/kit";
import type { HrvLever, NightHrv, NightPoint, SleepNightDetail } from "@/lib/api";
import { hm, STAGE } from "./SleepCharts";

const AXIS = { fontSize: 10, fill: "var(--viz-axis)" };
const TOOLTIP_BOX = "rounded-lg border border-[#27272A] bg-[#0D0D0F] px-3 py-2 text-xs shadow-none";
const ROWS = ["awake", "rem", "light", "deep"] as const;

const clock = (bedMin: number | null, m: number) => {
  if (bedMin == null) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  const t = (((bedMin + m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** Ticks on the full hours of the night. */
function hourTicks(bedMin: number | null, total: number): number[] {
  const step = total > 660 ? 120 : 60;
  const first = bedMin == null ? 0 : (60 - (bedMin % 60)) % 60;
  const out: number[] = [];
  for (let m = first; m <= total; m += 60) {
    if (bedMin == null || ((bedMin + m) % 1440) % step === 0 || step === 60) out.push(m);
  }
  return out;
}

const avg = (xs: NightPoint[] | undefined) => (xs?.length ? xs.reduce((a, p) => a + p.v, 0) / xs.length : null);

function vsUsual(now: number | null | undefined, usual: number | null | undefined, unit: string, digits = 0) {
  if (now == null || usual == null) return undefined;
  const d = now - usual;
  const r = Math.abs(d) < 0.5 * 10 ** -digits ? 0 : +d.toFixed(digits);
  return r === 0 ? `your usual` : `${r > 0 ? "+" : "−"}${Math.abs(r)}${unit} vs usual`;
}

// ── the hero ─────────────────────────────────────────────────────────────────

export function NightHero({ d }: { d: SleepNightDetail }) {
  const n = d.night, u = d.usual;
  const mins = n.asleep_s != null && u.asleep_s != null ? Math.round((n.asleep_s - u.asleep_s) / 60) : null;
  const vs = mins == null ? null : Math.abs(mins) < 5 ? "your usual night" : `${mins > 0 ? "+" : "−"}${hm(Math.abs(mins) * 60)} vs usual`;
  const sub = [n.bed && n.wake ? `${n.bed} → ${n.wake}` : null, n.score != null ? `score ${n.score}` : null, n.feedback, vs]
    .filter(Boolean).join(" · ");
  const ofSleep = (s: number | null) => (s && n.asleep_s ? Math.round((s / n.asleep_s) * 100) : null);
  const ofSleepU = (pct: number | null | undefined) =>
    pct != null && u.awake_pct != null && u.awake_pct < 100 ? Math.round((pct / (100 - u.awake_pct)) * 100) : null;
  return (
    <div className="space-y-2">
      <Hero eyebrow={`Night of ${format(parseISO(d.date), "EEE d MMM")}`} value={hm(n.asleep_s)} unit="asleep" sub={sub} />
      <Stats cols={4}>
        <Stat label="Deep" value={hm(n.deep_s)} sub={ofSleep(n.deep_s) != null ? `${ofSleep(n.deep_s)}% · usual ${ofSleepU(u.deep_pct) ?? "—"}%` : undefined} />
        <Stat label="REM" value={hm(n.rem_s)} sub={ofSleep(n.rem_s) != null ? `${ofSleep(n.rem_s)}% · usual ${ofSleepU(u.rem_pct) ?? "—"}%` : undefined} />
        <Stat label="Awake" value={hm(n.awake_s)} sub={n.awakenings != null ? `${n.awakenings} time${n.awakenings === 1 ? "" : "s"}` : undefined} />
        <Stat label="Needed" value={n.need_s ? hm(n.need_s) : `${d.need_h}h`}
              sub={n.need_s && n.asleep_s ? (n.asleep_s >= n.need_s ? "covered" : `${hm(n.need_s - n.asleep_s)} short`) : "Garmin's estimate"} />
      </Stats>
    </div>
  );
}

// ── the night, minute by minute ──────────────────────────────────────────────

/** The stage timeline: four lanes (awake on top, deep at the bottom). */
function Hypnogram({ d, total }: { d: SleepNightDetail; total: number }) {
  const n = d.night;
  const ticks = hourTicks(n.bed_min, total);
  return (
    <div>
      <div className="flex gap-2">
        <div className="w-10 shrink-0 flex flex-col text-[10px] text-[#52525B]">
          {ROWS.map((r) => <span key={r} className="h-5 leading-5">{STAGE[r].label}</span>)}
        </div>
        <div className="relative flex-1" style={{ height: ROWS.length * 20 }}>
          {ROWS.map((r, i) => (
            <div key={r} className="absolute inset-x-0 border-t border-[var(--viz-grid)]" style={{ top: i * 20 + 10 }} />
          ))}
          {n.timeline.map((s, i) => (
            <div key={i} className="absolute rounded-[2px]"
                 title={`${STAGE[s.stage].label} ${clock(n.bed_min, s.from)}–${clock(n.bed_min, s.to)}`}
                 style={{ left: `${(s.from / total) * 100}%`, width: `max(1px, ${((s.to - s.from) / total) * 100}%)`,
                          top: ROWS.indexOf(s.stage) * 20 + 3, height: 14, background: STAGE[s.stage].color }} />
          ))}
        </div>
      </div>
      <div className="relative h-4 mt-1 ml-12 text-[10px] text-[#52525B] tabular-nums">
        {ticks.map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${(m / total) * 100}%` }}>{clock(n.bed_min, m)}</span>
        ))}
      </div>
    </div>
  );
}

function Curve({ label, unit, data, color, total, bedMin, usual, digits = 0 }: {
  label: string; unit: string; data: NightPoint[]; color: string; total: number; bedMin: number | null;
  usual?: number | null; digits?: number;
}) {
  const a = avg(data);
  const lo = Math.min(...data.map((p) => p.v)), hi = Math.max(...data.map((p) => p.v));
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="text-[#71717A]">{label}</span>
        <span className="text-[#A1A1AA] tabular-nums">
          {a != null ? `${a.toFixed(digits)} ${unit} avg` : ""}<span className="text-[#52525B]"> · {lo.toFixed(digits)}–{hi.toFixed(digits)}</span>
          {usual != null && <span className="text-[#52525B]"> · usual {usual.toFixed(digits)}</span>}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <XAxis dataKey="m" type="number" domain={[0, total]} hide />
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip cursor={{ stroke: "var(--viz-ref)" }} content={({ active, payload }) => {
            const p = payload?.[0]?.payload as NightPoint | undefined;
            return active && p ? <div className={TOOLTIP_BOX}><span className="text-[#71717A]">{clock(bedMin, p.m)}</span>{" "}
              <span className="text-[#FAFAFA] tabular-nums">{p.v.toFixed(digits)} {unit}</span></div> : null;
          }} />
          <Line dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NightTimeline({ d }: { d: SleepNightDetail }) {
  const n = d.night, s = n.series, u = d.usual;
  const total = n.end_m ?? Math.max(0, ...n.timeline.map((x) => x.to), ...(s.hr ?? []).map((p) => p.m));
  if (!total || (!n.timeline.length && !s.hr?.length)) return null;
  const curves = [
    { key: "hr", label: "Heart rate", unit: "bpm", color: "var(--viz-hr)", usual: null as number | null | undefined },
    { key: "hrv", label: "HRV", unit: "ms", color: "var(--viz-calm)", usual: u.hrv },
    { key: "respiration", label: "Breathing", unit: "br/min", color: "var(--viz-alt)", usual: u.respiration, digits: 1 },
    { key: "stress", label: "Stress", unit: "", color: "var(--viz-stress)", usual: u.stress },
    { key: "body_battery", label: "Body Battery", unit: "", color: "var(--viz-energy)", usual: null },
  ] as const;
  return (
    <Block title="The night" note="Stages, then what your body did through them, on the same clock.">
      <Panel className="p-4 space-y-5">
        {n.timeline.length > 0 && <Hypnogram d={d} total={total} />}
        {curves.map((c) => {
          const data = s[c.key as keyof typeof s];
          return data && data.length > 1 ? (
            <Curve key={c.key} label={c.label} unit={c.unit} data={data} color={c.color} total={total} bedMin={n.bed_min}
                   usual={c.usual} digits={"digits" in c ? c.digits : 0} />
          ) : null;
        })}
      </Panel>
    </Block>
  );
}

// ── the score's parts and the vitals ─────────────────────────────────────────

const QUAL: Record<string, string> = { excellent: "text-[#FAFAFA]", good: "text-[#A1A1AA]", fair: "text-[#F59E0B]", poor: "text-rose-400" };

export function NightScore({ d }: { d: SleepNightDetail }) {
  const n = d.night, u = d.usual;
  const parts = n.score_parts.filter((p) => p.qualifier);
  return (
    <>
      {parts.length > 0 && (
        <Block title="What made the score" note={n.insight ? `Garmin: ${n.insight.toLowerCase()}.` : undefined}>
          <Panel className="divide-y divide-[#18181B]">
            {parts.map((p) => {
              const pct = p.key.endsWith("Percentage");
              return (
                <div key={p.key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-[#A1A1AA]">{p.label}</span>
                  <span className="flex items-baseline gap-3 tabular-nums">
                    {pct && p.value != null && <span className="text-[#FAFAFA]">{p.value}%</span>}
                    {pct && p.optimal && <span className="text-xs text-[#52525B]">best {p.optimal[0]}–{p.optimal[1]}%</span>}
                    <span className={`text-xs capitalize ${QUAL[p.qualifier!] ?? "text-[#A1A1AA]"}`}>{p.qualifier}</span>
                  </span>
                </div>
              );
            })}
          </Panel>
        </Block>
      )}
      <Block title="Overnight" note="Against your last 30 nights.">
        <Stats cols={4}>
          <Stat label="Resting HR" value={n.resting_hr ?? "—"} unit="bpm" sub={vsUsual(n.resting_hr, u.resting_hr, " bpm")} />
          <Stat label="Breathing" value={n.respiration ?? "—"} unit="br/min"
                sub={vsUsual(n.respiration, u.respiration, "", 1) ?? (n.respiration_range ? `${n.respiration_range[0]}–${n.respiration_range[1]}` : undefined)} />
          <Stat label="Sleep stress" value={n.stress != null ? Math.round(n.stress) : "—"} sub={vsUsual(n.stress, u.stress, "")} />
          <Stat label="Body Battery" value={n.body_battery != null ? `+${n.body_battery}` : "—"} sub={vsUsual(n.body_battery, u.body_battery, "")} />
          <Stat label="Restless" value={n.restless ?? "—"} unit="moments" sub={vsUsual(n.restless, u.restless, "")} />
          <Stat label="In bed" value={hm(n.in_bed_s)} sub={n.in_bed_s && n.asleep_s ? `${Math.round((n.asleep_s / n.in_bed_s) * 100)}% asleep` : undefined} />
          {n.spo2 != null && <Stat label="SpO₂" value={`${n.spo2}%`} sub={n.lowest_spo2 != null ? `lowest ${n.lowest_spo2}%` : undefined} />}
          {n.naps.length > 0 && <Stat label="Naps" value={hm(n.naps.reduce((a, x) => a + x.seconds, 0))} sub="Garmin" />}
        </Stats>
      </Block>
    </>
  );
}

// ── HRV ──────────────────────────────────────────────────────────────────────

/** Where last night and the 7-day average sit: low · below range · your range · above. */
function RangeBar({ h }: { h: NightHrv }) {
  if (!h.range) return null;
  const [lo, hi] = h.range;
  const vals = [h.night, h.week, lo, hi, h.low_below].filter((x): x is number => x != null);
  const min = Math.floor(Math.min(...vals) - 10), max = Math.ceil(Math.max(...vals) + 10);
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const lowTop = h.low_below ?? lo;
  return (
    <div className="pt-6 pb-6">
      <div className="relative h-2 rounded-full bg-[#18181B]">
        <div className="absolute inset-y-0 rounded-l-full bg-rose-400/25" style={{ left: 0, width: x(lowTop) }} />
        <div className="absolute inset-y-0 bg-[#3F3F46]" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
        {h.week != null && (
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: x(h.week) }}>
            <div className="w-3 h-3 rounded-full border-2 border-[#A1A1AA] bg-[#0D0D0F]" />
            <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[10px] text-[#71717A] whitespace-nowrap tabular-nums">
              7-day {Math.round(h.week)}
            </span>
          </div>
        )}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: x(h.night) }}>
          <div className="w-3.5 h-3.5 rounded-full bg-[#F59E0B]" />
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-[#F59E0B] whitespace-nowrap tabular-nums">
            last night {Math.round(h.night)}
          </span>
        </div>
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-[#52525B] tabular-nums">
        <span className="absolute -translate-x-1/2" style={{ left: x(lo) }}>{lo}</span>
        <span className="absolute -translate-x-1/2" style={{ left: x(hi) }}>{hi}</span>
      </div>
    </div>
  );
}

function History({ h, date }: { h: NightHrv; date: string }) {
  const data = h.history.map((r) => ({ ...r, band: r.lo != null && r.hi != null ? [r.lo, r.hi] : null }));
  if (data.length < 3) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -28 }}>
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24}
                 tickFormatter={(v) => format(parseISO(v), "d MMM")} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={["dataMin - 5", "dataMax + 5"]} allowDecimals={false} />
          <Tooltip content={({ active, payload }) => {
            const r = payload?.[0]?.payload as (typeof data)[number] | undefined;
            return active && r ? (
              <div className={TOOLTIP_BOX}>
                <p className="text-[#A1A1AA]">{format(parseISO(r.date), "EEE d MMM")}</p>
                <p className="text-[#FAFAFA] tabular-nums">{r.night != null ? `${r.night} ms` : "—"}{r.week != null ? ` · 7-day ${r.week}` : ""}</p>
                {r.lo != null && <p className="text-[#71717A] tabular-nums">your range {r.lo}–{r.hi}</p>}
              </div>
            ) : null;
          }} />
          <Area dataKey="band" stroke="none" fill="var(--viz-grid)" fillOpacity={0.9} isAnimationActive={false} connectNulls />
          <Line dataKey="week" stroke="var(--viz-ref)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          <Line dataKey="night" stroke="var(--viz-calm)" strokeWidth={1.5} dot={{ r: 1.5 }} isAnimationActive={false} connectNulls />
          <ReferenceLine x={date} stroke="#F59E0B" strokeOpacity={0.6} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#71717A]">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: "var(--viz-calm)" }} />each night</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dashed" style={{ borderColor: "var(--viz-ref)" }} />7-day average</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-[#27272A]" />your range</span>
      </div>
    </div>
  );
}

function Lever({ l, scale }: { l: HrvLever; scale: number }) {
  const w = Math.min(50, (Math.abs(l.delta) / scale) * 50);
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[#A1A1AA] min-w-0">
          {l.label}
          {l.tonight && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">last night</span>}
        </span>
        <span className={`tabular-nums shrink-0 ${l.delta < 0 ? "text-rose-400" : "text-[#FAFAFA]"}`}>
          {l.delta > 0 ? "+" : l.delta < 0 ? "−" : ""}{Math.abs(l.delta).toFixed(0)} ms
        </span>
      </div>
      <div className="relative h-1.5 mt-1.5 rounded-full bg-[#18181B]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#3F3F46]" />
        <div className={`absolute inset-y-0 rounded-full ${l.delta < 0 ? "bg-rose-400/70" : "bg-[#A1A1AA]"}`}
             style={l.delta < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
      </div>
      <p className="text-[11px] text-[#52525B] mt-1 tabular-nums">
        {Math.round(l.with)} vs {Math.round(l.without)} ms · {l.n_with} vs {l.n_without} mornings
      </p>
    </div>
  );
}

export function NightHrvBlock({ h, date }: { h: NightHrv | null; date: string }) {
  if (!h) return null;
  const tone = h.reading.tone === "low" ? "text-rose-400" : h.reading.tone === "ok" ? "text-[#F59E0B]" : "text-[#FAFAFA]";
  const scale = Math.max(5, ...h.levers.map((l) => Math.abs(l.delta)));
  return (
    <section id="hrv" className="space-y-8 scroll-mt-6">
      <Block title="HRV and recovery"
             note="Heart-rate variability: how much the time between beats varies. Higher than your usual means your nervous system is in rest-and-recover mode.">
        <Panel className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className={`text-sm font-medium ${tone}`}>{h.reading.headline}</p>
            {h.status && <span className="text-xs text-[#52525B] capitalize shrink-0">Garmin: {h.status}</span>}
          </div>
          <RangeBar h={h} />
          <p className="text-xs text-[#A1A1AA] leading-relaxed">{h.reading.detail}</p>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat plain label="Last night" value={Math.round(h.night)} unit="ms" />
            <Stat plain label="7-day avg" value={h.week != null ? Math.round(h.week) : "—"} unit="ms" />
            <Stat plain label="Best 5 min" value={h.high_5min ?? "—"} unit="ms" />
          </div>
        </Panel>
      </Block>
      <Block title="Six weeks" note="Garmin judges the 7-day average against your range. One night is noise; the dashed line is the trend.">
        <Panel className="p-4"><History h={h} date={date} /></Panel>
      </Block>
      <Block title="What moves your HRV"
             note={h.levers.length ? "Your mornings over the last year: the average HRV after each, against the other mornings."
                                   : "Not enough mornings yet to say what moves yours."}>
        {h.levers.length > 0 && (
          <Panel className="divide-y divide-[#18181B]">
            {h.levers.map((l) => <Lever key={l.key} l={l} scale={scale} />)}
          </Panel>
        )}
        <p className="text-xs text-[#52525B] leading-relaxed mt-3">
          What usually helps: a regular bedtime, an easy day after a hard one, no alcohol or heavy meal late in the evening,
          enough water. What drags it down: stacked hard sessions, short or late nights, drinks, illness, long flights and time-zone changes.
        </p>
      </Block>
    </section>
  );
}
