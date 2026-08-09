"use client";

import { useMemo } from "react";
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
  flight: "#60A5FA",    // blue
};
const EVENT_COLOR: Record<string, string> = {
  meal: "#F59E0B",
  takeoff: "#60A5FA",
  landing: "#3B82F6",
};
const EVENT_EMOJI: Record<string, string> = {
  meal: "🍽", takeoff: "🛫", landing: "🛬", flight: "✈️", activity: "🏃",
};

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
                  fill={SPAN_COLOR[s.type] ?? "#3F3F46"} fillOpacity={0.1} stroke={SPAN_COLOR[s.type] ?? "#3F3F46"} strokeOpacity={0.25} />
              ))}
              {events.map((e, i) => (
                <ReferenceLine key={`e${i}`} yAxisId="pct" x={e.m} stroke={EVENT_COLOR[e.type] ?? "#3F3F46"} strokeOpacity={0.55} strokeWidth={1} strokeDasharray={e.type === "meal" ? "3 3" : undefined} />
              ))}
              <Line yAxisId="pct" dataKey="stress" name="Stress" stroke={STRESS} dot={false} strokeWidth={1.5} connectNulls />
              <Line yAxisId="pct" dataKey="bb" name="Energy" stroke={ENERGY} dot={false} strokeWidth={1.5} connectNulls />
              <Line yAxisId="hr" dataKey="hr" name="HR" stroke={HR} dot={false} strokeWidth={1} strokeOpacity={0.4} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend + event strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
          <span className="flex items-center gap-1 text-[#71717A]"><span className="w-2 h-2 rounded-full" style={{ background: STRESS }} /> Stress</span>
          <span className="flex items-center gap-1 text-[#71717A]"><span className="w-2 h-2 rounded-full" style={{ background: ENERGY }} /> Energy</span>
          <span className="flex items-center gap-1 text-[#71717A]"><span className="w-2 h-2 rounded-full" style={{ background: HR }} /> HR</span>
        </div>
        {(spans.length > 0 || events.length > 0) && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-[#18181B] text-[11px]">
            {spans.map((s, i) => (
              <span key={`s${i}`} className="tabular-nums" style={{ color: SPAN_COLOR[s.type] ?? "#71717A" }}>
                {EVENT_EMOJI[s.type] ?? "•"} {s.start}–{s.end} {s.label}
              </span>
            ))}
            {events.map((e, i) => (
              <span key={`e${i}`} title={e.detail ?? e.label} className="tabular-nums text-[#71717A]">
                {EVENT_EMOJI[e.type] ?? "•"} {e.t} {e.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
