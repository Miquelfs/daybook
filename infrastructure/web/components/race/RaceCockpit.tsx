"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Sparkles, RefreshCw, Check, Plane, BedDouble, Ban, Dumbbell, Flag, Mountain, Timer } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { WeekPlanner } from "@/components/training/WeekPlanner";
import RaceReadinessPanel from "@/components/training/RaceReadinessPanel";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Phase + zone colours are mid-tones that read on both the cockpit and paper themes.
const PHASE_COLOUR: Record<string, string> = {
  foundation: "#94A3B8", base: "#34D399", base_building: "#34D399",
  build: "#F59E0B", peak: "#FB923C", race_prep: "#F87171", taper: "#F87171", recovery: "#94A3B8",
};
const ZONE_COLOUR: Record<string, string> = {
  Z1: "#A1A1AA", Z2: "#34D399", Z3: "#FB923C", Z4: "#F87171", Z5: "#E879F9",
};

type Week = {
  week: number; start: string; end: string; phase: string; phase_label: string; recovery: boolean;
  planned_min: number; done_min: number; sessions: number; done: number; missed: number;
  longest_min: number; has_test: boolean; has_b2b: boolean; gym: number; is_current: boolean; is_past: boolean;
};
type Overview = {
  goal: { id: number; name: string; race_type: string; race_date: string; plan_start_date: string };
  days_until_race: number; current_week: number; total_weeks: number; started: boolean;
  phase: string | null; phase_label: string | null; weeks: Week[];
  milestones: { date: string; kind: string; label: string; status: string }[];
  engine: { ftp_w: number | null; weight_kg: number | null; w_per_kg: number | null; threshold_hr: number | null;
            zones_from: string | null; compliance_4w: number | null; longest_ride_min: number };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());
const fmtH = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}` : `${min}m`);
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-GB", opts);
const shortType = (t: string) => t.replace(/^Cycling - /, "").replace(/^Strength - /, "");

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 bg-[#0D0D0F] border border-[#27272A] rounded-2xl ${className}`}>{children}</div>;
}

// ── Hero: countdown + 27-week phase map ──────────────────────────────────────

function Hero({ ov, onWeek }: { ov: Overview; onWeek: (start: string) => void }) {
  const phases = ov.weeks.reduce<{ phase: string; label: string; n: number }[]>((acc, w) => {
    const last = acc[acc.length - 1];
    if (last && last.phase === w.phase) last.n++;
    else acc.push({ phase: w.phase, label: w.phase_label, n: 1 });
    return acc;
  }, []);
  const msByWeek = new Map<number, string>();
  for (const w of ov.weeks) {
    if (w.has_b2b) msByWeek.set(w.week, "★");
    else if (w.has_test) msByWeek.set(w.week, "◆");
  }
  const max = Math.max(...ov.weeks.map((w) => w.planned_min), 60);

  return (
    <Card className="p-5 overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">
            {fmtDay(ov.goal.race_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-[#FAFAFA] mt-1">{ov.goal.name}</h1>
          <p className="text-xs text-[#A1A1AA] mt-1">312 km · 4,750 m · start 06:30, Platja de Muro</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-4xl font-semibold tabular-nums text-[#F59E0B] leading-none">{ov.days_until_race}</p>
          <p className="text-[10px] uppercase tracking-widest text-[#71717A] mt-1">days to go</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <span className="text-xs px-2.5 py-1 rounded-full font-medium"
          style={{ background: `${PHASE_COLOUR[ov.phase ?? "base"]}22`, color: PHASE_COLOUR[ov.phase ?? "base"] }}>
          {ov.phase_label}
        </span>
        <span className="text-xs text-[#A1A1AA]">
          {ov.started ? `Week ${ov.current_week} of ${ov.total_weeks}` : `Starts ${fmtDay(ov.goal.plan_start_date, { weekday: "short", day: "numeric", month: "short" })}`}
        </span>
        {ov.weeks[ov.current_week - 1]?.recovery && (
          <span className="text-xs text-[#71717A]">· recovery week ✦</span>
        )}
      </div>

      {/* Week map: bar height = planned volume, fill = done; tap → plan that week */}
      <div className="mt-5">
        <div className="flex items-end gap-[3px] h-16">
          {ov.weeks.map((w) => {
            const h = Math.max(10, (w.planned_min / max) * 100);
            const donePct = w.planned_min ? Math.min(100, (w.done_min / w.planned_min) * 100) : 0;
            const c = PHASE_COLOUR[w.phase] ?? "#94A3B8";
            return (
              <button key={w.week} onClick={() => onWeek(w.start)} title={`Week ${w.week} · ${w.phase_label} · ${fmtH(w.planned_min)} planned`}
                className="relative flex-1 flex flex-col justify-end h-full group">
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] text-[#71717A]">{msByWeek.get(w.week) ?? ""}</span>
                <div className="w-full rounded-[3px] overflow-hidden relative"
                  style={{ height: `${h}%`, background: `${c}${w.recovery ? "26" : "40"}`, boxShadow: w.is_current ? `0 0 0 2px ${c}` : undefined }}>
                  <div className="absolute bottom-0 left-0 right-0" style={{ height: `${donePct}%`, background: c }} />
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex gap-[3px] mt-1.5">
          {phases.map((p, i) => (
            <div key={i} style={{ flex: p.n }} className="min-w-0">
              <div className="h-[3px] rounded-full" style={{ background: PHASE_COLOUR[p.phase] }} />
              <p className="text-[9px] text-[#71717A] mt-1 truncate">{p.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#52525B] mt-1">◆ FTP test · ★ back-to-back weekend · faded = recovery week · tap a week to plan it</p>
      </div>
    </Card>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────

type DaySession = {
  id: number; session_type: string; effective_duration_min: number; intensity_zone: string; status: string;
  is_optional: boolean; context_notes?: string[]; suggested_duration_min?: number | null; suggested_zone?: string | null;
  structure: { label: string; duration_min?: number; reps?: number; work_min?: number; cue?: string }[] | null;
};

function TodayCard() {
  const today = todayIso();
  const { data } = useQuery<{ sessions: DaySession[]; readiness_context: { day_label?: string; ride_window_min?: number; sleep_h?: number | null } }>({
    queryKey: ["race-today", today],
    queryFn: () => fetch(`/api/race-plans/day/${today}`, { cache: "no-store" }).then((r) => r.json()),
  });
  const sessions = (data?.sessions ?? []).filter((s) => s.status !== "skipped");
  const ctx = data?.readiness_context;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Today</SectionLabel>
        <Link href={`/day/${today}`} className="text-xs text-[#71717A] hover:text-[#F59E0B] flex items-center gap-1">
          Open day <ArrowRight size={12} />
        </Link>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#71717A] mb-3">
        {ctx?.day_label && <span>{ctx.day_label}</span>}
        {ctx?.sleep_h != null && <span>· slept {ctx.sleep_h}h</span>}
      </div>
      {sessions.length === 0 ? (
        <p className="text-sm text-[#A1A1AA]">Rest day. Sleep, eat well, let the work land.</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const done = s.status === "completed";
            return (
              <div key={s.id} className="rounded-xl bg-[#18181B] p-4">
                <div className="flex items-start gap-3">
                  <div className="w-1 self-stretch rounded-full" style={{ background: ZONE_COLOUR[s.intensity_zone] ?? "#71717A" }} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-base font-semibold ${done ? "text-[#4ADE80]" : "text-[#FAFAFA]"}`}>
                      {done ? "✓ " : ""}{shortType(s.session_type)}
                    </p>
                    <p className="text-xs text-[#A1A1AA] mt-0.5">
                      {fmtH(s.suggested_duration_min ?? s.effective_duration_min)} · {s.suggested_zone ?? s.intensity_zone}
                      {s.is_optional ? " · optional" : ""}
                    </p>
                    {s.structure && s.structure.length > 0 && (
                      <ol className="mt-2.5 space-y-1">
                        {s.structure.slice(0, 5).map((st, i) => (
                          <li key={i} className="text-[11px] text-[#A1A1AA] flex gap-2 min-w-0">
                            <span className="text-[#52525B] tabular-nums w-10 shrink-0">
                              {st.reps ? `${st.reps}×${st.work_min}′` : st.duration_min ? `${st.duration_min}′` : ""}
                            </span>
                            <span className="truncate min-w-0">{st.label}{st.cue ? <span className="text-[#52525B]"> — {st.cue}</span> : null}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {(() => {
                      // The duty label is already in the header line — show only the advice.
                      const notes = (s.context_notes ?? []).filter((n) => n !== ctx?.day_label);
                      return notes.length > 0 && !done ? (
                        <div className="mt-3 rounded-lg bg-[#1C1700] border border-[#B45309] px-3 py-2 space-y-0.5">
                          {notes.map((n, i) => <p key={i} className="text-[11px] text-[#FCD34D]">{n}</p>)}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── This week strip ──────────────────────────────────────────────────────────

type WeekDayT = {
  date: string; day_name: string;
  sessions: { id: number; session_type: string; effective_duration_min: number; intensity_zone: string; status: string }[];
  context: { label: string; window_min: number; blocked: boolean; woke_away: boolean };
  roster: string | null;
};

function WeekStrip({ goalId, onPlan }: { goalId: number; onPlan: (d: string) => void }) {
  const today = todayIso();
  const { data } = useQuery<{ week_start: string; days: WeekDayT[]; confirmed_at: string | null }>({
    queryKey: ["omyra-week", goalId, today],
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goalId}/week?date=${today}`, { cache: "no-store" }).then((r) => r.json()),
  });
  const days = data?.days ?? [];
  const live = days.flatMap((d) => d.sessions).filter((s) => s.status !== "skipped" && s.status !== "displaced");
  const planned = live.reduce((n, s) => n + (s.effective_duration_min || 0), 0);
  const done = live.filter((s) => s.status === "completed").reduce((n, s) => n + (s.effective_duration_min || 0), 0);
  const next = new Date(); next.setDate(next.getDate() + 7);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <SectionLabel>This week</SectionLabel>
        <span className="text-xs text-[#A1A1AA] tabular-nums">{fmtH(done)} / {fmtH(planned)}</span>
      </div>
      <div className="h-1 rounded-full bg-[#27272A] overflow-hidden mb-4">
        <div className="h-full bg-[#4ADE80]" style={{ width: `${planned ? (done / planned) * 100 : 0}%` }} />
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const isToday = d.date === today;
          const ss = d.sessions.filter((s) => s.status !== "skipped" && s.status !== "displaced");
          const Icon = d.context.blocked ? Ban : d.context.woke_away ? BedDouble
            : d.roster && d.roster !== "day_off" ? Plane : null;
          return (
            <button key={d.date} onClick={() => onPlan(d.date)}
              className={`rounded-xl p-1.5 min-h-[92px] flex flex-col items-center gap-1 text-left transition-colors hover:bg-[#18181B] ${
                isToday ? "bg-[#18181B] border border-[#3F3F46]" : "border border-transparent"}`}>
              <span className={`text-[10px] ${isToday ? "text-[#F59E0B] font-semibold" : "text-[#71717A]"}`}>{d.day_name.slice(0, 1)}</span>
              <span className="text-[10px] text-[#52525B] tabular-nums -mt-1">{d.date.slice(8)}</span>
              <span className="h-3">{Icon && <Icon size={10} className="text-[#71717A]" />}</span>
              <div className="w-full flex flex-col gap-0.5">
                {ss.map((s) => (
                  <div key={s.id} title={`${s.session_type} · ${s.effective_duration_min}′`}
                    className="w-full rounded-[4px] text-[9px] text-center tabular-nums py-0.5 font-medium flex items-center justify-center gap-0.5"
                    style={{
                      background: s.status === "completed" ? "#4ADE8033" : `${ZONE_COLOUR[s.intensity_zone] ?? "#71717A"}26`,
                      color: s.status === "completed" ? "#16A34A" : undefined,
                    }}>
                    {s.session_type.startsWith("Strength") ? <Dumbbell size={9} /> : null}
                    <span className={s.status === "completed" ? "" : "text-[#D4D4D8]"}>{s.status === "completed" ? "✓" : fmtH(s.effective_duration_min)}</span>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => onPlan(today)}
          className="flex-1 text-xs py-2 rounded-xl border border-[#27272A] text-[#A1A1AA] hover:bg-[#18181B]">Edit this week</button>
        <button onClick={() => onPlan(iso(next))}
          className="flex-1 text-xs py-2 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20">Plan next week →</button>
      </div>
    </Card>
  );
}

// ── AI coach ─────────────────────────────────────────────────────────────────

type Review = {
  id: number; week_start: string; created_at?: string; headline: string; assessment: string;
  wins: string[]; watch: string[]; focus: string; applied: number[];
  adjustments: { action: string; session_type: string; session_date: string; to_date?: string;
                 duration_min?: number; zone?: string; current_min: number; current_zone: string; reason: string }[];
};

function adjText(a: Review["adjustments"][number]) {
  const t = shortType(a.session_type);
  const on = fmtDay(a.session_date, { weekday: "short", day: "numeric" });
  if (a.action === "move") return `Move ${t} ${on} → ${fmtDay(a.to_date!, { weekday: "short", day: "numeric" })}`;
  if (a.action === "shorten") return `Shorten ${t} ${on}: ${fmtH(a.current_min)} → ${fmtH(a.duration_min!)}`;
  if (a.action === "downgrade") return `Ease ${t} ${on}: ${a.current_zone} → ${a.zone}`;
  return `Skip ${t} ${on}`;
}

function CoachCard({ goalId }: { goalId: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, refetch } = useQuery<{ week_start: string; review: Review | null }>({
    queryKey: ["coach", goalId],
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goalId}/coach`, { cache: "no-store" }).then((r) => r.json()),
  });
  const review = data?.review;

  async function ask() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/race-plans/goals/${goalId}/coach`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Coach unavailable");
      await refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : "Coach unavailable"); }
    finally { setBusy(false); }
  }
  async function apply(i: number) {
    if (!review) return;
    const r = await fetch(`${BASE}/race-plans/coach/${review.id}/apply/${i}`, { method: "POST" });
    if (!r.ok) setErr((await r.json().catch(() => null))?.detail ?? "Could not apply");
    await refetch();
    qc.invalidateQueries({ queryKey: ["omyra-week", goalId] });
    qc.invalidateQueries({ queryKey: ["race-overview", goalId] });
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#F59E0B]" />
          <SectionLabel>Coach</SectionLabel>
          {data?.week_start && <span className="text-[10px] text-[#52525B]">week of {fmtDay(data.week_start)}</span>}
        </div>
        <button onClick={ask} disabled={busy}
          className="flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] disabled:opacity-50">
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          {busy ? "Reviewing your data…" : review ? "Re-review" : "Review my week"}
        </button>
      </div>
      {!review ? (
        <p className="text-sm text-[#71717A]">
          The coach reads your last two weeks (sessions, RPE, sleep, HRV, resting HR, readiness, roster)
          and suggests changes to the week. It runs by itself every weekend.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-base font-semibold text-[#FAFAFA]">{review.headline}</p>
          <p className="text-sm text-[#A1A1AA] leading-relaxed">{review.assessment}</p>
          {(review.wins.length > 0 || review.watch.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-2">
              {review.wins.length > 0 && (
                <ul className="space-y-1">{review.wins.map((w, i) => <li key={i} className="text-xs text-[#4ADE80]">✓ {w}</li>)}</ul>
              )}
              {review.watch.length > 0 && (
                <ul className="space-y-1">{review.watch.map((w, i) => <li key={i} className="text-xs text-[#FB923C]">⚠ {w}</li>)}</ul>
              )}
            </div>
          )}
          {review.adjustments.length > 0 && (
            <div className="space-y-2 pt-1">
              {review.adjustments.map((a, i) => {
                const applied = review.applied.includes(i);
                return (
                  <div key={i} className="flex items-start gap-3 rounded-xl bg-[#18181B] px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#E4E4E7]">{adjText(a)}</p>
                      <p className="text-[11px] text-[#71717A] mt-0.5">{a.reason}</p>
                    </div>
                    <button onClick={() => apply(i)} disabled={applied}
                      className={`shrink-0 text-[11px] px-2.5 py-1 rounded-lg font-semibold ${
                        applied ? "text-[#4ADE80]" : "bg-[#F59E0B] text-[#09090B]"}`}>
                      {applied ? <span className="flex items-center gap-1"><Check size={11} /> Done</span> : "Apply"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {review.focus && (
            <p className="text-xs text-[#F59E0B] border-t border-[#18181B] pt-3">Focus: {review.focus}</p>
          )}
        </div>
      )}
      {err && <p className="text-xs text-[#F87171] mt-2">{err}</p>}
    </Card>
  );
}

// ── Engine, milestones, race facts ───────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[#18181B] p-3">
      <p className="text-[10px] uppercase tracking-widest text-[#71717A]">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-[#FAFAFA] mt-1">{value}</p>
      {sub && <p className="text-[10px] text-[#71717A] mt-0.5">{sub}</p>}
    </div>
  );
}

function EngineCard({ ov }: { ov: Overview }) {
  const e = ov.engine;
  return (
    <Card className="p-5">
      <SectionLabel>Engine</SectionLabel>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Stat label="FTP" value={e.ftp_w ? `${Math.round(e.ftp_w)} W` : "—"}
          sub={e.ftp_w ? (e.zones_from ? `tested ${fmtDay(e.zones_from)}` : undefined) : "do the trainer test"} />
        <Stat label="W/kg" value={e.w_per_kg ? e.w_per_kg.toFixed(2) : "—"}
          sub={e.w_per_kg ? (e.w_per_kg >= 2.8 ? "on track for 11–13h" : "cut-off pace zone") : e.weight_kg ? undefined : "log your weight"} />
        <Stat label="Threshold HR" value={e.threshold_hr ? `${e.threshold_hr}` : "—"} sub="outdoor pacing" />
        <Stat label="Done (4 wk)" value={e.compliance_4w != null ? `${Math.round(e.compliance_4w * 100)}%` : "—"}
          sub={e.longest_ride_min ? `longest ${fmtH(e.longest_ride_min)}` : "sessions completed"} />
      </div>
    </Card>
  );
}

const MS_ICON: Record<string, React.ReactNode> = {
  test: <Timer size={13} />, long: <Mountain size={13} />, b2b: <Mountain size={13} />,
  rehearsal: <Timer size={13} />, race: <Flag size={13} />,
};

function Milestones({ ov }: { ov: Overview }) {
  const today = new Date(todayIso() + "T12:00:00").getTime();
  return (
    <Card className="p-5">
      <SectionLabel>Milestones</SectionLabel>
      <ol className="mt-3 relative">
        {ov.milestones.map((m, i) => {
          const days = Math.round((new Date(m.date + "T12:00:00").getTime() - today) / 86400000);
          return (
            <li key={i} className="flex items-center gap-3 py-2 border-b border-[#18181B] last:border-0">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                m.kind === "race" ? "bg-[#F59E0B] text-[#09090B]" : "bg-[#18181B] text-[#A1A1AA]"}`}>
                {MS_ICON[m.kind] ?? <Flag size={13} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#E4E4E7] truncate">{m.label}</p>
                <p className="text-[11px] text-[#71717A]">{fmtDay(m.date, { weekday: "short", day: "numeric", month: "short" })}</p>
              </div>
              <span className="text-xs text-[#71717A] tabular-nums shrink-0">
                {days === 0 ? "today" : days === 1 ? "tomorrow" : `${days}d`}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function RaceFacts() {
  // 2026 rules (start 06:30): km 97 by 11:15, km 220 by 16:30, finish 20:40.
  const cps = [
    { km: 97, by: "11:15", h: 4.75, note: "after the Tramuntana — the one that matters" },
    { km: 220, by: "16:30", h: 10, note: "" },
    { km: 312, by: "20:40", h: 14 + 10 / 60, note: "finish" },
  ];
  return (
    <Card className="p-5">
      <SectionLabel>Cut-offs</SectionLabel>
      <div className="mt-3 space-y-2">
        {cps.map((c) => (
          <div key={c.km} className="flex items-center gap-3">
            <span className="text-sm font-semibold tabular-nums text-[#FAFAFA] w-14">km {c.km}</span>
            <span className="text-sm tabular-nums text-[#F59E0B] w-12">{c.by}</span>
            <span className="text-xs text-[#71717A] flex-1 min-w-0 truncate">
              ≥ {(c.km / c.h).toFixed(1)} km/h incl. stops{c.note ? ` · ${c.note}` : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#52525B] mt-3">2026 rules — check the 2027 edition when published.</p>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function RaceCockpit() {
  const qc = useQueryClient();
  const [planner, setPlanner] = useState<string | null>(null);
  const { data: goals, isLoading } = useQuery<{ id: number; race_type: string; status: string }[]>({
    queryKey: ["omyra-goals-active"],
    queryFn: () => fetch(`${BASE}/race-plans/goals?status=active`, { cache: "no-store" }).then((r) => r.json()),
  });
  const goal = (goals ?? []).find((g) => g.race_type === "mallorca_312") ?? (goals ?? [])[0];

  const { data: ov } = useQuery<Overview>({
    queryKey: ["race-overview", goal?.id],
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goal!.id}/overview`, { cache: "no-store" }).then((r) => r.json()),
    enabled: !!goal,
  });

  // Weekend nudge deep link: /race?plan=next
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("plan") === "next") {
      const d = new Date(); d.setDate(d.getDate() + 7);
      setPlanner(iso(d));
    }
  }, []);

  if (isLoading) return <div className="h-48 rounded-2xl bg-[#18181B] animate-pulse" />;
  if (!goal) {
    return (
      <Card className="p-6 text-center space-y-3">
        <p className="text-lg font-semibold text-[#FAFAFA]">No race plan yet</p>
        <p className="text-sm text-[#71717A]">Create the Mallorca 312 goal (24 Apr 2027, all days available) in Training → Omyra.</p>
        <Link href="/training?tab=omyra" className="inline-block text-xs px-4 py-2 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold">Create goal</Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4 min-w-0">
      {ov ? <Hero ov={ov} onWeek={(d) => setPlanner(d)} /> : <div className="h-56 rounded-2xl bg-[#18181B] animate-pulse" />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 [&>*]:min-w-0">
        <TodayCard />
        <WeekStrip goalId={goal.id} onPlan={(d) => setPlanner(d)} />
      </div>
      <CoachCard goalId={goal.id} />
      {ov && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 [&>*]:min-w-0">
          <EngineCard ov={ov} />
          <Milestones ov={ov} />
        </div>
      )}
      <RaceFacts />
      {ov && (
        <Card className="p-5">
          <SectionLabel>Readiness</SectionLabel>
          <div className="mt-3">
            <RaceReadinessPanel defaultRaceDate={ov.goal.race_date} goalName={ov.goal.name}
              raceType={ov.goal.race_type} planPhase={ov.phase} planPhaseLabel={ov.phase_label} />
          </div>
        </Card>
      )}
      <div className="flex justify-center gap-4 text-xs text-[#71717A] pt-2">
        <Link href="/training?tab=omyra" className="hover:text-[#F59E0B]">Full plan & settings</Link>
        <span>·</span>
        <Link href="/training" className="hover:text-[#F59E0B]">Training analytics</Link>
      </div>
      {planner && (
        <WeekPlanner goalId={goal.id} initialDate={planner} onClose={() => {
          setPlanner(null);
          qc.invalidateQueries({ queryKey: ["race-overview", goal.id] });
          qc.invalidateQueries({ queryKey: ["race-today"] });
          qc.invalidateQueries({ queryKey: ["coach", goal.id] });
        }} />
      )}
    </div>
  );
}
