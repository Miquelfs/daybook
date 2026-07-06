"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/MorningBrief";
import { buildWorkoutDescription, PaceZones } from "@/lib/workout-description";

// Zone badge colours
const ZONE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  Z1: { bg: "bg-[#27272A]",  text: "text-[#A1A1AA]", label: "Recovery — conversational pace, HR <55% max" },
  Z2: { bg: "bg-[#052E16]",  text: "text-[#4ADE80]", label: "Endurance — easy aerobic, 56–75% max HR / RPE 4–5" },
  Z3: { bg: "bg-[#422006]",  text: "text-[#FB923C]", label: "Tempo / sweet spot — 76–90% max HR / RPE 6–7" },
  Z4: { bg: "bg-[#431407]",  text: "text-[#F87171]", label: "Threshold — 91–105% max HR / RPE 8–9" },
  Z5: { bg: "bg-[#450A0A]",  text: "text-[#FCA5A5]", label: "VO2max / all out — >105% max HR / RPE 10" },
};

const ZONE_DOT: Record<string, string> = {
  Z1: "#A1A1AA", Z2: "#4ADE80", Z3: "#FB923C", Z4: "#F87171", Z5: "#FCA5A5",
};

const PHASE_LABEL: Record<string, string> = {
  base_building: "Base", build: "Build", peak: "Peak", taper: "Taper", recovery: "Recovery",
};

const DISC_ICON: Record<string, string> = {
  running: "🏃", ride: "🚴", swimming: "🏊", brick: "⚡", other: "🏋️",
};

const RPE_LABELS: Record<number, string> = {
  1: "Very easy", 2: "Easy", 3: "Moderate easy", 4: "Moderate",
  5: "Somewhat hard", 6: "Hard", 7: "Very hard", 8: "Very very hard",
  9: "Max effort", 10: "All out",
};

function disciplineIcon(disc: string) { return DISC_ICON[disc] ?? DISC_ICON.other; }

interface PlanSession {
  id: number;
  goal_id: number;
  goal_name: string;
  session_type: string;
  discipline: string;
  effective_duration_min: number;
  duration_min: number;
  intensity_zone: string;
  is_optional: boolean;
  status: string;
  adaptation_note: string | null;
  roster_warning: string | null;
  rpe_actual: number | null;
  current_phase: string | null;
  current_week: number | null;
  total_weeks: number | null;
}

interface InjurySuggestion {
  injury_id: number;
  zone: string;
  activity_type: string;
  affected_sessions: number[];
  message: string;
}

interface ReadinessContext {
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  hrv_status: string | null;
  roster_today: string | null;
  overall_signal: string;
  fatigue_score: number | null;
  recovery_status: string | null;
  body_battery: number | null;
  garmin_readiness: number | null;
  ramp_rate: number | null;
}

interface DayPrescription {
  sessions: PlanSession[];
  readiness_context: ReadinessContext | null;
  load_warning: string | null;
  conflict_warning: string | null;
  injury_suggestions: InjurySuggestion[];
}

// ── Readiness bar ───────────────────────────────────────────────────────────

// Body battery already lives in the health KPIs above — this strip is about
// what the numbers mean for training: readiness ring, recovery state, form.
function ReadinessBar({ ctx }: { ctx: ReadinessContext }) {
  const readiness = ctx.garmin_readiness;
  const status = ctx.recovery_status;
  const tsb = ctx.tsb;

  const statusMeta: Record<string, { dot: string; label: string; hint: string }> = {
    recovering:   { dot: "#4ADE80", label: "Recovering",  hint: "absorbing load" },
    balanced:     { dot: "#A1A1AA", label: "Balanced",    hint: "steady state" },
    accumulating: { dot: "#F87171", label: "Fatigued",    hint: "load piling up" },
  };

  const readinessColor = readiness == null ? "#3F3F46"
    : readiness >= 70 ? "#4ADE80"
    : readiness >= 40 ? "#FB923C"
    : "#F87171";

  const formMeta = tsb == null ? null
    : tsb >= 15 ? { color: "#4ADE80", label: "fresh" }
    : tsb >= -10 ? { color: "#A1A1AA", label: "optimal" }
    : tsb >= -25 ? { color: "#FB923C", label: "productive" }
    : { color: "#F87171", label: "overreaching" };

  const hasAny = readiness != null || status != null || tsb != null;
  if (!hasAny) return null;

  const R = 13;
  const C = 2 * Math.PI * R;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-5 flex-wrap">
      {readiness != null && (
        <div className="flex items-center gap-2.5" title="Garmin training readiness">
          <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90">
            <circle cx="17" cy="17" r={R} stroke="#27272A" strokeWidth="3.5" fill="none" />
            <circle
              cx="17" cy="17" r={R}
              stroke={readinessColor} strokeWidth="3.5" fill="none"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.min(readiness, 100) / 100)}
            />
          </svg>
          <div className="flex flex-col -ml-11 w-[34px] items-center pointer-events-none">
            <span className="text-[11px] font-semibold tabular-nums text-[#FAFAFA]">{readiness}</span>
          </div>
          <span className="text-[10px] text-[#52525B] uppercase tracking-wider">Readiness</span>
        </div>
      )}
      {status && statusMeta[status] && (
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusMeta[status].dot }} />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-[#D4D4D8]">{statusMeta[status].label}</span>
            <span className="text-[10px] text-[#52525B]">{statusMeta[status].hint}</span>
          </div>
        </div>
      )}
      {tsb != null && formMeta && (
        <div className="flex flex-col leading-tight ml-auto text-right" title="Training stress balance (CTL − ATL)">
          <span className="text-sm font-semibold tabular-nums" style={{ color: formMeta.color }}>
            {tsb > 0 ? "+" : ""}{tsb.toFixed(0)} <span className="text-[10px] font-normal">form</span>
          </span>
          <span className="text-[10px] text-[#52525B]">{formMeta.label}</span>
        </div>
      )}
      {ctx.roster_today && (
        <span className="text-[10px] px-2 py-0.5 rounded bg-[#1C1700] border border-[#B45309] text-[#FCD34D]">
          ✈ {ctx.roster_today}
        </span>
      )}
    </div>
  );
}

// ── Session detail sheet ────────────────────────────────────────────────────

function SessionSheet({ session, date, onClose, onUpdate, paceZones }: {
  session: PlanSession; date: string; onClose: () => void; onUpdate: () => void; paceZones?: PaceZones;
}) {
  const [rpe, setRpe] = useState<number | null>(session.rpe_actual ?? null);
  const [marking, setMarking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const zone = ZONE_STYLE[session.intensity_zone] ?? ZONE_STYLE.Z2;
  const phases = buildWorkoutDescription(session, paceZones);

  async function markDone() {
    if (!rpe) { setError("Pick an RPE first"); return; }
    setMarking(true);
    try {
      const res = await fetch(`/api/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", rpe_actual: rpe }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
      onUpdate();
      setTimeout(onClose, 800);
    } catch { setError("Could not save"); }
    finally { setMarking(false); }
  }

  async function skipSession() {
    setSkipping(true);
    try {
      await fetch(`/api/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      onUpdate(); onClose();
    } catch { setError("Could not skip"); }
    finally { setSkipping(false); }
  }

  async function moveSession() {
    if (!moveDate) { setError("Pick a date"); return; }
    setMoving(true);
    try {
      const res = await fetch(`/api/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_date: moveDate }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail ?? "Failed");
      }
      onUpdate(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not move session");
    } finally { setMoving(false); }
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
        <div className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-12 text-center">
          <p className="text-3xl mb-3">✅</p>
          <p className="text-base font-semibold text-[#FAFAFA]">Session logged!</p>
          <p className="text-xs text-[#52525B] mt-1">RPE {rpe} · {RPE_LABELS[rpe!]}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto -mt-2 mb-1" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{disciplineIcon(session.discipline)}</span>
            <div>
              <p className="text-sm font-semibold text-[#FAFAFA]">{session.session_type}</p>
              <p className="text-xs text-[#52525B] mt-0.5">{session.goal_name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${zone.bg} ${zone.text}`}>
              {session.intensity_zone}
            </span>
            <span className="text-xs text-[#52525B] tabular-nums">{session.effective_duration_min} min</span>
          </div>
        </div>

        {/* Target pace banner — shown when pace zones are available */}
        {paceZones?.zones[session.intensity_zone] && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: `${ZONE_DOT[session.intensity_zone] ?? "#52525B"}10`, border: `1px solid ${ZONE_DOT[session.intensity_zone] ?? "#52525B"}30` }}
          >
            <span className="text-sm font-bold" style={{ color: ZONE_DOT[session.intensity_zone] }}>
              {paceZones.zones[session.intensity_zone].display}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px]" style={{ color: `${ZONE_DOT[session.intensity_zone] ?? "#52525B"}cc` }}>
                {paceZones.zones[session.intensity_zone].label} · HR {paceZones.zones[session.intensity_zone].hr_pct} max · RPE {paceZones.zones[session.intensity_zone].rpe}
              </p>
              {paceZones.source === "race_time" && paceZones.target_time && (
                <p className="text-[10px] text-[#3F3F46] mt-0.5">Based on target {paceZones.target_time}</p>
              )}
              {paceZones.source === "activity_history" && (
                <p className="text-[10px] text-[#3F3F46] mt-0.5">Derived from last {paceZones.window_days}d of training</p>
              )}
            </div>
          </div>
        )}

        {/* Workout phases */}
        <div className="space-y-2">
          <p className="text-[10px] text-[#52525B] uppercase tracking-wider">Workout structure</p>
          <div className="space-y-1.5">
            {phases.map((phase, i) => {
              const dotColor = ZONE_DOT[phase.zone] ?? "#52525B";
              return (
                <div key={i} className="flex gap-3 items-start">
                  {/* Timeline dot + line */}
                  <div className="flex flex-col items-center pt-1 shrink-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                    {i < phases.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: `${dotColor}40`, minHeight: "24px" }} />}
                  </div>
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold text-[#FAFAFA]">{phase.label}</p>
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: `${dotColor}20`, color: dotColor }}
                      >{phase.zone}</span>
                      <span className="text-[10px] text-[#52525B] tabular-nums ml-auto">{phase.duration_min} min</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">{phase.cue}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats row */}
        {session.effective_duration_min !== session.duration_min && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-4">
            <div>
              <p className="text-[10px] text-[#52525B]">Planned</p>
              <p className="text-sm font-semibold text-[#A1A1AA] tabular-nums">{session.duration_min} min</p>
            </div>
            <div>
              <p className="text-[10px] text-[#52525B]">Adjusted by plan</p>
              <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{session.effective_duration_min} min</p>
            </div>
          </div>
        )}

        {/* Warnings */}
        {session.adaptation_note && (
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#71717A]">📊 {session.adaptation_note}</p>
          </div>
        )}
        {session.roster_warning && (
          <div className="bg-[#1C1700] border border-[#B45309] rounded-xl px-4 py-3">
            <p className="text-xs text-[#FCD34D]">✈ {session.roster_warning}</p>
          </div>
        )}
        {session.is_optional && (
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#52525B]">Optional — skip freely if fatigue is high</p>
          </div>
        )}

        {/* RPE picker */}
        <div className="space-y-2">
          <p className="text-xs text-[#71717A] uppercase tracking-wider">Rate effort after completing (RPE)</p>
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button
                key={n}
                onClick={() => setRpe(n)}
                className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                  rpe === n ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] hover:bg-[#27272A]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {rpe && <p className="text-xs text-[#A1A1AA]">{RPE_LABELS[rpe]}</p>}
        </div>

        {/* Move to another day */}
        <div className="space-y-1.5 border-t border-[#18181B] pt-4">
          <p className="text-xs text-[#71717A] uppercase tracking-wider">Move to another day (same week only)</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={moveDate}
              onChange={(e) => setMoveDate(e.target.value)}
              className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
            />
            <button
              onClick={moveSession}
              disabled={moving}
              className="px-4 py-2 bg-[#27272A] rounded-lg text-xs text-[#A1A1AA] hover:bg-[#3F3F46] disabled:opacity-50"
            >
              {moving ? "Moving…" : "Move"}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-[#F87171]">{error}</p>}

        {/* Link to Omyra */}
        <div className="flex justify-center pt-1">
          <Link
            href="/training"
            onClick={onClose}
            className="text-xs text-[#F59E0B] hover:text-[#D97706] transition-colors"
          >
            View full plan →
          </Link>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={markDone}
            disabled={marking}
            className="flex-1 py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50"
          >
            {marking ? "Saving…" : "Mark done"}
          </button>
          <button
            onClick={skipSession}
            disabled={skipping}
            className="px-5 py-3 bg-[#18181B] border border-[#27272A] text-[#71717A] text-sm rounded-xl hover:bg-[#27272A] disabled:opacity-50"
          >
            {skipping ? "…" : "Skip"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function DayTraining({ initialPrescription, date }: {
  initialPrescription: DayPrescription | null;
  date: string;
}) {
  const [data, setData] = useState<DayPrescription | null>(initialPrescription);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [openSession, setOpenSession] = useState<PlanSession | null>(null);
  const [dismissedInjuries, setDismissedInjuries] = useState<number[]>([]);
  const [applyingInjury, setApplyingInjury] = useState<number | null>(null);
  const [paceZones, setPaceZones] = useState<PaceZones | undefined>(undefined);

  // Always client-fetch — SSR seed may fail on Pi (API_INTERNAL_URL unreachable from Next.js process).
  useEffect(() => {
    fetch(`/api/race-plans/day/${date}`)
      .then((r) => {
        if (!r.ok) { setFetchError(true); setLoading(false); return null; }
        return r.json();
      })
      .then((d) => {
        if (d !== null) {
          setData(d);
          setLoading(false);
          // Fetch pace zones for the first session's goal
          const firstGoalId = d.sessions?.[0]?.goal_id;
          if (firstGoalId) {
            fetch(`/api/race-plans/goals/${firstGoalId}/pace-zones`)
              .then((r) => r.ok ? r.json() : null)
              .then((z) => { if (z) setPaceZones(z); })
              .catch(() => {});
          }
        }
      })
      .catch(() => { setFetchError(true); setLoading(false); });
  }, [date]);

  async function refresh() {
    try {
      const res = await fetch(`/api/race-plans/day/${date}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {}
  }

  async function applyInjuryOverride(suggestion: InjurySuggestion, days: number) {
    setApplyingInjury(suggestion.injury_id);
    try {
      const sid = suggestion.affected_sessions[0];
      await fetch(`/api/race-plans/sessions/${sid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ injury_override: { zone: "Z1", duration_factor: 0.5, days } }),
      });
      setDismissedInjuries((p) => [...p, suggestion.injury_id]);
      refresh();
    } finally { setApplyingInjury(null); }
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <SectionLabel>Training</SectionLabel>
        <div className="h-16 animate-pulse bg-[#18181B] rounded-xl" />
      </section>
    );
  }

  // Fetch error — show a subtle message so it's diagnosable, doesn't break the page
  if (fetchError) {
    return (
      <section className="space-y-3">
        <SectionLabel>Training</SectionLabel>
        <p className="text-xs text-[#3F3F46] text-center py-2">Could not load training plan</p>
      </section>
    );
  }

  // No active goals
  if (!data) return null;

  const sessions = data.sessions ?? [];
  const ctx = data.readiness_context;

  return (
    <>
      <section className="space-y-3">
        <SectionLabel>Training</SectionLabel>

        {/* Readiness bar */}
        {ctx && <ReadinessBar ctx={ctx} />}

        {/* Injury banners */}
        {(data.injury_suggestions ?? [])
          .filter((s) => !dismissedInjuries.includes(s.injury_id))
          .map((s) => (
            <div key={s.injury_id} className="bg-[#1C0A0A] border border-[#7F1D1D] rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs text-[#F87171]">{s.message}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => applyInjuryOverride(s, 5)}
                  disabled={applyingInjury === s.injury_id}
                  className="text-xs px-3 py-1 bg-[#7F1D1D] text-[#FCA5A5] rounded-lg hover:bg-[#991B1B] disabled:opacity-50"
                >Apply 5 days</button>
                <button
                  onClick={() => applyInjuryOverride(s, 14)}
                  disabled={applyingInjury === s.injury_id}
                  className="text-xs px-3 py-1 bg-[#7F1D1D] text-[#FCA5A5] rounded-lg hover:bg-[#991B1B] disabled:opacity-50"
                >Apply 14 days</button>
                <button
                  onClick={() => setDismissedInjuries((p) => [...p, s.injury_id])}
                  className="text-xs px-3 py-1 bg-[#18181B] text-[#52525B] rounded-lg hover:bg-[#27272A]"
                >Dismiss</button>
              </div>
            </div>
          ))}

        {/* Load / conflict warnings */}
        {data.load_warning && (
          <div className="bg-[#1C1700] border border-[#B45309] rounded-xl px-4 py-3">
            <p className="text-xs text-[#FCD34D]">{data.load_warning}</p>
          </div>
        )}
        {data.conflict_warning && (
          <div className="bg-[#1C0A0A] border border-[#7F1D1D] rounded-xl px-4 py-3">
            <p className="text-xs text-[#F87171]">{data.conflict_warning}</p>
          </div>
        )}

        {/* Rest day */}
        {sessions.length === 0 && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 flex items-center gap-3">
            <span className="text-xl">😴</span>
            <div>
              <p className="text-sm text-[#A1A1AA] font-medium">Rest day</p>
              <p className="text-xs text-[#52525B] mt-0.5">No sessions scheduled — recover well</p>
            </div>
          </div>
        )}

        {/* Session cards */}
        {sessions.map((s) => {
          const zone = ZONE_STYLE[s.intensity_zone] ?? ZONE_STYLE.Z2;
          const isCompleted = s.status === "completed";
          return (
            <button
              key={s.id}
              onClick={() => setOpenSession(s)}
              className={`w-full text-left border rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors ${
                isCompleted
                  ? "bg-[#052E16] border-[#14532D] opacity-70"
                  : "bg-[#0D0D0F] border-[#27272A] hover:border-[#3F3F46]"
              }`}
            >
              <span className="text-xl">{disciplineIcon(s.discipline)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA] truncate">{s.session_type}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <p className="text-xs text-[#52525B]">{s.goal_name}</p>
                  {s.current_phase && s.current_week && s.total_weeks && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#18181B] border border-[#27272A] text-[#3F3F46] uppercase tracking-wider">
                      {PHASE_LABEL[s.current_phase] ?? s.current_phase} · Wk {s.current_week}/{s.total_weeks}
                    </span>
                  )}
                </div>
                {s.adaptation_note && (
                  <p className="text-xs text-[#71717A] mt-1 truncate">{s.adaptation_note}</p>
                )}
                {isCompleted && s.rpe_actual == null && (
                  <p className="text-[10px] text-[#FB923C] mt-1">Tap to log RPE →</p>
                )}
                {isCompleted && s.rpe_actual != null && (
                  <p className="text-[10px] text-[#4ADE80] mt-1">RPE {s.rpe_actual} logged ✓</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isCompleted && <span className="text-xs text-[#4ADE80]">✓</span>}
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${zone.bg} ${zone.text}`}>
                  {s.intensity_zone}
                </span>
                <span className="text-xs text-[#52525B] tabular-nums">{s.effective_duration_min}m</span>
                <span className="text-[#3F3F46]">›</span>
              </div>
            </button>
          );
        })}
      </section>

      {openSession && (
        <SessionSheet
          session={openSession}
          date={date}
          onClose={() => setOpenSession(null)}
          onUpdate={refresh}
          paceZones={paceZones}
        />
      )}
    </>
  );
}
