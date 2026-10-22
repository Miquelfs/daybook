"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ActivityMap } from "@/components/ActivityMap";
import type { PlanCourse } from "@/lib/api";

const hm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;

/** The route a tour day follows: map, elevation, the numbers, the climbs and anything to check before riding. */
export function CourseCard({ course }: { course: PlanCourse }) {
  const garminDiff = course.climb_raw_m - course.climb_m;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Route · {course.name}</p>
        <span className="text-[10px] text-[#71717A]">~{course.tss} TSS</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {[
          ["Distance", `${course.km} km`],
          ["Climbing", `+${course.climb_m.toLocaleString("en-GB")} m`],
          ["High point", course.high_m != null ? `${course.high_m} m` : "—"],
          ["Riding", hm(course.minutes)],
        ].map(([l, v]) => (
          <div key={l} className="bg-[#18181B] rounded-xl px-2.5 py-2 min-w-0">
            <p className="text-[9px] text-[#52525B] uppercase tracking-widest truncate">{l}</p>
            <p className="text-sm font-semibold tabular-nums truncate">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#71717A]">
        {course.avg_kmh ? `${course.avg_kmh} km/h moving on a loaded touring bike, no stops` : "Moving time, no stops"}
        {garminDiff >= 50 ? ` · Garmin will show +${course.climb_raw_m.toLocaleString("en-GB")} m (tunnel artefacts)` : ""}
      </p>

      {course.polyline && <ActivityMap polyline={course.polyline} height="200px" interactive={false} />}

      {course.profile && course.profile.length > 2 && (
        <div className="h-24 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={course.profile.map(([km, m]) => ({ km, m }))} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <XAxis dataKey="km" type="number" domain={[0, "dataMax"]} tick={{ fill: "var(--viz-axis)", fontSize: 10 }}
                     axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v))}`} />
              <YAxis tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={{ background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                       labelStyle={{ color: "#A1A1AA" }} itemStyle={{ color: "#FAFAFA" }}
                       labelFormatter={(v) => `km ${v}`} formatter={(v) => [`${v} m`, "Elevation"]} />
              <Area type="monotone" dataKey="m" stroke="var(--viz-alt)" fill="var(--viz-alt)" fillOpacity={0.25}
                    strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {course.climbs.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Main climbs</p>
          {course.climbs.map((c) => (
            <div key={c.km} className="flex items-center gap-3 text-xs tabular-nums">
              <span className="w-12 text-[#71717A]">km {c.km}</span>
              <span className="flex-1 text-[#D4D4D8]">{c.length_km} km · +{c.gain_m} m</span>
              <span className={c.avg_pct >= 6 ? "text-amber-400" : "text-[#A1A1AA]"}>{c.avg_pct}% avg</span>
              <span className={`w-16 text-right ${c.max_200m_pct >= 10 ? "text-amber-400" : "text-[#71717A]"}`}>max {c.max_200m_pct}%</span>
            </div>
          ))}
        </div>
      )}

      {course.tunnels.length > 0 && (
        <div className="bg-[#1C1700] border border-[#B45309] rounded-xl px-3 py-2.5 space-y-1">
          <p className="text-xs text-[#FCD34D] font-medium">Check before you ride: {course.tunnels.length === 1 ? "a probable tunnel" : `${course.tunnels.length} probable tunnels`}</p>
          {course.tunnels.map((t) => (
            <p key={t.from_km} className="text-[11px] text-[#FCD34D]">
              km {t.from_km}–{t.to_km} ({t.length_km} km): the elevation jumps to {t.peak_m} m and back. If it&apos;s a new
              bypass tunnel, bikes may not be allowed — check the course takes the old road.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
