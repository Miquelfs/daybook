"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveStructure, DisciplineZones } from "@/lib/workout-description";
import type { LinkedPlanSession, ActivitySplit } from "@/lib/api";

// Zone dots on the same intensity ramp as the heart-rate card
const ZONE_DOT: Record<string, string> = {
  Z1: "var(--viz-i1)", Z2: "var(--viz-i3)", Z3: "var(--viz-i4)", Z4: "var(--viz-i5)", Z5: "var(--viz-i7)",
};

const RPE_LABEL: Record<number, string> = {
  1: "very easy", 2: "easy", 3: "easy", 4: "moderate", 5: "moderate", 6: "somewhat hard",
  7: "hard", 8: "very hard", 9: "very hard", 10: "max",
};
// The RPE a zone should feel like — to flag "felt harder than planned"
const ZONE_RPE: Record<string, [number, number]> = { Z1: [1, 3], Z2: [3, 5], Z3: [5, 7], Z4: [7, 8], Z5: [8, 10] };

function fmtDur(min: number) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

// Which HR zone did the actual average fall in? (from discipline-zones bands)
function hrVerdict(avgHr: number | null, targetZone: string, dz?: DisciplineZones, disc?: string): { label: string; cls: string } | null {
  if (!avgHr || !dz) return null;
  const key = disc === "cycling" || disc === "ride" ? "ride" : disc === "swimming" || disc === "swim" ? "swim" : "run";
  const band = dz[key]?.zones?.[targetZone];
  if (!band || band.hr_lo == null) return null;
  const lo = band.hr_lo;
  const hi = band.hr_hi ?? 999;
  if (avgHr < lo - 3) return { label: "below the target zone", cls: "text-[#60A5FA]" };
  if (avgHr > hi + 3) return { label: "above the target zone", cls: "text-[#F87171]" };
  return { label: "in the target zone", cls: "text-[#4ADE80]" };
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-[#FAFAFA] truncate">{children}</p>
    </div>
  );
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
  const [rpe, setRpe] = useState<number | null>(planSession.rpe_actual ?? null);
  const [saving, setSaving] = useState<"saving" | "saved" | "error" | null>(null);

  // RPE lives on the plan session — the coach, adaptation and the plan view all read it there
  async function rate(n: number) {
    const prev = rpe;
    setRpe(n);
    setSaving("saving");
    try {
      const r = await fetch(`/api/race-plans/sessions/${planSession.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", rpe_actual: n }),
      });
      if (!r.ok) throw new Error();
      setSaving("saved");
    } catch {
      setRpe(prev);
      setSaving("error");
    }
  }

  const phases = planSession.structure
    ? resolveStructure(planSession.structure, dz, planSession.discipline)
    : [];
  const plannedMin = planSession.effective_duration_min ?? planSession.duration_min;
  const actualMin = Math.round(((activity.moving_time_seconds || activity.duration_seconds || 0)) / 60);
  const durDelta = actualMin - plannedMin;
  const durPct = plannedMin ? Math.round((durDelta / plannedMin) * 100) : 0;
  const verdict = hrVerdict(activity.avg_heart_rate, planSession.intensity_zone, dz, planSession.discipline);
  const zoneRpe = ZONE_RPE[planSession.intensity_zone];
  const rpeNote = rpe && zoneRpe
    ? rpe > zoneRpe[1] ? `Felt harder than a ${planSession.intensity_zone} session should (RPE ${zoneRpe[0]}–${zoneRpe[1]}) — fatigue, heat or under-fuelling?`
      : rpe < zoneRpe[0] ? `Felt easier than planned (${planSession.intensity_zone} ≈ RPE ${zoneRpe[0]}–${zoneRpe[1]})`
      : `Right where a ${planSession.intensity_zone} session should feel`
    : null;

  const isRide = /cycl|ride|bik/i.test(activity.activity_type ?? "");
  const actualPace = activity.avg_speed_mps && activity.avg_speed_mps > 0
    ? (isRide ? `${(activity.avg_speed_mps * 3.6).toFixed(1)} km/h`
              : `${Math.floor((1000 / activity.avg_speed_mps) / 60)}:${String(Math.round((1000 / activity.avg_speed_mps) % 60)).padStart(2, "0")} /km`)
    : null;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#52525B] uppercase tracking-widest">Planned vs actual</p>
        <span className="text-[10px] text-[#71717A]">
          {planSession.session_type.replace(/^Cycling - /, "")} · week {planSession.week_number}
        </span>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 space-y-4">
        {/* Duration + HR verdict */}
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Planned">{fmtDur(plannedMin)}</Tile>
          <Tile label="Actual">
            {fmtDur(actualMin)}
            <span className={`text-xs font-normal ml-1 ${Math.abs(durPct) <= 10 ? "text-[#4ADE80]" : "text-[#FB923C]"}`}>
              {durDelta >= 0 ? "+" : ""}{durPct}%
            </span>
          </Tile>
          <Tile label="Avg HR">
            {activity.avg_heart_rate ?? "—"}
            {activity.avg_heart_rate ? <span className="text-xs font-normal text-[#71717A] ml-1">bpm</span> : null}
          </Tile>
        </div>
        {verdict && (
          <p className="text-sm text-[#A1A1AA]">
            Target {planSession.intensity_zone} — average HR was <b className={verdict.cls}>{verdict.label}</b>
            {actualPace ? <span className="text-[#71717A]"> · {actualPace} avg</span> : null}
          </p>
        )}

        {/* Tour day: the planned route vs what was ridden */}
        {planSession.course && (
          <div className="bg-[#18181B] rounded-xl px-3 py-2.5 text-sm">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-0.5">Route · {planSession.course.name}</p>
            <p className="text-[#A1A1AA]">
              {planSession.course.followed_pct != null
                ? <><b className={planSession.course.followed_pct >= 90 ? "text-emerald-400" : "text-amber-400"}>{planSession.course.followed_pct}%</b> of the planned course ridden · </>
                : null}
              planned {planSession.course.km} km, +{planSession.course.climb_m.toLocaleString("en-GB")} m
              {planSession.course.climb_raw_m - planSession.course.climb_m >= 50
                ? <span className="text-[#71717A]"> (Garmin {planSession.course.climb_raw_m.toLocaleString("en-GB")} m with tunnels)</span> : null}
              <span className="text-[#71717A]"> · ~{planSession.course.tss} TSS</span>
            </p>
          </div>
        )}

        {/* How hard it felt — saved on the plan session */}
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">
            How hard was it? (RPE)
            {rpe ? <span className="normal-case tracking-normal text-[#A1A1AA]"> · {rpe}, {RPE_LABEL[rpe]}</span> : null}
            {saving === "saving" && <span className="normal-case tracking-normal text-[#71717A]"> · saving…</span>}
            {saving === "saved" && <span className="normal-case tracking-normal text-[#4ADE80]"> · saved to plan ✓</span>}
            {saving === "error" && <span className="normal-case tracking-normal text-[#F87171]"> · couldn&apos;t save</span>}
          </p>
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => rate(n)} disabled={saving === "saving"}
                      className={`h-9 rounded-lg text-sm tabular-nums transition-colors ${rpe === n ? "bg-[#F59E0B] text-[#09090B] font-semibold" : "bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA]"}`}>
                {n}
              </button>
            ))}
          </div>
          {rpeNote && <p className="text-xs text-[#71717A] mt-2">{rpeNote}</p>}
        </div>

        {/* Planned structure */}
        {phases.length > 0 && (
          <div className="space-y-1.5 border-t border-[#18181B] pt-3">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Prescribed</p>
            {phases.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_DOT[p.zone] ?? "var(--viz-ref)" }} />
                <span className="text-[#D4D4D8]">{p.label}</span>
                <span className="text-[10px] font-mono px-1.5 rounded bg-[#18181B] text-[#71717A]">{p.zone}</span>
                <span className="text-[#71717A] ml-auto tabular-nums">{p.duration_min}m</span>
              </div>
            ))}
          </div>
        )}

        {splits.length > 0 && (
          <p className="text-xs text-[#71717A]">{splits.length} splits recorded — see the splits chart below.</p>
        )}
      </div>
    </section>
  );
}
