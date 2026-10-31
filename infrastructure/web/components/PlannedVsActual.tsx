"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveStructure, DisciplineZones } from "@/lib/workout-description";
import type { LinkedPlanSession, ActivitySplit, AnalysisIntervals, ActivityAnalysis } from "@/lib/api";

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

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// An interval session is judged on its reps, not the whole-session average (warm-up, recoveries
// and cool-down always pull that below the work zone). Pace leads: HR lags a 3-minute rep.
function repsVerdict(iv: AnalysisIntervals, planSession: LinkedPlanSession, dz?: DisciplineZones) {
  const set = planSession.structure?.find((s) => s.kind === "intervals");
  const zone = set?.work_zone ?? planSession.intensity_zone;
  const isRun = !/cycl|ride|swim/i.test(planSession.discipline);
  const target = isRun ? dz?.run?.zones?.[zone]?.pace_s_km : undefined;
  const planned = set?.reps && set.work_min ? `${set.reps} × ${clock(set.work_min * 60)}` : null;
  const did = `${iv.count} × ${clock(iv.avg_rep_s)}`;
  let pace: { label: string; cls: string } | null = null;
  if (target && iv.avg_pace_s_km) {
    const d = iv.avg_pace_s_km - target;
    pace = Math.abs(d) <= Math.max(4, target * 0.02) ? { label: "on the target pace", cls: "text-[#4ADE80]" }
      : d < 0 ? { label: `${-d} s/km faster than the target`, cls: "text-[#FB923C]" }
      : { label: `${d} s/km slower than the target`, cls: "text-[#60A5FA]" };
  }
  return { zone, target, planned, did, pace, short: set?.reps ? iv.count < set.reps : false, setReps: set?.reps };
}

type HrPlan = NonNullable<NonNullable<ActivityAnalysis["hr"]>["plan"]>;
type PowerSummary = { np: number | null; avg: number; estimated: boolean };

// Ride power against the planned zone's watt band (FTP-based — the same bands the trainer gets)
function powerVerdict(power: PowerSummary | null | undefined, zone: string, dz?: DisciplineZones) {
  const band = dz?.ride?.zones?.[zone];
  const w = power?.np ?? power?.avg;
  if (!w || !band?.watts_hi) return null;
  const lo = band.watts_lo ?? 0, hi = band.watts_hi;
  const off = w < lo ? (lo - w) / lo : w > hi ? (w - hi) / hi : 0;
  return {
    w, lo, hi, off, estimated: !!power?.estimated,
    label: off === 0 ? "in the band" : w < lo ? "below the band" : "above the band",
    cls: off === 0 ? "text-[#4ADE80]" : w < lo ? "text-[#60A5FA]" : "text-[#F87171]",
  };
}

/** 0–100 for how closely the session matched the plan: duration 35 · intensity 45 · feel (RPE) 20.
 *  Parts without data drop out and the rest is rescaled. */
function sessionScore(o: {
  durPct: number; zone: string; rpe: number | null; zoneRpe?: [number, number];
  reps: ReturnType<typeof repsVerdict> | null; intervals?: AnalysisIntervals | null;
  power: ReturnType<typeof powerVerdict>; hrPlan?: HrPlan | null; hrLabel?: string;
}) {
  const parts: { key: string; label: string; w: number; v: number }[] = [];
  parts.push({ key: "dur", label: "Duration", w: 35, v: Math.max(0, 1 - Math.max(0, Math.abs(o.durPct) - 5) / 40) });
  const easy = o.zone === "Z1" || o.zone === "Z2";
  let inten: number | null = null;
  if (o.reps && o.intervals) {
    const done = o.reps.setReps ? Math.min(1, o.intervals.count / o.reps.setReps) : 1;
    const pace = o.reps.target && o.intervals.avg_pace_s_km
      ? Math.max(0.4, 1 - Math.max(0, Math.abs(o.intervals.avg_pace_s_km - o.reps.target) / o.reps.target - 0.02) * 4)
      : o.hrPlan?.reps ? Math.max(0.4, (o.hrPlan.reps_reaching ?? 0) / o.hrPlan.reps) : 1;
    inten = done * pace;
  } else if (o.power) {
    inten = Math.max(0.4, 1 - o.power.off * 3);
  } else if (easy && o.hrPlan) {
    inten = Math.min(1, o.hrPlan.pct_at_or_below / 90);
  } else if (o.hrLabel) {
    inten = o.hrLabel === "in the target zone" || (easy && o.hrLabel === "below the target zone") ? 1 : 0.6;
  }
  if (inten != null) parts.push({ key: "int", label: "Intensity", w: 45, v: inten });
  if (o.rpe && o.zoneRpe) {
    const off = o.rpe < o.zoneRpe[0] ? o.zoneRpe[0] - o.rpe : o.rpe > o.zoneRpe[1] ? o.rpe - o.zoneRpe[1] : 0;
    parts.push({ key: "rpe", label: "Feel", w: 20, v: off === 0 ? 1 : off === 1 ? 0.6 : 0.25 });
  }
  const total = parts.reduce((s, p) => s + p.w, 0);
  const score = Math.round((parts.reduce((s, p) => s + p.w * p.v, 0) / total) * 100);
  const label = score >= 85 ? "Nailed it" : score >= 70 ? "On plan" : score >= 50 ? "Partly there" : "Off plan";
  return { score, label, parts };
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-[#FAFAFA] truncate">{children}</p>
    </div>
  );
}

export function PlannedVsActual({ planSession, splits, activity, intervals, hrPlan, power }: {
  planSession: LinkedPlanSession;
  splits: ActivitySplit[];
  intervals?: AnalysisIntervals | null;
  hrPlan?: HrPlan | null;
  power?: PowerSummary | null;
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
  const reps = intervals ? repsVerdict(intervals, planSession, dz) : null;
  const isRideSession = /cycl|ride/i.test(planSession.discipline);
  // only measured power is judged against the watt band — never estimated watts on an outdoor ride
  const pw = isRideSession && !reps && !power?.estimated ? powerVerdict(power, planSession.intensity_zone, dz) : null;
  const zoneRpe = ZONE_RPE[planSession.intensity_zone];
  const rpeNote = rpe && zoneRpe
    ? rpe > zoneRpe[1] ? `Felt harder than a ${planSession.intensity_zone} session should (RPE ${zoneRpe[0]}–${zoneRpe[1]}) — fatigue, heat or under-fuelling?`
      : rpe < zoneRpe[0] ? `Felt easier than planned (${planSession.intensity_zone} ≈ RPE ${zoneRpe[0]}–${zoneRpe[1]})`
      : `Right where a ${planSession.intensity_zone} session should feel`
    : null;

  const score = sessionScore({
    durPct, zone: planSession.intensity_zone, rpe, zoneRpe: zoneRpe as [number, number] | undefined,
    reps, intervals, power: pw, hrPlan, hrLabel: verdict?.label,
  });
  const scoreColor = score.score >= 85 ? "#4ADE80" : score.score >= 70 ? "#F59E0B" : "#FB923C";

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
        {/* Session score — how closely it matched the plan */}
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#18181B" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={scoreColor} strokeWidth="3.5" strokeLinecap="round"
                      strokeDasharray={`${(score.score / 100) * 97.4} 97.4`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums">{score.score}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold" style={{ color: scoreColor }}>{score.label}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {score.parts.map((p) => (
                <span key={p.key} className="text-xs text-[#71717A] tabular-nums">
                  {p.label} <b className="text-[#D4D4D8]">{Math.round(p.v * p.w)}</b>/{p.w}
                </span>
              ))}
              {!rpe && <span className="text-xs text-[#52525B]">rate the feel below for the full score</span>}
            </div>
          </div>
        </div>

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
        {reps ? (
          <p className="text-sm text-[#A1A1AA]">
            {reps.planned ? <>Planned {reps.planned} at {reps.zone}</> : <>Target {reps.zone}</>}
            {reps.target ? <span className="text-[#71717A]"> (~{clock(reps.target)} /km)</span> : null}
            {" — "}you did {reps.did}
            {intervals?.avg_pace_s_km ? <> at {clock(intervals.avg_pace_s_km)} /km</> : null}
            {reps.pace ? <>, <b className={reps.pace.cls}>{reps.pace.label}</b></> : null}
            {reps.short ? <span className="text-[#FB923C]"> · {reps.setReps! - intervals!.count} rep{reps.setReps! - intervals!.count > 1 ? "s" : ""} short</span> : null}
          </p>
        ) : pw ? (
          <p className="text-sm text-[#A1A1AA]">
            Target {planSession.intensity_zone} {pw.lo ? `${pw.lo}–${pw.hi}` : `<${pw.hi}`} W —{" "}
            {pw.estimated ? "estimated" : ""} normalized power {pw.estimated ? "~" : ""}{pw.w} W was <b className={pw.cls}>{pw.label}</b>
            {verdict ? <span className="text-[#71717A]"> · HR {verdict.label.replace("the target zone", "zone")}</span> : null}
          </p>
        ) : verdict && (
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
