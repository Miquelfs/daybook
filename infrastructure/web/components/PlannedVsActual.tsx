"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveStructure, DisciplineZones } from "@/lib/workout-description";
import type { LinkedPlanSession, ActivitySplit } from "@/lib/api";

const ZONE_DOT: Record<string, string> = {
  Z1: "#A1A1AA", Z2: "#4ADE80", Z3: "#FB923C", Z4: "#F87171", Z5: "#FCA5A5",
};

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Which HR zone did the actual average fall in? (from discipline-zones bands)
function hrVerdict(avgHr: number | null, targetZone: string, dz?: DisciplineZones, disc?: string): { label: string; color: string } | null {
  if (!avgHr || !dz) return null;
  const key = disc === "cycling" || disc === "ride" ? "ride" : disc === "swimming" || disc === "swim" ? "swim" : "run";
  const band = dz[key]?.zones?.[targetZone];
  if (!band || band.hr_lo == null) return null;
  const lo = band.hr_lo;
  const hi = band.hr_hi ?? 999;
  if (avgHr < lo - 3) return { label: "below target zone", color: "#60A5FA" };
  if (avgHr > hi + 3) return { label: "above target zone", color: "#F87171" };
  return { label: "in target zone", color: "#4ADE80" };
}

export function PlannedVsActual({ planSession, splits, activity }: {
  planSession: LinkedPlanSession;
  splits: ActivitySplit[];
  activity: { duration_seconds: number | null; moving_time_seconds: number | null; avg_heart_rate: number | null; avg_speed_mps: number | null; activity_type: string | null };
}) {
  const { data: dz } = useQuery<DisciplineZones>({
    queryKey: ["disc-zones", planSession.goal_id],
    queryFn: () => fetch(`/api/race-plans/goals/${planSession.goal_id}/discipline-zones`).then((r) => (r.ok ? r.json() : undefined)),
    staleTime: 86_400_000,
  });

  const phases = planSession.structure
    ? resolveStructure(planSession.structure, dz, planSession.discipline)
    : [];
  const plannedMin = planSession.effective_duration_min ?? planSession.duration_min;
  const actualMin = Math.round((activity.moving_time_seconds ?? activity.duration_seconds ?? 0) / 60);
  const durDelta = actualMin - plannedMin;
  const durPct = plannedMin ? Math.round((durDelta / plannedMin) * 100) : 0;
  const verdict = hrVerdict(activity.avg_heart_rate, planSession.intensity_zone, dz, planSession.discipline);

  const isRide = (activity.activity_type ?? "").toLowerCase().includes("cycl") || (activity.activity_type ?? "").toLowerCase().includes("ride");
  const actualPace = activity.avg_speed_mps && activity.avg_speed_mps > 0
    ? (isRide ? `${(activity.avg_speed_mps * 3.6).toFixed(1)} km/h`
              : `${Math.floor((1000 / activity.avg_speed_mps) / 60)}:${String(Math.round((1000 / activity.avg_speed_mps) % 60)).padStart(2, "0")} /km`)
    : null;

  return (
    <section className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#52525B] uppercase tracking-widest">Planned vs actual</p>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#18181B] text-[#71717A]">
          {planSession.session_type} · Wk {planSession.week_number}
        </span>
      </div>

      {/* Duration + HR verdict */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#131316] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#52525B] uppercase">Planned</p>
          <p className="text-sm font-semibold text-[#A1A1AA] tabular-nums">{fmtDur(plannedMin)}</p>
        </div>
        <div className="bg-[#131316] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#52525B] uppercase">Actual</p>
          <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{fmtDur(actualMin)}
            <span className={`text-[10px] ml-1 ${Math.abs(durPct) <= 10 ? "text-[#4ADE80]" : "text-[#FB923C]"}`}>
              {durDelta >= 0 ? "+" : ""}{durPct}%
            </span>
          </p>
        </div>
        <div className="bg-[#131316] rounded-lg px-3 py-2">
          <p className="text-[10px] text-[#52525B] uppercase">Avg HR</p>
          <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">
            {activity.avg_heart_rate ?? "—"}
            {verdict && <span className="text-[10px] ml-1" style={{ color: verdict.color }}>·</span>}
          </p>
        </div>
      </div>
      {verdict && (
        <p className="text-[11px]" style={{ color: verdict.color }}>
          Target {planSession.intensity_zone} — you were <b>{verdict.label}</b>{actualPace ? ` · ${actualPace} avg` : ""}.
        </p>
      )}

      {/* Planned structure */}
      {phases.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[10px] text-[#52525B] uppercase tracking-wider">Prescribed</p>
          {phases.map((p, i) => {
            const c = ZONE_DOT[p.zone] ?? "#52525B";
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                <span className="text-[#D4D4D8]">{p.label}</span>
                <span className="text-[10px] font-mono px-1 rounded" style={{ background: `${c}20`, color: c }}>{p.zone}</span>
                <span className="text-[#52525B] ml-auto tabular-nums">{p.duration_min}m</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Actual splits summary */}
      {splits.length > 0 && (
        <p className="text-[11px] text-[#52525B]">{splits.length} splits recorded — see the splits chart above.</p>
      )}
    </section>
  );
}
