"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RaceReadinessPanel from "@/components/training/RaceReadinessPanel";
import { SessionActualStats } from "@/components/training/SessionActualStats";
import type { SessionActual } from "@/lib/api";
import { Target, ChevronDown, ChevronUp, Plus, X, RefreshCw, Calendar } from "lucide-react";
import {
  buildWorkoutDescription,
  resolveStructure,
  runZonesAsPaceZones,
  DisciplineZones,
  StructureStep,
} from "@/lib/workout-description";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────

interface RaceGoal {
  id: number;
  name: string;
  race_type: string;
  variant: string;
  race_date: string;
  plan_start_date: string | null;
  plan_start_display: string | null;
  status: string;
  available_days: string[];
  days_until_race: number;
  weeks_until_race: number;
  current_phase: string;
  current_week: number;
  total_weeks: number;
  weeks_materialized: number;
  waiting: boolean;
  last_adaptation: AdaptationResult | null;
  target_time: string | null;
}

interface AdaptationResult {
  recommendation: string;
  explanation: string;
  readiness_score: number;
  risk_level: string;
  volume_factor: number;
  intensity_factor: number;
  confidence: number;
}

interface WeekDay {
  date: string;
  day_name: string;
  sessions: PlanSession[];
  roster: string | null;
}

interface PlanSession {
  id: number;
  goal_id: number;
  session_type: string;
  discipline: string;
  effective_duration_min: number;
  duration_min: number;
  intensity_zone: string;
  is_optional: boolean;
  status: string;
  week_number: number;
  session_date: string;
  rpe_actual: number | null;
  notes: string | null;
  structure: StructureStep[] | null;
  auto_matched: boolean;
  actual: SessionActual | null;
}

interface GoalCreate {
  name: string;
  race_type: string;
  variant: string;
  race_date: string;
  available_days: string[];
  respect_roster: boolean;
  target_time?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ZONE_COLOUR: Record<string, string> = {
  Z1: "#A1A1AA", Z2: "#4ADE80", Z3: "#FB923C", Z4: "#F87171", Z5: "#FCA5A5",
};
const ZONE_BG: Record<string, string> = {
  Z1: "#3F3F46", Z2: "#052E16", Z3: "#431407", Z4: "#450A0A", Z5: "#4C0519",
};
const ZONE_DESC: Record<string, string> = {
  Z1: "Recovery — conversational, HR <55%",
  Z2: "Endurance — easy aerobic, 56–75% HR / RPE 4–5",
  Z3: "Tempo / sweet spot — 76–90% HR / RPE 6–7",
  Z4: "Threshold — 91–105% HR / RPE 8–9",
  Z5: "VO2max / all out — >105% HR / RPE 10",
};
const DISC_ICON: Record<string, string> = {
  running: "🏃", ride: "🚴", swimming: "🏊", brick: "⚡", other: "🏋️",
};
const PHASE_LABEL: Record<string, string> = {
  base_building: "Base", build: "Build", peak: "Peak", taper: "Taper", recovery: "Recovery",
};
const RACE_TYPE_LABELS: Record<string, string> = {
  half_marathon: "Half Marathon", marathon: "Marathon",
  olympic_tri: "Olympic Triathlon", half_ironman: "Half Ironman 70.3",
  ironman: "Full Ironman 140.6", gran_fondo_100: "Gran Fondo 100km", gran_fondo_160: "Gran Fondo 160km",
};
const RPE_LABELS: Record<number, string> = {
  1: "Very easy", 2: "Easy", 3: "Moderate easy", 4: "Moderate",
  5: "Somewhat hard", 6: "Hard", 7: "Very hard", 8: "Very very hard", 9: "Max effort", 10: "All out",
};

function todayStr() { return new Date().toISOString().slice(0, 10); }
function discIcon(d: string) { return DISC_ICON[d] ?? DISC_ICON.other; }

// ── Inline session detail sheet ────────────────────────────────────────────

const DISC_KEY: Record<string, "run" | "ride" | "swim"> = {
  running: "run", cycling: "ride", ride: "ride", swimming: "swim", swim: "swim",
};

function SessionDetailSheet({ session, onClose, onUpdate, disciplineZones }: {
  session: PlanSession; onClose: () => void; onUpdate: () => void; disciplineZones?: DisciplineZones;
}) {
  const [rpe, setRpe] = useState<number | null>(session.rpe_actual ?? null);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [done, setDone] = useState(session.status === "completed");
  const [err, setErr] = useState<string | null>(null);

  const zone = session.intensity_zone;
  const discKey = DISC_KEY[session.discipline] ?? "run";
  const sessionZone = disciplineZones?.[discKey]?.zones?.[zone];

  async function markDone() {
    if (!rpe) { setErr("Pick an RPE first"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", rpe_actual: rpe }),
      });
      if (!res.ok) throw new Error();
      setDone(true);
      onUpdate();
    } catch { setErr("Could not save"); }
    finally { setSaving(false); }
  }

  async function skip() {
    setSkipping(true);
    try {
      await fetch(`${BASE}/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
      onUpdate(); onClose();
    } catch { setErr("Could not skip"); }
    finally { setSkipping(false); }
  }

  // Log RPE on an already-completed session (e.g. one auto-matched from Garmin).
  async function saveRpe() {
    if (!rpe) { setErr("Pick an RPE first"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/race-plans/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpe_actual: rpe }),
      });
      if (!res.ok) throw new Error();
      onUpdate(); onClose();
    } catch { setErr("Could not save"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 pt-5 pb-10 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto mb-2" />

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-3xl">{discIcon(session.discipline)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#FAFAFA]">{session.session_type}</p>
            <p className="text-xs text-[#52525B]">{session.session_date} · Week {session.week_number}</p>
          </div>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] p-1"><X size={16} /></button>
        </div>

        {/* Zone card — shows target pace if available, else HR% */}
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background: ZONE_BG[zone] ?? "#18181B", border: `1px solid ${ZONE_COLOUR[zone] ?? "#27272A"}22` }}
        >
          <span className="text-lg font-bold" style={{ color: ZONE_COLOUR[zone] }}>{zone}</span>
          <div className="flex-1 min-w-0">
            {sessionZone?.display ? (
              <>
                <p className="text-sm font-semibold" style={{ color: ZONE_COLOUR[zone] }}>
                  Target: {sessionZone.display}
                  {discKey === "ride" && sessionZone.speed_kmh_hint ? ` · ~${sessionZone.speed_kmh_hint} km/h` : ""}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: `${ZONE_COLOUR[zone]}99` }}>
                  {sessionZone.label} · RPE {sessionZone.rpe}
                  {discKey === "ride" ? " · pace by HR/feel (no power)" : ""}
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: ZONE_COLOUR[zone] }}>{ZONE_DESC[zone] ?? ""}</p>
            )}
          </div>
        </div>

        {/* Actual — the real activity that fulfilled this session */}
        {session.actual && (
          <SessionActualStats
            actual={session.actual}
            autoMatched={session.auto_matched}
            sessionId={session.id}
            onUnlinked={() => { onUpdate(); onClose(); }}
          />
        )}

        {/* Workout phases */}
        {(() => {
          const phases = session.structure
            ? resolveStructure(session.structure, disciplineZones, session.discipline)
            : buildWorkoutDescription(session, runZonesAsPaceZones(disciplineZones));
          return (
            <div className="space-y-1.5">
              <p className="text-[10px] text-[#52525B] uppercase tracking-wider">Workout structure</p>
              {phases.map((phase, i) => {
                const dotColor = ZONE_COLOUR[phase.zone] ?? "#52525B";
                return (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="flex flex-col items-center pt-1 shrink-0">
                      <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                      {i < phases.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: `${dotColor}40`, minHeight: "20px" }} />}
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-semibold text-[#FAFAFA]">{phase.label}</p>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${dotColor}20`, color: dotColor }}>{phase.zone}</span>
                        <span className="text-[10px] text-[#52525B] tabular-nums ml-auto">{phase.duration_min}min</span>
                      </div>
                      <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">{phase.cue}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Stats row */}
        <div className="flex gap-4">
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex-1">
            <p className="text-[10px] text-[#52525B] uppercase tracking-wider mb-1">Duration</p>
            <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{session.effective_duration_min}<span className="text-sm font-normal text-[#52525B]"> min</span></p>
            {session.effective_duration_min !== session.duration_min && (
              <p className="text-[10px] text-[#52525B] mt-0.5">Planned {session.duration_min}m · adjusted by plan</p>
            )}
          </div>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex-1">
            <p className="text-[10px] text-[#52525B] uppercase tracking-wider mb-1">Discipline</p>
            <p className="text-xl">{discIcon(session.discipline)}</p>
            <p className="text-xs text-[#A1A1AA] capitalize mt-0.5">{session.discipline}</p>
          </div>
        </div>

        {session.is_optional && (
          <p className="text-xs text-[#52525B] bg-[#18181B] rounded-lg px-3 py-2">
            Optional — skip freely if fatigue is high
          </p>
        )}

        {done && session.rpe_actual ? (
          <div className="bg-[#052E16] border border-[#14532D] rounded-xl px-4 py-4 text-center">
            <p className="text-2xl mb-1">✅</p>
            <p className="text-sm font-semibold text-[#4ADE80]">Session completed</p>
            <p className="text-xs text-[#52525B] mt-0.5">RPE {session.rpe_actual} · {RPE_LABELS[session.rpe_actual]}</p>
          </div>
        ) : (
          <>
            {/* RPE — logged after completing (auto-matched sessions start blank) */}
            <div className="space-y-2">
              <p className="text-xs text-[#71717A] uppercase tracking-wider">
                {done ? "Log your effort (RPE)" : "Rate effort (RPE)"}
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                  <button key={n} onClick={() => setRpe(n)}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${rpe === n ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] hover:bg-[#27272A]"}`}>
                    {n}
                  </button>
                ))}
              </div>
              {rpe && <p className="text-xs text-[#A1A1AA]">{RPE_LABELS[rpe]}</p>}
            </div>

            {err && <p className="text-xs text-[#F87171]">{err}</p>}

            {done ? (
              <button onClick={saveRpe} disabled={saving}
                className="w-full py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
                {saving ? "Saving…" : "Save RPE"}
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={markDone} disabled={saving}
                  className="flex-1 py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
                  {saving ? "Saving…" : "Mark done"}
                </button>
                <button onClick={skip} disabled={skipping}
                  className="px-5 py-3 bg-[#18181B] border border-[#27272A] text-[#71717A] text-sm rounded-xl hover:bg-[#27272A] disabled:opacity-50">
                  {skipping ? "…" : "Skip"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Week mini-calendar (tappable) ──────────────────────────────────────────

function WeekCalendar({ goalId, onSelectSession }: {
  goalId: number;
  onSelectSession: (s: PlanSession) => void;
}) {
  const today = todayStr();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["omyra-week", goalId, today],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goalId}/week?date=${today}`, { cache: "no-store" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  if (isLoading) return <div className="h-16 animate-pulse bg-[#18181B] rounded-lg" />;
  if (!data) return null;

  const days: WeekDay[] = data.days ?? [];

  return (
    <div className="grid grid-cols-7 gap-1 text-center">
      {days.map((d) => {
        const isToday = d.date === today;
        const hasDuty = d.roster === "FLT" || d.roster === "SBY";
        const visible = d.sessions.filter((s) => s.status === "pending" || s.status === "completed");
        const allDone = visible.length > 0 && visible.every((s) => s.status === "completed");

        return (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <span className={`text-[10px] ${isToday ? "text-[#FAFAFA] font-semibold" : "text-[#52525B]"}`}>
              {d.day_name.slice(0, 3)}
            </span>
            <button
              onClick={() => visible.length > 0 && onSelectSession(visible[0] as unknown as PlanSession)}
              disabled={visible.length === 0}
              className={`w-9 h-9 rounded-lg flex items-center justify-center relative transition-colors ${
                isToday ? "border border-[#52525B]" : "border border-transparent"
              } ${visible.length > 0 ? "bg-[#18181B] hover:bg-[#27272A] cursor-pointer" : "cursor-default"}`}
            >
              {hasDuty && <span className="text-[7px] absolute top-0.5 right-0.5 text-[#FACC15]">✈</span>}
              {visible.length > 0 ? (
                <div className="flex flex-col gap-0.5 items-center">
                  {visible.map((s, i) => (
                    <div key={i} className="w-2 h-2 rounded-full" style={{
                      background: s.status === "completed" ? "#4ADE80" : ZONE_COLOUR[s.intensity_zone] ?? "#52525B",
                    }} />
                  ))}
                </div>
              ) : (
                <span className="text-[10px] text-[#27272A]">·</span>
              )}
            </button>
            <span className="text-[9px] text-[#52525B] h-3">
              {allDone ? "✓" : visible.length > 0 ? `${visible.length}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Compliance ring ────────────────────────────────────────────────────────

function ComplianceRing({ rate }: { rate: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, rate);
  const color = rate >= 0.8 ? "#4ADE80" : rate >= 0.6 ? "#FB923C" : "#F87171";
  return (
    <svg width={44} height={44} viewBox="0 0 44 44">
      <circle cx={22} cy={22} r={r} fill="none" stroke="#27272A" strokeWidth={4} />
      <circle cx={22} cy={22} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 22 22)" />
      <text x={22} y={26} textAnchor="middle" fontSize={9} fill={color} fontWeight="600">
        {Math.round(rate * 100)}%
      </text>
    </svg>
  );
}

// ── Full schedule view (today → race day) ─────────────────────────────────

function FullSchedule({ goal, onSelectSession, onClose }: {
  goal: RaceGoal;
  onSelectSession: (s: PlanSession) => void;
  onClose: () => void;
}) {
  const today = todayStr();
  const { data, isLoading } = useQuery<PlanSession[]>({
    queryKey: ["omyra-all-sessions", goal.id],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goal.id}/sessions`, { cache: "no-store" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  const sessions = data ?? [];

  // Group by week number
  const byWeek: Record<number, PlanSession[]> = {};
  for (const s of sessions) {
    (byWeek[s.week_number] ??= []).push(s);
  }
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#09090B]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[#18181B]">
        <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] p-1"><X size={18} /></button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#FAFAFA] truncate">{goal.name}</p>
          <p className="text-xs text-[#52525B]">{goal.race_date} · {goal.weeks_until_race}w to go</p>
        </div>
        <Calendar size={16} className="text-[#52525B]" />
      </div>

      {/* Legend */}
      <div className="flex gap-3 px-4 py-2 border-b border-[#18181B] overflow-x-auto">
        {Object.entries(ZONE_COLOUR).map(([z, c]) => (
          <div key={z} className="flex items-center gap-1 shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: c }} />
            <span className="text-[10px] text-[#52525B]">{z}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-2 h-2 rounded-full bg-[#4ADE80]" />
          <span className="text-[10px] text-[#52525B]">Done</span>
        </div>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isLoading && (
          <div className="space-y-2">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-12 animate-pulse bg-[#18181B] rounded-xl" />)}
          </div>
        )}

        {!isLoading && weeks.length === 0 && (
          <p className="text-sm text-[#52525B] text-center py-10">No upcoming sessions</p>
        )}

        {weeks.map((wk) => {
          const wkSessions = byWeek[wk];
          const totalWeeks = goal.total_weeks;
          const fraction = wk / totalWeeks;
          let phase = "Base";
          if (fraction > 0.85) phase = "Taper";
          else if (fraction > 0.65) phase = "Peak";
          else if (fraction > 0.35) phase = "Build";

          const allDone = wkSessions.every((s) => s.status === "completed");
          const doneCt = wkSessions.filter((s) => s.status === "completed").length;

          return (
            <div key={wk}>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-[#52525B] uppercase tracking-wider">
                  Week {wk} · {phase}
                </p>
                {doneCt > 0 && (
                  <span className="text-[10px] text-[#4ADE80]">{doneCt}/{wkSessions.length} done</span>
                )}
              </div>
              <div className="space-y-1.5">
                {wkSessions.map((s) => {
                  const isCompleted = s.status === "completed";
                  const isSkipped = s.status === "skipped";
                  const isMissed = s.status === "pending" && s.session_date < today;
                  // Everything except a skipped session is tappable: future to
                  // plan/complete, completed to log RPE / see the linked activity,
                  // missed to submit retroactively or move.
                  const openable = !isSkipped;
                  return (
                    <button
                      key={s.id}
                      onClick={() => openable && onSelectSession(s)}
                      disabled={!openable}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                        isCompleted
                          ? "bg-[#052E16] border-[#14532D] opacity-70 hover:opacity-100"
                          : isSkipped
                          ? "bg-[#18181B] border-[#27272A] opacity-30 cursor-default"
                          : isMissed
                          ? "bg-[#18181B] border-[#27272A] opacity-50 hover:opacity-100 hover:border-[#3F3F46]"
                          : "bg-[#0D0D0F] border-[#27272A] hover:border-[#3F3F46]"
                      }`}
                    >
                      <span className="text-base">{discIcon(s.discipline)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${isMissed ? "line-through text-[#52525B]" : "text-[#FAFAFA]"}`}>{s.session_type}</p>
                        <p className="text-[10px] text-[#52525B]">{s.session_date}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isCompleted && <span className="text-xs text-[#4ADE80]">✓</span>}
                        {isSkipped && <span className="text-xs text-[#52525B]">–</span>}
                        {isMissed && <span className="text-xs text-[#F87171]">✗</span>}
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: ZONE_BG[s.intensity_zone], color: ZONE_COLOUR[s.intensity_zone] }}
                        >
                          {s.intensity_zone}
                        </span>
                        <span className="text-[10px] text-[#52525B] tabular-nums w-8 text-right">
                          {s.effective_duration_min}m
                        </span>
                        {openable && <span className="text-[#3F3F46] text-xs">›</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Race day marker */}
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-[#1C1700] border border-[#B45309]">
          <span className="text-lg">🏁</span>
          <div>
            <p className="text-xs font-semibold text-[#FCD34D]">Race Day</p>
            <p className="text-[10px] text-[#92400E]">{goal.race_date}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Goal card ──────────────────────────────────────────────────────────────

interface AdaptationLogRow {
  id: number;
  date: string;
  week_number: number | null;
  readiness_score: number | null;
  risk_level: string | null;
  recommendation: string;
  volume_factor: number | null;
  intensity_factor: number | null;
  narrative: string | null;
}

const REC_LABEL: Record<string, string> = {
  progressive_overload: "Push", maintain_intensity: "Hold intensity", maintain_course: "Stay the course",
  reduce_volume: "Cut volume", reduce_intensity: "Ease intensity", active_recovery: "Active recovery",
  complete_rest: "Rest",
};

function AdaptationHistory({ goalId }: { goalId: number }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<AdaptationLogRow[]>({
    queryKey: ["omyra-adaptations", goalId],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goalId}/adaptations`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    enabled: open,
    staleTime: 60_000,
  });
  const rows = data ?? [];
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-[#52525B] uppercase tracking-wider hover:text-[#A1A1AA]"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Adaptation history
      </button>
      {open &&
        (rows.length === 0 ? (
          <p className="text-xs text-[#3F3F46] mt-2">No adaptations logged yet — hit Re-evaluate.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="bg-[#18181B] rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-[#52525B] tabular-nums">{r.date}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0D0D0F] text-[#A1A1AA]">
                    {REC_LABEL[r.recommendation] ?? r.recommendation}
                  </span>
                  <span className="text-[10px] text-[#3F3F46]">
                    V×{(r.volume_factor ?? 1).toFixed(2)} I×{(r.intensity_factor ?? 1).toFixed(2)}
                  </span>
                  {r.readiness_score != null && (
                    <span className="text-[10px] text-[#3F3F46]">R {Math.round(r.readiness_score)}</span>
                  )}
                </div>
                {r.narrative && <p className="text-[11px] text-[#71717A] mt-1 leading-relaxed">{r.narrative}</p>}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function GoalCard({ goal, onRefresh }: { goal: RaceGoal; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedSession, setSelectedSession] = useState<PlanSession | null>(null);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const queryClient = useQueryClient();

  const { data: compliance } = useQuery({
    queryKey: ["omyra-compliance", goal.id],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goal.id}/compliance`, { cache: "no-store" }).then((r) => r.json()),
    enabled: !goal.waiting,
    staleTime: 120_000,
  });

  const { data: upcomingSessions } = useQuery<PlanSession[]>({
    queryKey: ["omyra-upcoming", goal.id],
    queryFn: async () => {
      const all: PlanSession[] = await fetch(
        `${BASE}/race-plans/goals/${goal.id}/sessions?status=pending`,
        { cache: "no-store" }
      ).then((r) => r.json());
      const today = todayStr();
      return all.filter((s) => s.session_date >= today).slice(0, 15);
    },
    enabled: expanded && !goal.waiting,
    staleTime: 60_000,
  });

  const { data: disciplineZones } = useQuery<DisciplineZones>({
    queryKey: ["omyra-discipline-zones", goal.id],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goal.id}/discipline-zones`, { cache: "no-store" }).then((r) => r.json()),
    enabled: !goal.waiting,
    staleTime: 86_400_000, // 24h — zones don't change often
  });

  async function abandon() {
    await fetch(`${BASE}/race-plans/goals/${goal.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "abandoned" }),
    });
    onRefresh();
  }

  async function complete() {
    await fetch(`${BASE}/race-plans/goals/${goal.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    onRefresh();
  }

  async function deleteGoal() {
    await fetch(`${BASE}/race-plans/goals/${goal.id}`, { method: "DELETE" });
    onRefresh();
  }

  async function reEvaluate() {
    setAdapting(true);
    try {
      await fetch(`${BASE}/race-plans/goals/${goal.id}/adapt`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["omyra-goals"] });
      queryClient.invalidateQueries({ queryKey: ["omyra-compliance", goal.id] });
    } finally { setAdapting(false); }
  }

  async function startEarly() {
    await fetch(`${BASE}/race-plans/goals/${goal.id}/start-early`, { method: "POST" });
    onRefresh();
  }

  const [rematerializing, setRematerializing] = useState(false);
  async function rematerialize() {
    setRematerializing(true);
    try {
      await fetch(`${BASE}/race-plans/goals/${goal.id}/rematerialize`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["omyra-upcoming", goal.id] });
      queryClient.invalidateQueries({ queryKey: ["omyra-all-sessions", goal.id] });
      queryClient.invalidateQueries({ queryKey: ["omyra-week", goal.id] });
      queryClient.invalidateQueries({ queryKey: ["omyra-compliance", goal.id] });
      onRefresh();
    } finally { setRematerializing(false); }
  }

  function invalidateWeek() {
    queryClient.invalidateQueries({ queryKey: ["omyra-week", goal.id] });
    queryClient.invalidateQueries({ queryKey: ["omyra-upcoming", goal.id] });
    queryClient.invalidateQueries({ queryKey: ["omyra-all-sessions", goal.id] });
    queryClient.invalidateQueries({ queryKey: ["omyra-compliance", goal.id] });
  }

  const isAbandoned = goal.status === "abandoned";
  const isCompleted = goal.status === "completed";
  const dim = isAbandoned || isCompleted;
  const overallRate = compliance?.overall_compliance ?? 0;

  // Group upcoming by week number
  const byWeek: Record<number, PlanSession[]> = {};
  if (upcomingSessions) {
    for (const s of upcomingSessions) { (byWeek[s.week_number] ??= []).push(s); }
  }

  return (
    <>
      <div className={`bg-[#0D0D0F] border rounded-xl overflow-hidden ${dim ? "border-[#18181B] opacity-60" : "border-[#27272A]"}`}>
        <div className="px-4 py-4">
          {/* Header row */}
          <div className="flex items-start gap-3">
            {!goal.waiting && !dim && <ComplianceRing rate={overallRate} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-[#FAFAFA] truncate">{goal.name}</p>
                {isCompleted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#052E16] text-[#4ADE80]">Completed</span>}
                {isAbandoned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#27272A] text-[#52525B]">Abandoned</span>}
              </div>
              <p className="text-xs text-[#52525B] mt-0.5">
                {RACE_TYPE_LABELS[goal.race_type] ?? goal.race_type}
                {goal.variant !== "balanced" && ` · ${goal.variant}`}
              </p>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs text-[#A1A1AA]">{goal.race_date} · {goal.weeks_until_race}w to go</span>
                {!goal.waiting && (
                  <span className="text-xs text-[#52525B]">
                    Wk {goal.current_week}/{goal.total_weeks} · {PHASE_LABEL[goal.current_phase] ?? goal.current_phase}
                  </span>
                )}
                {goal.waiting && goal.plan_start_display && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#18181B] border border-[#27272A] text-[#52525B]">
                    Starts {goal.plan_start_display}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setExpanded((v) => !v)} className="text-[#52525B] hover:text-[#A1A1AA] p-1">
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {/* Adaptation note */}
          {goal.last_adaptation && !dim && (
            <p className="text-xs text-[#71717A] mt-3 bg-[#18181B] rounded-lg px-3 py-2">
              {goal.last_adaptation.explanation}
              <span className="text-[#3F3F46] ml-2">
                V×{goal.last_adaptation.volume_factor.toFixed(2)} I×{goal.last_adaptation.intensity_factor.toFixed(2)}
              </span>
            </p>
          )}
        </div>

        {/* Expanded */}
        {expanded && (
          <div className="border-t border-[#18181B] px-4 py-4 space-y-5">

            {/* Adaptation history */}
            {!goal.waiting && <AdaptationHistory goalId={goal.id} />}

            {/* This week calendar */}
            {!goal.waiting && !dim && (
              <div>
                <p className="text-xs text-[#52525B] uppercase tracking-wider mb-2">This Week</p>
                <WeekCalendar goalId={goal.id} onSelectSession={setSelectedSession} />
              </div>
            )}

            {/* Upcoming sessions */}
            {!goal.waiting && !dim && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[#52525B] uppercase tracking-wider">Upcoming</p>
                  <button
                    onClick={() => setShowFullSchedule(true)}
                    className="text-[10px] text-[#52525B] hover:text-[#A1A1AA] flex items-center gap-1"
                  >
                    <Calendar size={10} /> Full schedule
                  </button>
                </div>
                {!upcomingSessions && <div className="h-8 animate-pulse bg-[#18181B] rounded-lg" />}
                {upcomingSessions && Object.keys(byWeek).length === 0 && (
                  <p className="text-xs text-[#3F3F46] py-2">No upcoming sessions</p>
                )}
                {upcomingSessions && Object.entries(byWeek).slice(0, 3).map(([wk, sessions]) => (
                  <div key={wk} className="mb-3">
                    <p className="text-[10px] text-[#3F3F46] mb-1.5 uppercase tracking-wider">Week {wk}</p>
                    <div className="space-y-1">
                      {sessions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSession(s)}
                          className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg bg-[#18181B] hover:bg-[#27272A] transition-colors"
                        >
                          <span className="text-sm">{discIcon(s.discipline)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[#A1A1AA] truncate">{s.session_type}</p>
                            <p className="text-[10px] text-[#3F3F46]">{s.session_date}</p>
                          </div>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: ZONE_BG[s.intensity_zone], color: ZONE_COLOUR[s.intensity_zone] }}
                          >{s.intensity_zone}</span>
                          <span className="text-[10px] text-[#52525B] tabular-nums w-8 text-right shrink-0">
                            {s.effective_duration_min}m
                          </span>
                          <span className="text-[#3F3F46] text-xs">›</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {upcomingSessions && Object.keys(byWeek).length > 3 && (
                  <button
                    onClick={() => setShowFullSchedule(true)}
                    className="w-full text-xs text-[#52525B] hover:text-[#A1A1AA] py-2 border border-dashed border-[#27272A] rounded-lg"
                  >
                    View all {upcomingSessions.length} sessions until race day →
                  </button>
                )}
              </div>
            )}

            {/* Compliance bars */}
            {compliance?.weeks?.length > 0 && (
              <div>
                <p className="text-xs text-[#52525B] uppercase tracking-wider mb-2">
                  Compliance
                </p>
                <div className="space-y-1.5">
                  {compliance.weeks.slice(-4).map((w: { week: number; completed: number; planned: number; rate: number; missed: number }) => (
                    <div key={w.week} className="flex items-center gap-2">
                      <span className="text-[10px] text-[#3F3F46] w-7">W{w.week}</span>
                      <div className="flex-1 h-1.5 bg-[#18181B] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, w.rate * 100)}%`,
                          background: w.rate >= 0.8 ? "#4ADE80" : w.rate >= 0.6 ? "#FB923C" : "#F87171",
                        }} />
                      </div>
                      <span className="text-[10px] text-[#52525B] tabular-nums w-12 text-right">
                        {w.completed}/{w.planned}
                      </span>
                      {w.missed > 0 && <span className="text-[10px] text-[#F87171]">{w.missed}×</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 flex-wrap border-t border-[#18181B] pt-3">
              {!dim && !goal.waiting && (
                <button onClick={reEvaluate} disabled={adapting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#A1A1AA] hover:bg-[#27272A] disabled:opacity-50">
                  <RefreshCw size={11} className={adapting ? "animate-spin" : ""} />
                  {adapting ? "Evaluating…" : "Re-evaluate"}
                </button>
              )}
              {!dim && !goal.waiting && (
                <button onClick={rematerialize} disabled={rematerializing}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#A1A1AA] hover:bg-[#27272A] disabled:opacity-50">
                  <RefreshCw size={11} className={rematerializing ? "animate-spin" : ""} />
                  {rematerializing ? "Regenerating…" : "Regenerate plan"}
                </button>
              )}
              {goal.waiting && (
                <button onClick={startEarly}
                  className="text-xs px-3 py-1.5 bg-[#052E16] border border-[#14532D] rounded-lg text-[#4ADE80] hover:bg-[#14532D]">
                  Start plan early
                </button>
              )}
              {!isCompleted && !isAbandoned && (
                <button onClick={complete}
                  className="text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#52525B] hover:text-[#A1A1AA]">
                  Mark completed
                </button>
              )}
              {!isAbandoned && !isCompleted && (
                <button onClick={abandon}
                  className="text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#52525B] hover:text-[#F87171]">
                  Abandon
                </button>
              )}
              {/* Delete with confirmation */}
              <div className="ml-auto flex items-center gap-2">
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)}
                    className="text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#3F3F46] hover:text-[#F87171]">
                    Delete
                  </button>
                ) : (
                  <>
                    <span className="text-xs text-[#F87171]">Delete all data?</span>
                    <button onClick={deleteGoal}
                      className="text-xs px-3 py-1.5 bg-[#450A0A] border border-[#7F1D1D] rounded-lg text-[#F87171] hover:bg-[#7F1D1D]">
                      Yes
                    </button>
                    <button onClick={() => setConfirmDelete(false)}
                      className="text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#52525B]">
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Session detail sheet */}
      {selectedSession && (
        <SessionDetailSheet
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onUpdate={() => { invalidateWeek(); setSelectedSession(null); }}
          disciplineZones={disciplineZones}
        />
      )}

      {/* Full schedule overlay */}
      {showFullSchedule && (
        <FullSchedule
          goal={goal}
          onSelectSession={(s) => { setShowFullSchedule(false); setSelectedSession(s); }}
          onClose={() => setShowFullSchedule(false)}
        />
      )}
    </>
  );
}

// ── Create goal sheet ──────────────────────────────────────────────────────

const RACE_TYPES = [
  { key: "marathon",       label: "Marathon",           variants: ["balanced", "polarized"] },
  { key: "half_marathon",  label: "Half Marathon",      variants: ["balanced", "polarized"] },
  { key: "ironman",        label: "Full Ironman 140.6", variants: ["balanced", "polarized"] },
  { key: "half_ironman",   label: "Half Ironman 70.3",  variants: ["balanced", "polarized"] },
  { key: "olympic_tri",    label: "Olympic Tri",        variants: ["balanced"] },
  { key: "gran_fondo_160", label: "Gran Fondo 160km",   variants: ["balanced"] },
  { key: "gran_fondo_100", label: "Gran Fondo 100km",   variants: ["balanced"] },
];

const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function CreateGoalSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<GoalCreate>({
    name: "", race_type: "marathon", variant: "balanced", race_date: "",
    available_days: ["Monday", "Wednesday", "Friday", "Saturday", "Sunday"],
    respect_roster: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = RACE_TYPES.find((t) => t.key === form.race_type)!;
  const hasVariants = selectedType.variants.length > 1;

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      available_days: f.available_days.includes(day)
        ? f.available_days.filter((d) => d !== day)
        : [...f.available_days, day],
    }));
  }

  async function submit() {
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.race_date) { setError("Race date is required"); return; }
    if (form.available_days.length < 3) { setError("Need at least 3 available days"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${BASE}/race-plans/goals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? "Failed"); }
      onCreated(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-[#FAFAFA]">New Race Goal</p>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={18} /></button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Event name</label>
          <input type="text" placeholder="e.g. Ironman Klagenfurt 2027" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]" />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Goal type</label>
          <div className="grid grid-cols-2 gap-1.5">
            {RACE_TYPES.map((t) => (
              <button key={t.key}
                onClick={() => setForm((f) => ({ ...f, race_type: t.key, variant: t.variants[0] }))}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  form.race_type === t.key
                    ? "bg-[#27272A] text-[#FAFAFA] border border-[#52525B]"
                    : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {hasVariants && (
          <div className="space-y-1.5">
            <label className="text-xs text-[#71717A] uppercase tracking-wider">Training style</label>
            <div className="flex gap-2">
              {selectedType.variants.map((v) => (
                <button key={v} onClick={() => setForm((f) => ({ ...f, variant: v }))}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    form.variant === v ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                  }`}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#52525B]">
              {form.variant === "balanced"
                ? "Trains all zones (Z2→Z5). Good all-round development."
                : "80% easy (Z1/Z2) + 20% very hard (Z5). Best for high-volume athletes."}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Race / event date</label>
          <input type="date" value={form.race_date}
            onChange={(e) => setForm((f) => ({ ...f, race_date: e.target.value }))}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]" />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">
            Training days <span className="text-[#3F3F46]">(min 3)</span>
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {ALL_DAYS.map((d) => (
              <button key={d} onClick={() => toggleDay(d)}
                className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  form.available_days.includes(d)
                    ? "bg-[#FAFAFA] text-[#09090B] font-medium"
                    : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}>
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">
            Target finish time <span className="text-[#3F3F46]">(optional — unlocks personalized pace zones)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text" placeholder="e.g. 1:55:00 or 3:30:00"
              value={form.target_time ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, target_time: e.target.value || undefined }))}
              className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B] font-mono"
            />
          </div>
          <p className="text-[10px] text-[#3F3F46]">Format: h:mm:ss — used to calculate your Z1–Z5 paces. Can be set later.</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#A1A1AA]">Respect roster</p>
            <p className="text-xs text-[#52525B]">Flag FLT/SBY days with a warning</p>
          </div>
          <button onClick={() => setForm((f) => ({ ...f, respect_roster: !f.respect_roster }))}
            className={`w-10 h-5 rounded-full transition-colors relative ${form.respect_roster ? "bg-[#4ADE80]" : "bg-[#27272A]"}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.respect_roster ? "left-5" : "left-0.5"}`} />
          </button>
        </div>

        {error && <p className="text-xs text-[#F87171]">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
          {saving ? "Creating…" : "Create goal"}
        </button>
      </div>
    </div>
  );
}

// ── Main OmyraTab ──────────────────────────────────────────────────────────

export default function OmyraTab() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: goals = [], isLoading, refetch } = useQuery<RaceGoal[]>({
    queryKey: ["omyra-goals"],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals`, { cache: "no-store" }).then((r) => r.json()),
    staleTime: 30_000,
  });

  // Fetch today's ramp_rate for injury risk banner
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayPrescription } = useQuery({
    queryKey: ["omyra-day-ctx", today],
    queryFn: () =>
      fetch(`/api/race-plans/day/${today}`).then((r) => r.ok ? r.json() : null).catch(() => null),
    staleTime: 300_000,
  });
  const rampRate: number | null = todayPrescription?.readiness_context?.ramp_rate ?? null;

  function refresh() {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["omyra-goals"] });
  }

  const active = goals.filter((g) => g.status === "active");
  const done = goals.filter((g) => g.status !== "active");

  return (
    <div className="space-y-8">
      {/* Ramp rate safety warning */}
      {rampRate != null && rampRate > 7 && (
        <div className="bg-[#1C0A0A] border border-[#7F1D1D] rounded-xl px-4 py-3 flex items-start gap-2">
          <span className="text-sm shrink-0">⚠️</span>
          <p className="text-xs text-[#FCA5A5]">
            Weekly CTL ramp is high ({rampRate.toFixed(1)} pts/wk — safe limit is 7). Injury risk elevated. Consider an easier week before adding more load.
          </p>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Goals</p>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[#A1A1AA] hover:bg-[#27272A]">
            <Plus size={12} /> Add goal
          </button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1,2].map((i) => <div key={i} className="h-24 animate-pulse bg-[#18181B] rounded-xl" />)}
          </div>
        )}

        {!isLoading && active.length === 0 && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-8 text-center">
            <Target size={24} className="mx-auto text-[#3F3F46] mb-3" />
            <p className="text-sm text-[#52525B]">No active goals yet</p>
            <p className="text-xs text-[#3F3F46] mt-1">Add a race or event to get a personalised training plan</p>
          </div>
        )}

        {active.map((g) => <GoalCard key={g.id} goal={g} onRefresh={refresh} />)}
      </section>

      <section className="space-y-4">
        <p className="text-xs text-[#52525B] uppercase tracking-widest">Readiness</p>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <RaceReadinessPanel
            defaultRaceDate={(active[0] ?? done[0])?.race_date ?? ""}
            goalName={(active[0] ?? done[0])?.name ?? undefined}
            raceType={(active[0] ?? done[0])?.race_type ?? undefined}
          />
        </div>
      </section>

      {done.length > 0 && (
        <section className="space-y-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Past goals</p>
          {done.map((g) => <GoalCard key={g.id} goal={g} onRefresh={refresh} />)}
        </section>
      )}

      {showCreate && (
        <CreateGoalSheet onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
    </div>
  );
}
