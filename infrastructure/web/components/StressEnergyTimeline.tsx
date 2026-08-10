"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, CartesianGrid,
} from "recharts";
import { Activity } from "lucide-react";
import { wellnessApi, type WellnessTimeline } from "@/lib/wellness-api";
import { SectionLabel } from "@/components/MorningBrief";

const STRESS = "#F97316";  // orange
const ENERGY = "#22D3EE";  // cyan (Body Battery)
const HR = "#F87171";      // red

const SPAN_COLOR: Record<string, string> = {
  activity: "#34D399",  // green
  flight: "#1E40AF",    // dark blue
};
const SPAN_FILL_OPACITY: Record<string, number> = { flight: 0.22, activity: 0.14 };
const EVENT_COLOR: Record<string, string> = {
  meal: "#FBBF24",     // brighter amber so it reads over the flight shading
  takeoff: "#60A5FA",
  landing: "#3B82F6",
};
// Meal marker/chip emoji by meal type.
const MEAL_EMOJI: Record<string, string> = {
  breakfast: "☕", lunch: "🥗", dinner: "🍽", snack: "🍎", extra: "🍫", meal: "🍴",
};
const SPAN_EMOJI: Record<string, string> = { flight: "✈️", activity: "🏃" };

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;

// All-day stress + Body Battery (energy) with your events layered on.
export function StressEnergyTimeline({ date }: { date: string }) {
  const { data } = useQuery<WellnessTimeline>({
    queryKey: ["wellness-timeline", date],
    queryFn: () => wellnessApi.timeline(date),
    staleTime: 30_000,
    retry: 1,
  });

  const merged = useMemo(() => {
    if (!data) return [];
    const by = new Map<number, { m: number; stress?: number; bb?: number; hr?: number }>();
    const add = (pts: { t: string; v: number }[], key: "stress" | "bb" | "hr") => {
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

  if (!data) return null;

  if (!data.has_data) {
    return (
      <section>
        <SectionLabel>Stress &amp; energy</SectionLabel>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-6 text-center">
          <Activity size={18} className="text-[#3F3F46] mx-auto mb-1.5" />
          <p className="text-xs text-[#52525B]">No all-day wellness data for this day yet.</p>
          <p className="text-[11px] text-[#3F3F46] mt-0.5">Wear the CIRQA and it syncs each morning.</p>
        </div>
      </section>
    );
  }

  const events = data.events.map((e) => ({ ...e, m: toMin(e.t) }));
  const spans = (data.spans ?? []).map((s) => ({ ...s, m1: toMin(s.start), m2: toMin(s.end) }));

  // One tappable chip per flight, activity and meal — sorted by time of day.
  const chips = [
    ...spans.map((s) => ({
      key: `s-${s.type}-${s.id ?? s.start}`,
      sortM: s.m1,
      emoji: SPAN_EMOJI[s.type] ?? "•",
      time: s.start,
      label: s.label,
      detail:
        s.type === "flight"
          ? [s.you_flew ? "you flew" : null, s.detail].filter(Boolean).join(" · ") || undefined
          : `${s.start}–${s.end}`,
      href: s.href,
      color: SPAN_COLOR[s.type] ?? "#A1A1AA",
    })),
    ...events
      .filter((e) => e.type === "meal")
      .map((e) => ({
        key: `m-${e.meal_type ?? e.t}`,
        sortM: e.m,
        emoji: MEAL_EMOJI[e.meal_type ?? "meal"] ?? "🍴",
        time: e.t,
        label: e.label,
        detail: e.detail,
        href: e.href,
        color: EVENT_COLOR.meal,
      })),
  ].sort((a, b) => a.sortM - b.sortM);

  return (
    <section>
      <SectionLabel>Stress &amp; energy</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={merged} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
              <XAxis
                dataKey="m" type="number" domain={[0, 1440]}
                ticks={[0, 180, 360, 540, 720, 900, 1080, 1260, 1440]}
                tickFormatter={fmt} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false}
              />
              <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="hr" orientation="right" domain={[40, 180]} hide />
              <Tooltip
                contentStyle={{ background: "#111113", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(m) => fmt(Number(m)).replace(":00", `:${String(Number(m) % 60).padStart(2, "0")}`)}
              />
              {spans.map((s, i) => (
                <ReferenceArea key={`s${i}`} yAxisId="pct" x1={s.m1} x2={s.m2}
                  fill={SPAN_COLOR[s.type] ?? "#3F3F46"} fillOpacity={SPAN_FILL_OPACITY[s.type] ?? 0.12}
                  stroke={SPAN_COLOR[s.type] ?? "#3F3F46"} strokeOpacity={0.35} />
              ))}
              {events.map((e, i) => {
                const isFlight = e.type === "takeoff" || e.type === "landing";
                const isMeal = e.type === "meal";
                return (
                  <ReferenceLine key={`e${i}`} yAxisId="pct" x={e.m}
                    stroke={EVENT_COLOR[e.type] ?? "#3F3F46"}
                    strokeOpacity={isFlight ? 0.85 : isMeal ? 0.8 : 0.55}
                    strokeWidth={isMeal ? 1.4 : isFlight ? 1.5 : 1}
                    strokeDasharray={isMeal ? "2 2" : undefined} />
                );
              })}
              <Line yAxisId="pct" dataKey="stress" name="Stress" stroke={STRESS} dot={false} strokeWidth={1.5} connectNulls />
              <Line yAxisId="pct" dataKey="bb" name="Energy" stroke={ENERGY} dot={false} strokeWidth={1.5} connectNulls />
              <Line yAxisId="hr" dataKey="hr" name="HR" stroke={HR} dot={false} strokeWidth={1} strokeOpacity={0.4} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Series legend */}
        <div className="flex items-center gap-4 mt-2 text-[11px] text-[#71717A]">
          <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full" style={{ background: STRESS }} /> Stress</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full" style={{ background: ENERGY }} /> Energy</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full" style={{ background: HR, opacity: 0.5 }} /> HR</span>
        </div>

        {/* Tappable event chips — flights & activities (spans) + meals (events) */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-[#18181B]">
            {chips.map((c) => {
              const body = (
                <>
                  <span>{c.emoji}</span>
                  <span className="tabular-nums text-[#52525B]">{c.time}</span>
                  <span className="truncate max-w-[160px] font-medium" style={{ color: c.color }}>{c.label}</span>
                  {c.detail && <span className="text-[#71717A]">· {c.detail}</span>}
                </>
              );
              const cls =
                "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] transition-colors";
              return c.href ? (
                <Link key={c.key} href={c.href} className={cls}>{body}</Link>
              ) : (
                <span key={c.key} className={cls}>{body}</span>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
