"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/MorningBrief";
import { SessionActualStats } from "@/components/training/SessionActualStats";
import type { SessionActual } from "@/lib/api";
import {
  buildWorkoutDescription,
  resolveStructure,
  runZonesAsPaceZones,
  DisciplineZones,
  StructureStep,
  WorkoutPhase,
} from "@/lib/workout-description";

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

interface FuelDuring { carbs_g_h: number; fluid_ml_h: number; sodium_mg_h: number; note: string; }
interface FuelPrePost { carbs_g: number; protein_g?: number; timing?: string; window?: string; note: string; }
interface GutTraining { is_target_session: boolean; target_carbs_g_h: number; note: string; }
interface Fueling {
  during: FuelDuring;
  pre: FuelPrePost | null;
  post: FuelPrePost | null;
  gut_training: GutTraining | null;
  duration_min: number;
}

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
  structure: StructureStep[] | null;
  days_until_race: number | null;
  fueling: Fueling | null;
  auto_matched: boolean;
  actual: SessionActual | null;
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

// Header row for the merged Training card — readiness ring, recovery state,
// form, roster badge. Body battery lives in the health KPIs above, so it's
// deliberately not repeated here. Renders nothing if there's no signal at
// all, so a card with only a roster badge doesn't get an empty ring either.
function ReadinessHeader({ ctx }: { ctx: ReadinessContext }) {
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

  const hasAny = readiness != null || status != null || tsb != null || ctx.roster_today;
  if (!hasAny) return null;

  const R = 13;
  const C = 2 * Math.PI * R;

  return (
    <div className="px-4 py-3 border-b border-[#18181B] flex items-center gap-5 flex-wrap">
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
        <span className={`text-[10px] px-2 py-0.5 rounded bg-[#1C1700] border border-[#B45309] text-[#FCD34D] ${tsb == null ? "ml-auto" : ""}`}>
          ✈ {ctx.roster_today}
        </span>
      )}
    </div>
  );
}

// ── Benchmark test form ─────────────────────────────────────────────────────

function testTypeOf(sessionType: string): { sport: string; test_type: string } | null {
  if (/1\s*km|1k\b/i.test(sessionType)) return { sport: "run", test_type: "run_1k_tt" };
  if (/20\s*min|field test|ftp/i.test(sessionType)) return { sport: "ride", test_type: "bike_20min" };
  if (/css|400\s*\+\s*200/i.test(sessionType)) return { sport: "swim", test_type: "swim_css" };
  return null;
}

function parseMMSS(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mi = parseInt(m, 10), se = parseInt(s, 10);
    if (isNaN(mi) || isNaN(se)) return null;
    return mi * 60 + se;
  }
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function BenchmarkForm({ session, date, onDone }: {
  session: PlanSession; date: string; onDone: () => void;
}) {
  const meta = testTypeOf(session.session_type);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delta, setDelta] = useState<string | null>(null);
  if (!meta) return null;
  const m = meta;

  async function submit() {
    let result: Record<string, number> = {};
    if (m.test_type === "run_1k_tt") {
      const t = parseMMSS(a);
      if (!t) { setErr("Enter your 1km time (m:ss)"); return; }
      result = { time_s: t };
    } else if (m.test_type === "bike_20min") {
      const hr = parseFloat(a), sp = parseFloat(b);
      if (!hr) { setErr("Enter average HR"); return; }
      result = { avg_hr: hr, avg_speed_kmh: sp || 0 };
    } else {
      const t400 = parseMMSS(a), t200 = parseMMSS(b);
      if (!t400 || !t200) { setErr("Enter 400m and 200m times (m:ss)"); return; }
      result = { t400_s: t400, t200_s: t200 };
    }
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/race-plans/benchmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, sport: m.sport, test_type: m.test_type, session_id: session.id, result }),
      });
      if (!res.ok) throw new Error("Failed");
      const d = await res.json();
      const ch = d?.delta?.change;
      setDelta(ch != null ? `Zones updated · Δ ${ch > 0 ? "+" : ""}${ch}` : "Zones updated ✓");
      setTimeout(onDone, 1200);
    } catch { setErr("Could not save result"); }
    finally { setSaving(false); }
  }

  const fields = m.test_type === "run_1k_tt"
    ? [{ v: a, set: setA, ph: "1km time (m:ss)" }]
    : m.test_type === "bike_20min"
    ? [{ v: a, set: setA, ph: "avg HR (bpm)" }, { v: b, set: setB, ph: "avg speed (km/h)" }]
    : [{ v: a, set: setA, ph: "400m time (m:ss)" }, { v: b, set: setB, ph: "200m time (m:ss)" }];

  return (
    <div className="space-y-2 border-t border-[#18181B] pt-4">
      <p className="text-xs text-[#71717A] uppercase tracking-wider">Log test result → updates your zones</p>
      <div className="flex gap-2 flex-wrap">
        {fields.map((f, i) => (
          <input
            key={i}
            value={f.v}
            onChange={(e) => f.set(e.target.value)}
            placeholder={f.ph}
            className="flex-1 min-w-[120px] bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        ))}
        <button
          onClick={submit}
          disabled={saving}
          className="px-4 py-2 bg-[#F59E0B] text-[#09090B] rounded-lg text-xs font-semibold hover:bg-[#D97706] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save test"}
        </button>
      </div>
      {delta && <p className="text-xs text-[#4ADE80]">{delta}</p>}
      {err && <p className="text-xs text-[#F87171]">{err}</p>}
    </div>
  );
}

// ── Fueling ─────────────────────────────────────────────────────────────────

function FuelingSection({ fueling }: { fueling: Fueling }) {
  const { during, pre, post, gut_training } = fueling;
  if (during.carbs_g_h === 0 && !pre && !post) {
    return (
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
        <p className="text-xs text-[#71717A]">⚡ Water only — no fuel needed for this one.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[#52525B] uppercase tracking-wider">Fueling</p>
      {gut_training && (
        <div className="bg-[#1C1700] border border-[#B45309] rounded-xl px-4 py-2.5">
          <p className="text-xs text-[#FCD34D]">
            🎯 Gut-training session — practise <b>{gut_training.target_carbs_g_h} g/h</b> with your race products.
          </p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {pre && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-[#52525B] uppercase">Before</p>
            <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{pre.carbs_g}g</p>
            <p className="text-[10px] text-[#71717A] mt-0.5">{pre.timing}</p>
          </div>
        )}
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-2.5">
          <p className="text-[10px] text-[#52525B] uppercase">During /h</p>
          <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">
            {during.carbs_g_h > 0 ? `${during.carbs_g_h}g` : "—"}
          </p>
          <p className="text-[10px] text-[#71717A] mt-0.5">{during.fluid_ml_h}ml{during.sodium_mg_h ? ` · ${during.sodium_mg_h}mg Na` : ""}</p>
        </div>
        {post && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-[#52525B] uppercase">After</p>
            <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{post.carbs_g}g<span className="text-[10px] text-[#71717A]"> +{post.protein_g}g P</span></p>
            <p className="text-[10px] text-[#71717A] mt-0.5">{post.window}</p>
          </div>
        )}
      </div>
      {during.note && during.carbs_g_h > 0 && <p className="text-[11px] text-[#71717A] leading-relaxed">{during.note}</p>}
    </div>
  );
}

function FuelQuickLog({ session, date, onLogged }: {
  session: PlanSession; date: string; onLogged: () => void;
}) {
  const [carbs, setCarbs] = useState("");
  const [fluids, setFluids] = useState("");
  const [gi, setGi] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await fetch(`/api/nutrition/fueling-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          plan_session_id: session.id,
          carbs_g: carbs ? parseFloat(carbs) : null,
          fluids_ml: fluids ? parseFloat(fluids) : null,
          gi_severity: gi,
        }),
      });
      setSaved(true);
      onLogged();
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  }

  if (saved) return <p className="text-xs text-[#4ADE80] border-t border-[#18181B] pt-4">Fueling logged ✓</p>;

  return (
    <div className="space-y-2 border-t border-[#18181B] pt-4">
      <p className="text-xs text-[#71717A] uppercase tracking-wider">Log what you actually took</p>
      <div className="flex gap-2 flex-wrap">
        <input value={carbs} onChange={(e) => setCarbs(e.target.value)} placeholder="carbs total (g)"
          className="flex-1 min-w-[110px] bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]" />
        <input value={fluids} onChange={(e) => setFluids(e.target.value)} placeholder="fluids (ml)"
          className="flex-1 min-w-[110px] bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#52525B] uppercase">Gut (1 fine → 5 bad)</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setGi(n)}
            className={`w-7 h-7 rounded-md text-xs font-semibold ${gi === n ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] hover:bg-[#27272A]"}`}>
            {n}
          </button>
        ))}
        <button onClick={submit} disabled={saving}
          className="ml-auto px-4 py-1.5 bg-[#27272A] rounded-lg text-xs text-[#A1A1AA] hover:bg-[#3F3F46] disabled:opacity-50">
          {saving ? "…" : "Log fuel"}
        </button>
      </div>
    </div>
  );
}

// ── Session detail sheet ────────────────────────────────────────────────────

const DISC_KEY: Record<string, "run" | "ride" | "swim"> = {
  running: "run", cycling: "ride", ride: "ride", swimming: "swim", swim: "swim",
};

function SessionSheet({ session, date, onClose, onUpdate, disciplineZones }: {
  session: PlanSession; date: string; onClose: () => void; onUpdate: () => void; disciplineZones?: DisciplineZones;
}) {
  const [rpe, setRpe] = useState<number | null>(session.rpe_actual ?? null);
  const [marking, setMarking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const zone = ZONE_STYLE[session.intensity_zone] ?? ZONE_STYLE.Z2;
  // Prefer the template's own structured workout; fall back to the heuristic.
  const phases: WorkoutPhase[] = session.structure
    ? resolveStructure(session.structure, disciplineZones, session.discipline)
    : buildWorkoutDescription(session, runZonesAsPaceZones(disciplineZones));

  const discKey = DISC_KEY[session.discipline] ?? "run";
  const sessionZone = disciplineZones?.[discKey]?.zones?.[session.intensity_zone];
  const isTest = session.session_type.startsWith("Test -");

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
            {session.days_until_race != null && session.days_until_race <= 42 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1C0A0A] border border-[#7F1D1D] text-[#FCA5A5] whitespace-nowrap">
                🏁 R−{session.days_until_race}{session.current_phase === "taper" ? " · Taper" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Target banner — the session's own discipline zone (pace / HR+speed / CSS) */}
        {sessionZone?.display && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: `${ZONE_DOT[session.intensity_zone] ?? "#52525B"}10`, border: `1px solid ${ZONE_DOT[session.intensity_zone] ?? "#52525B"}30` }}
          >
            <span className="text-sm font-bold" style={{ color: ZONE_DOT[session.intensity_zone] }}>
              {sessionZone.display}
              {discKey === "ride" && sessionZone.speed_kmh_hint ? ` · ~${sessionZone.speed_kmh_hint} km/h` : ""}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px]" style={{ color: `${ZONE_DOT[session.intensity_zone] ?? "#52525B"}cc` }}>
                {sessionZone.label} · RPE {sessionZone.rpe}
                {discKey === "ride" ? " · pace by HR/feel (no power)" : ""}
              </p>
            </div>
          </div>
        )}

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

        {/* Fueling */}
        {session.fueling && <FuelingSection fueling={session.fueling} />}

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

        {/* Benchmark test form (Test sessions only) */}
        {isTest && (
          <BenchmarkForm session={session} date={date} onDone={() => { onUpdate(); onClose(); }} />
        )}

        {/* Fueling quick-log — for sessions that actually need fuel */}
        {!isTest && session.fueling && session.fueling.during.carbs_g_h > 0 && (
          <FuelQuickLog session={session} date={date} onLogged={onUpdate} />
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
  const [disciplineZones, setDisciplineZones] = useState<DisciplineZones | undefined>(undefined);

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
          // Fetch per-discipline zones for the first session's goal (run pace,
          // bike HR+speed, swim CSS) to resolve structured-workout targets.
          const firstGoalId = d.sessions?.[0]?.goal_id;
          if (firstGoalId) {
            fetch(`/api/race-plans/goals/${firstGoalId}/discipline-zones`)
              .then((r) => r.ok ? r.json() : null)
              .then((z) => { if (z) setDisciplineZones(z); })
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

        {/* Readiness header + rest-day/sessions — one card, not two */}
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
          {ctx && <ReadinessHeader ctx={ctx} />}

          {sessions.length === 0 ? (
            <div className="px-4 py-4 flex items-center gap-3">
              <span className="text-xl">😴</span>
              <div>
                <p className="text-sm text-[#A1A1AA] font-medium">Rest day</p>
                <p className="text-xs text-[#52525B] mt-0.5">No sessions scheduled — recover well</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#18181B]">
              {sessions.map((s) => {
                const zone = ZONE_STYLE[s.intensity_zone] ?? ZONE_STYLE.Z2;
                const isCompleted = s.status === "completed";
                return (
                  <button
                    key={s.id}
                    onClick={() => setOpenSession(s)}
                    className={`w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors ${
                      isCompleted ? "bg-[#052E16]/40" : "hover:bg-[#131316]"
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
                      {s.fueling && s.fueling.during.carbs_g_h > 0 && (
                        <p className="text-[10px] text-[#F59E0B] mt-1">
                          ⚡ {s.fueling.during.carbs_g_h}g/h · {s.fueling.during.fluid_ml_h}ml/h
                          {s.fueling.gut_training ? " · gut-train" : ""}
                        </p>
                      )}
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
            </div>
          )}
        </div>
      </section>

      {openSession && (
        <SessionSheet
          session={openSession}
          date={date}
          onClose={() => setOpenSession(null)}
          onUpdate={refresh}
          disciplineZones={disciplineZones}
        />
      )}
    </>
  );
}
