"use client";

import { ActivityMap } from "@/components/ActivityMap";
import { GradeProfile, StageStats } from "@/components/training/StageProfile";
import type { PlanCourse } from "@/lib/api";

/** The route a tour day follows, laid out like a stage sheet: profile by gradient, the six numbers,
 *  the map, the climbs and anything to check before riding. */
export function CourseCard({ course }: { course: PlanCourse }) {
  const garminDiff = course.climb_raw_m - course.climb_m;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] text-[#52525B] uppercase tracking-widest truncate">
          {course.stage ? `Stage ${course.stage.n} of ${course.stage.of} · ` : "Route · "}{course.name}
        </p>
        {course.stage && <span className="text-[10px] text-[#71717A] shrink-0">{course.stage.block}</span>}
      </div>

      {course.profile && course.profile.length > 2 && <GradeProfile profile={course.profile} />}

      <StageStats course={course} />
      {garminDiff >= 50 && (
        <p className="text-[11px] text-[#71717A]">Garmin will show +{course.climb_raw_m.toLocaleString("en-GB")} m (tunnel artefacts)</p>
      )}

      {course.polyline && <ActivityMap polyline={course.polyline} height="200px" interactive={false} />}

      {course.climbs.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Main climbs</p>
          <div className="grid grid-cols-[3rem_1fr_1fr_3.5rem_4rem] gap-x-2 text-[10px] text-[#52525B] uppercase tracking-widest">
            <span>Km</span><span>Length</span><span>Gain</span><span className="text-right">Avg</span><span className="text-right">Max 200m</span>
          </div>
          {course.climbs.map((c) => (
            <div key={c.km} className="grid grid-cols-[3rem_1fr_1fr_3.5rem_4rem] gap-x-2 text-xs tabular-nums">
              <span className="text-[#71717A]">{c.km}</span>
              <span className="text-[#D4D4D8]">{c.length_km} km</span>
              <span className="text-[#D4D4D8]">+{c.gain_m} m</span>
              <span className={`text-right ${c.avg_pct >= 6 ? "text-amber-400" : "text-[#A1A1AA]"}`}>{c.avg_pct}%</span>
              <span className={`text-right ${c.max_200m_pct >= 10 ? "text-amber-400" : "text-[#71717A]"}`}>{c.max_200m_pct}%</span>
            </div>
          ))}
        </div>
      ) : course.profile && course.profile.length > 2 ? (
        <p className="text-xs text-[#71717A]">No real climbs: the whole day stays under {course.high_m ?? 0} m.</p>
      ) : null}

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
