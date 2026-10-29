"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import { Activity, X } from "lucide-react";
import { wellnessApi, type WellnessTimeline } from "@/lib/wellness-api";
import { SectionLabel } from "@/components/MorningBrief";

const STRESS = "#F97316";  // orange
const ENERGY = "#22D3EE";  // cyan (Body Battery)
const HR = "#F87171";      // red

const SPAN_COLOR: Record<string, string> = {
  activity: "#34D399",  // green
  flight: "#1E40AF",    // dark blue
  nap: "#818CF8",       // indigo
};
const SPAN_FILL_OPACITY: Record<string, number> = { flight: 0.22, activity: 0.14, nap: 0.18 };
const EVENT_COLOR: Record<string, string> = {
  meal: "#FBBF24",     // brighter amber so it reads over the flight shading
  takeoff: "#60A5FA",
  landing: "#3B82F6",
  nap: "#818CF8",
};
// Meal marker/chip emoji by meal type.
const MEAL_EMOJI: Record<string, string> = {
  breakfast: "☕", lunch: "🥗", dinner: "🍽", snack: "🍎", extra: "🍫", meal: "🍴",
};
const SPAN_EMOJI: Record<string, string> = { flight: "✈️", activity: "🏃", nap: "😴" };

// A meal is a moment, not a span: compare the hour before with the two hours after.
const MEAL_BEFORE = 60;
const MEAL_AFTER = 120;

type Series = "stress" | "bb" | "hr";
type Row = { m: number; stress?: number; bb?: number; hr?: number };

/** What you logged, as one selectable thing on the chart. */
interface Item {
  key: string;
  kind: "span" | "meal";
  type: string;
  emoji: string;
  label: string;
  time: string;
  m1: number;
  m2: number;
  detail?: string;
  href?: string;
  color: string;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`);

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const peak = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

function windowStats(rows: Row[], a: number, b: number) {
  const w = rows.filter((r) => r.m >= a && r.m <= b);
  const stress = w.map((r) => r.stress).filter((v): v is number => v != null);
  const hr = w.map((r) => r.hr).filter((v): v is number => v != null);
  // Energy at the edges: the last reading at/before the start, the last one by the end.
  const bbAt = (m: number) => {
    let v: number | null = null;
    for (const r of rows) {
      if (r.m > m) break;
      if (r.bb != null && m - r.m <= 90) v = r.bb;
    }
    return v;
  };
  const bb0 = bbAt(a), bb1 = bbAt(b);
  return {
    stress: avg(stress), stressPeak: peak(stress), hr: avg(hr), hrPeak: peak(hr),
    bb0, bb1, bbDelta: bb0 != null && bb1 != null ? bb1 - bb0 : null,
  };
}

// All-day stress + Body Battery (energy) with your events layered on. Tap a chip
// or the chart to see what a flight, workout, nap or meal did to the curves.
export function StressEnergyTimeline({ date }: { date: string }) {
  const { data } = useQuery<WellnessTimeline>({
    queryKey: ["wellness-timeline", date],
    queryFn: () => wellnessApi.timeline(date),
    staleTime: 30_000,
    retry: 1,
  });
  const [selKey, setSelKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<Series>>(new Set());

  const merged = useMemo<Row[]>(() => {
    if (!data) return [];
    const by = new Map<number, Row>();
    const add = (pts: { t: string; v: number }[], key: Series) => {
      for (const p of pts) {
        const m = toMin(p.t);
        const o = by.get(m) ?? { m };
        o[key] = p.v;
        by.set(m, o);
      }
    };
    add(data.stress, "stress");
    add(data.body_battery, "bb");
    add(data.hr, "hr");
    return [...by.values()].sort((a, b) => a.m - b.m);
  }, [data]);

  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    const spans: Item[] = (data.spans ?? []).map((s) => ({
      key: `s-${s.type}-${s.id ?? s.start}-${s.start}`,
      kind: "span",
      type: s.type,
      emoji: SPAN_EMOJI[s.type] ?? "•",
      label: s.label,
      time: s.start,
      m1: toMin(s.start),
      m2: toMin(s.end),
      detail: s.type === "flight"
        ? [s.you_flew ? "you flew" : null, s.detail].filter(Boolean).join(" · ") || undefined
        : s.detail ?? undefined,
      href: s.href,
      color: SPAN_COLOR[s.type] ?? "#A1A1AA",
    }));
    const meals: Item[] = data.events.filter((e) => e.type === "meal").map((e) => ({
      key: `m-${e.meal_type ?? e.t}`,
      kind: "meal",
      type: "meal",
      emoji: MEAL_EMOJI[e.meal_type ?? "meal"] ?? "🍴",
      label: e.label,
      time: e.t,
      m1: toMin(e.t),
      m2: toMin(e.t),
      detail: e.detail,
      href: e.href,
      color: EVENT_COLOR.meal,
    }));
    return [...spans, ...meals].sort((a, b) => a.m1 - b.m1);
  }, [data]);

  const dayStress = useMemo(() => avg(merged.map((r) => r.stress).filter((v): v is number => v != null)), [merged]);

  if (!data) return null;

  if (!data.has_data) {
    return (
      <section id="stress-energy" className="scroll-mt-20">
        <SectionLabel>Stress &amp; energy</SectionLabel>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-6 text-center">
          <Activity size={18} className="text-[#3F3F46] mx-auto mb-1.5" />
          <p className="text-xs text-[#52525B]">No all-day wellness data for this day yet.</p>
          <p className="text-[11px] text-[#3F3F46] mt-0.5">Wear the CIRQA and it syncs each morning.</p>
        </div>
      </section>
    );
  }

  const sel = items.find((i) => i.key === selKey) ?? null;
  const events = data.events.map((e) => ({ ...e, m: toMin(e.t) }));
  const spanItems = items.filter((i) => i.kind === "span");

  /** The innermost logged span at a minute (a nap inside a duty day wins over the flight). */
  const spanAt = (m: number) =>
    spanItems.filter((s) => s.m1 <= m && m <= s.m2).sort((a, b) => (a.m2 - a.m1) - (b.m2 - b.m1))[0] ?? null;
  const mealNear = (m: number) => items.find((i) => i.kind === "meal" && Math.abs(i.m1 - m) <= 10) ?? null;

  function onChartClick(state: unknown) {
    const label = (state as { activeLabel?: number | string } | null)?.activeLabel;
    if (label == null) return;
    const m = Number(label);
    const hit = mealNear(m) ?? spanAt(m);
    setSelKey(hit && hit.key !== selKey ? hit.key : null);
  }

  const toggleSeries = (s: Series) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(s)) n.delete(s); else n.add(s);
    return n;
  });

  return (
    <section id="stress-energy" className="scroll-mt-20">
      <SectionLabel>Stress &amp; energy</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3">
        <div className="h-52 cursor-pointer">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged} margin={{ top: 8, right: 4, bottom: 0, left: -24 }} onClick={onChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
              <XAxis
                dataKey="m" type="number" domain={[0, 1440]}
                ticks={[0, 180, 360, 540, 720, 900, 1080, 1260, 1440]}
                tickFormatter={fmt} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false}
              />
              <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="hr" orientation="right" domain={[40, 180]} hide />
              <Tooltip
                cursor={{ stroke: "#52525B", strokeWidth: 1 }}
                content={({ active, label, payload }) => {
                  if (!active || label == null) return null;
                  const m = Number(label);
                  const row = (payload?.[0]?.payload ?? {}) as Row;
                  const ctx = mealNear(m) ?? spanAt(m);
                  return (
                    <div className="bg-[#111113] border border-[#27272A] rounded-lg px-2.5 py-1.5 text-[11px] space-y-0.5 shadow-lg">
                      <p className="text-[#A1A1AA] tabular-nums">{clock(m)}</p>
                      {ctx && <p className="text-[#FAFAFA]">{ctx.emoji} {ctx.label}</p>}
                      <p className="tabular-nums">
                        {row.stress != null && !hidden.has("stress") && <span style={{ color: STRESS }}>Stress {row.stress} </span>}
                        {row.bb != null && !hidden.has("bb") && <span style={{ color: ENERGY }}>· Energy {row.bb} </span>}
                        {row.hr != null && !hidden.has("hr") && <span className="text-[#F87171]">· {row.hr} bpm</span>}
                      </p>
                    </div>
                  );
                }}
              />
              {spanItems.map((s) => {
                const on = sel?.key === s.key;
                const base = SPAN_FILL_OPACITY[s.type] ?? 0.12;
                return (
                  <ReferenceArea key={s.key} yAxisId="pct" x1={s.m1} x2={s.m2}
                    fill={s.color} fillOpacity={sel ? (on ? Math.min(0.42, base * 2) : base * 0.35) : base}
                    stroke={s.color} strokeOpacity={on ? 0.9 : sel ? 0.12 : 0.35} />
                );
              })}
              {sel?.kind === "meal" && (
                <ReferenceArea yAxisId="pct" x1={sel.m1} x2={Math.min(1440, sel.m1 + MEAL_AFTER)}
                  fill={EVENT_COLOR.meal} fillOpacity={0.12} strokeOpacity={0} />
              )}
              {events.map((e, i) => {
                const isFlight = e.type === "takeoff" || e.type === "landing";
                const isMeal = e.type === "meal";
                const on = sel?.kind === "meal" && isMeal && sel.m1 === e.m;
                return (
                  <ReferenceLine key={`e${i}`} yAxisId="pct" x={e.m}
                    stroke={EVENT_COLOR[e.type] ?? "#3F3F46"}
                    strokeOpacity={sel && !on ? 0.25 : isFlight ? 0.85 : isMeal ? 0.8 : 0.55}
                    strokeWidth={on ? 2.2 : isMeal ? 1.4 : isFlight ? 1.5 : 1}
                    strokeDasharray={isMeal && !on ? "2 2" : undefined} />
                );
              })}
              {!hidden.has("stress") && <Line yAxisId="pct" dataKey="stress" name="Stress" stroke={STRESS} dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />}
              {!hidden.has("bb") && <Line yAxisId="pct" dataKey="bb" name="Energy" stroke={ENERGY} dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />}
              {!hidden.has("hr") && <Line yAxisId="hr" dataKey="hr" name="HR" stroke={HR} dot={false} strokeWidth={1} strokeOpacity={0.4} connectNulls isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Series legend — tap to hide / show a line */}
        <div className="flex items-center gap-1 mt-2 text-[11px]">
          {([["stress", "Stress", STRESS, 1], ["bb", "Energy", ENERGY, 1], ["hr", "HR", HR, 0.5]] as const).map(([k, label, color, op]) => (
            <button key={k} onClick={() => toggleSeries(k)}
                    className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-opacity ${hidden.has(k) ? "opacity-35" : "text-[#71717A]"}`}>
              <span className="w-3 h-[2px] rounded-full" style={{ background: color, opacity: op }} /> {label}
            </button>
          ))}
          {dayStress != null && <span className="ml-auto text-[#52525B] tabular-nums">day avg stress {dayStress}</span>}
        </div>

        {sel && <Selected item={sel} rows={merged} dayStress={dayStress} onClose={() => setSelKey(null)} />}

        {/* Tappable chips — flights, activities, naps, meals */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-[#18181B]">
            {items.map((c) => {
              const on = c.key === selKey;
              return (
                <button key={c.key} onClick={() => setSelKey(on ? null : c.key)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                    on ? "bg-[#27272A] border-[#52525B]" : "bg-[#18181B] border-[#27272A] hover:border-[#3F3F46]"}`}>
                  <span>{c.emoji}</span>
                  <span className="tabular-nums text-[#52525B]">{c.time}</span>
                  <span className="truncate max-w-[160px] font-medium" style={{ color: c.color }}>{c.label}</span>
                  {!on && c.detail && <span className="text-[#71717A] truncate max-w-[180px]">· {c.detail}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-[#52525B]">{label}</p>
      <p className="text-base font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</p>
      {sub && <p className="text-[10px] text-[#71717A] tabular-nums truncate">{sub}</p>}
    </div>
  );
}

/** What the selected flight / workout / nap / meal did to stress, energy and HR. */
function Selected({ item, rows, dayStress, onClose }: {
  item: Item;
  rows: Row[];
  dayStress: number | null;
  onClose: () => void;
}) {
  const meal = item.kind === "meal";
  const st = meal ? windowStats(rows, item.m1, item.m1 + MEAL_AFTER) : windowStats(rows, item.m1, item.m2);
  const before = meal ? windowStats(rows, item.m1 - MEAL_BEFORE, item.m1 - 1) : null;
  const vsDay = st.stress != null && dayStress != null ? st.stress - dayStress : null;
  const exercise = item.type === "activity";

  const range = meal ? item.time : `${item.time}–${item.m2 >= 1440 ? "24:00" : clock(item.m2)}`;
  const stressTone = (v: number | null) => (v == null ? undefined : v > 3 ? "#F97316" : v < -3 ? "#34D399" : undefined);

  return (
    <div className="mt-2.5 rounded-lg border border-[#27272A] bg-[#131316] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span>{item.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#FAFAFA] truncate">{item.label}</p>
          <p className="text-[11px] text-[#71717A] tabular-nums">
            {range}{!meal && item.m2 > item.m1 ? ` · ${dur(item.m2 - item.m1)}` : ""}{item.detail ? ` · ${item.detail}` : ""}
          </p>
        </div>
        {item.href && (
          <Link href={item.href} className="text-[11px] text-[#71717A] hover:text-[#F59E0B] shrink-0 mt-0.5">Open →</Link>
        )}
        <button onClick={onClose} aria-label="Close" className="text-[#52525B] hover:text-[#A1A1AA] shrink-0">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-2.5">
        {meal ? (
          <Stat label="Stress"
                value={before?.stress != null && st.stress != null ? `${before.stress} → ${st.stress}` : st.stress != null ? String(st.stress) : "—"}
                sub="hour before → 2h after"
                tone={stressTone(before?.stress != null && st.stress != null ? st.stress - before.stress : null)} />
        ) : (
          <Stat label={exercise ? "Effort" : "Stress"}
                value={st.stress != null ? String(st.stress) : "—"}
                sub={exercise ? "watch reads effort as stress"
                  : [vsDay != null && `${vsDay > 0 ? "+" : ""}${vsDay} vs day`, st.stressPeak != null && `peak ${st.stressPeak}`].filter(Boolean).join(" · ")}
                tone={exercise ? undefined : stressTone(vsDay)} />
        )}
        <Stat label="Energy"
              value={st.bbDelta != null ? `${st.bbDelta > 0 ? "+" : ""}${st.bbDelta}` : "—"}
              sub={st.bb0 != null && st.bb1 != null ? `${st.bb0} → ${st.bb1}` : undefined}
              tone={st.bbDelta == null ? undefined : st.bbDelta > 0 ? "#22D3EE" : undefined} />
        <Stat label="Heart rate"
              value={st.hr != null ? `${st.hr}` : "—"}
              sub={st.hrPeak != null ? `avg bpm · peak ${st.hrPeak}` : undefined} />
      </div>
    </div>
  );
}
