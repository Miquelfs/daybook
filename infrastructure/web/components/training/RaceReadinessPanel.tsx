"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Readiness = {
  race_date: string;
  days_to_race: number;
  taper_window_start: string | null;
  tsb: number | null;
  ctl: number | null;
  atl: number | null;
  tsb_trend: string | null;
  ramp_rate: number | null;
  decoupling_recent_pct: number | null;
  decoupling_status: "ready" | "borderline" | "not_ready" | null;
  decoupling_efforts: { decoupling_pct: number; date: string; name: string; duration_seconds: number }[];
  ef_trend: "improving" | "declining" | null;
  ef_sparkline: { date: string; ef: number }[];
  vo2max_run: number | null;
  vo2max_bike: number | null;
  training_readiness: number | null;
  garmin_training_status: string | null;
  load_index: { fatigue_score: number; recovery_status: string; hrv_load: number; sleep_debt: number; tss_load: number; timezone_penalty: number; duty_load: number | null } | null;
  flags: { code: string; msg: string }[];
  longest_recent_ride_m: number | null;
  longest_recent_run_m: number | null;
  recent_swim_km_30d: number | null;
  training_phase: string | null;
  training_phase_advice: string | null;
};

const DECOUPLING_COLOR: Record<string, string> = {
  ready: "text-[#4ADE80]",
  borderline: "text-[#F59E0B]",
  not_ready: "text-[#F87171]",
};

const RECOVERY_COLOR: Record<string, string> = {
  recovering: "text-[#4ADE80]",
  balanced: "text-zinc-300",
  accumulating: "text-[#F87171]",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string | number | null; sub?: string; accent?: string }) {
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 space-y-0.5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold ${accent ?? "text-[#FAFAFA]"}`}>{value ?? "—"}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

// Race-type distance targets for volume progress bars. Cycling events track the
// longest ride against the plan's PEAK training ride (not the race distance —
// nobody rides 312 km in training).
type Targets = { swim_km?: number; bike_km?: number; run_km?: number; label: string; bike_label?: string };
const RACE_TARGETS: Record<string, Targets> = {
  "gran_fondo_100":  { bike_km: 100, label: "Gran Fondo 100" },
  "gran_fondo_160":  { bike_km: 130, label: "Gran Fondo 160", bike_label: "Bike — longest ride vs 130 km peak" },
  "mallorca_312":    { bike_km: 200, label: "Mallorca 312", bike_label: "Longest ride (90d) vs ~200 km training peak" },
  "5k":              { run_km: 5,    label: "5K" },
  "10k":             { run_km: 10,   label: "10K" },
  "half_marathon":   { run_km: 21.1, label: "Half Marathon" },
  "marathon":        { run_km: 42.2, label: "Marathon" },
  "triathlon_olympic": { swim_km: 1.5, bike_km: 40,  run_km: 10,   label: "Olympic Tri" },
  "half_ironman":    { swim_km: 1.9, bike_km: 90,  run_km: 21.1, label: "Half Ironman" },
  "ironman":         { swim_km: 3.8, bike_km: 180, run_km: 42.2, label: "Ironman" },
};

// Phase advice for cycling events — the backend's generic advice is triathlon-flavoured.
const CYCLING_PHASE_ADVICE: Record<string, string> = {
  foundation: "Foundation: easy Z2, learn the trainer, set FTP, build gym tolerance. No heroics.",
  base: "Aerobic base: long Z2 rides grow every week; one quality session (threshold / sweet spot) on the trainer.",
  build: "Build: Puig Major climbing efforts, back-to-back weekends, 80–90 g/h fuelling on every long ride.",
  race_prep: "Race prep: volume drops, sharpness stays. Sleep, fuel and arrive fresh.",
};

export default function RaceReadinessPanel({ defaultRaceDate, goalName, raceType, planPhase, planPhaseLabel }: {
  defaultRaceDate?: string;
  goalName?: string;
  raceType?: string;
  /** Phase from the materialized plan (overview) — beats the date-based guess */
  planPhase?: string | null;
  planPhaseLabel?: string | null;
}) {
  const [raceDate, setRaceDate] = useState(defaultRaceDate ?? "");
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(false);

  const targets: Targets =
    (raceType ? RACE_TARGETS[raceType] : null) ?? RACE_TARGETS["ironman"];
  const cycling = targets.swim_km == null && targets.run_km == null;
  // The backend's phase is a date-based triathlon guess — for cycling plans only
  // trust the plan's own phase (passed in from the race overview).
  const phaseLabel = planPhaseLabel ?? (!cycling && data?.training_phase ? `${data.training_phase.replace("_", " ")} phase` : null);
  const phaseAdvice = (cycling && planPhase && CYCLING_PHASE_ADVICE[planPhase]) || (!cycling ? data?.training_phase_advice : null);
  const displayLabel = goalName ?? targets.label;

  function load(rd?: string) {
    const params = rd ? `?race_date=${rd}` : "";
    setLoading(true);
    fetch(`${API}/training/readiness${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(defaultRaceDate); }, [defaultRaceDate]);

  if (loading) return <div className="h-40 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Race date picker (only when no goal supplies the date) */}
      {!defaultRaceDate ? (
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-400">Race date</label>
        <input
          type="date"
          value={raceDate}
          onChange={(e) => setRaceDate(e.target.value)}
          className="bg-[#18181B] border border-[#27272A] rounded px-2 py-1 text-xs text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
        />
        <button
          onClick={() => load(raceDate)}
          className="px-3 py-1 bg-[#F59E0B] text-[#09090B] text-xs font-semibold rounded transition-colors"
        >
          Update
        </button>
        {data && (
          <span className="text-xs text-zinc-500">
            {data.days_to_race > 0 ? `${data.days_to_race} days to go` : "Race day!"}
            {data.taper_window_start && ` · Taper starts ${format(parseISO(data.taper_window_start), "d MMM")}`}
          </span>
        )}
      </div>
      ) : data ? (
        <p className="text-xs text-[#71717A]">
          {data.days_to_race > 0 ? `${data.days_to_race} days to go` : "Race day!"}
          {data.taper_window_start && ` · taper from ${format(parseISO(data.taper_window_start), "d MMM")}`}
        </p>
      ) : null}

      {/* Flags */}
      {data?.flags && data.flags.length > 0 && (
        <div className="space-y-1.5">
          {data.flags.map((f) => (
            <div key={f.code} className="flex items-start gap-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30 text-[#F59E0B] text-xs">
              <span>⚠</span><span>{f.msg}</span>
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Goal progress */}
          <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200">{displayLabel} progress</span>
              {phaseLabel && (
                <span className="text-xs px-2 py-0.5 rounded bg-[#F59E0B]/10 text-[#F59E0B] capitalize">
                  {phaseLabel}
                </span>
              )}
            </div>

            {/* Swim — only for triathlon types */}
            {targets.swim_km != null && (() => {
              const swimKm = data.recent_swim_km_30d ?? 0;
              const pct = Math.min(100, Math.round((swimKm / targets.swim_km!) * 100));
              return (
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Swim — monthly volume</span>
                    <span className={pct >= 100 ? "text-[#4ADE80]" : "text-zinc-400"}>
                      {swimKm > 0 ? swimKm.toFixed(1) : "—"} / {targets.swim_km} km ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#27272A] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            {/* Bike — only for triathlon types */}
            {targets.bike_km != null && (() => {
              const m = data.longest_recent_ride_m ?? 0;
              const targetM = targets.bike_km! * 1000;
              const pct = Math.min(100, Math.round((m / targetM) * 100));
              return (
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>{targets.bike_label ?? "Bike — longest ride (90d)"}</span>
                    <span className={pct >= 100 ? "text-[#4ADE80]" : "text-zinc-400"}>
                      {m > 0 ? (m / 1000).toFixed(1) : "—"} / {targets.bike_km} km ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#27272A] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#F59E0B] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            {/* Run — only for running / triathlon types */}
            {targets.run_km != null && (() => {
              const m = data.longest_recent_run_m ?? 0;
              const targetM = targets.run_km! * 1000;
              const pct = Math.min(100, Math.round((m / targetM) * 100));
              return (
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Run — longest run (90d)</span>
                    <span className={pct >= 100 ? "text-[#4ADE80]" : "text-zinc-400"}>
                      {m > 0 ? (m / 1000).toFixed(1) : "—"} / {targets.run_km} km ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#27272A] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}

            {phaseAdvice && (
              <p className="text-xs text-zinc-500 pt-1 border-t border-[#27272A]">
                {phaseAdvice}
              </p>
            )}
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard
              label="Form (TSB)"
              value={data.tsb !== null ? Math.round(data.tsb) : null}
              sub={data.tsb_trend ?? undefined}
              accent={(data.tsb ?? 0) >= 0 ? "text-[#4ADE80]" : "text-[#F87171]"}
            />
            <StatCard
              label="Fitness (CTL)"
              value={data.ctl !== null ? Math.round(data.ctl) : null}
              sub={data.ramp_rate !== null ? `${data.ramp_rate > 0 ? "+" : ""}${data.ramp_rate?.toFixed(1)} pts/wk` : undefined}
              accent="text-[#60A5FA]"
            />
            <StatCard
              label="Decoupling"
              value={data.decoupling_recent_pct !== null ? `${data.decoupling_recent_pct}%` : null}
              sub={data.decoupling_status === "ready" ? "< 5% ✓ durable" : data.decoupling_status === "borderline" ? "5–8% borderline" : data.decoupling_status === "not_ready" ? "> 8% not ready" : undefined}
              accent={data.decoupling_status ? DECOUPLING_COLOR[data.decoupling_status] : "text-zinc-400"}
            />
            <StatCard
              label="Training Readiness"
              value={data.training_readiness ?? (data.garmin_training_status ?? null)}
              sub={data.garmin_training_status ? `Status: ${data.garmin_training_status}` : undefined}
              accent={
                data.training_readiness !== null
                  ? data.training_readiness >= 70 ? "text-[#4ADE80]" : data.training_readiness >= 40 ? "text-[#F59E0B]" : "text-[#F87171]"
                  : "text-zinc-400"
              }
            />
          </div>

          {/* VO2max */}
          {((!cycling && data.vo2max_run) || data.vo2max_bike) && (
            <div className="grid grid-cols-2 gap-2">
              {!cycling && data.vo2max_run && (
                <StatCard label="VO₂max Run" value={data.vo2max_run} sub="ml/kg/min" accent="text-[#F59E0B]" />
              )}
              {data.vo2max_bike && (
                <StatCard label="VO₂max Bike" value={data.vo2max_bike} sub="ml/kg/min" accent="text-[#60A5FA]" />
              )}
            </div>
          )}

          {/* EF Sparkline */}
          {data.ef_sparkline.length > 3 && (
            <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-400">Efficiency Factor trend (90d long efforts)</span>
                {data.ef_trend && (
                  <span className={`text-xs font-medium ${data.ef_trend === "improving" ? "text-[#4ADE80]" : "text-[#F87171]"}`}>
                    {data.ef_trend === "improving" ? "↑ improving" : "↓ declining"}
                  </span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={data.ef_sparkline}>
                  <XAxis dataKey="date" hide />
                  <YAxis domain={["auto", "auto"]} hide />
                  <Tooltip
                    contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 6, fontSize: 11 }}
                    labelFormatter={(l) => { try { return format(parseISO(l), "d MMM yyyy"); } catch { return l; } }}
                    formatter={(v) => [typeof v === "number" ? v.toFixed(3) : String(v ?? ""), "EF"]}
                  />
                  <Line dataKey="ef" stroke="#F59E0B" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Load Index */}
          {data.load_index && (
            <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Load Index (aviation + training fused)</span>
                <span className={`text-xs font-semibold capitalize ${RECOVERY_COLOR[data.load_index.recovery_status] ?? "text-zinc-300"}`}>
                  {data.load_index.recovery_status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-[#27272A] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      data.load_index.fatigue_score < 33 ? "bg-emerald-500"
                      : data.load_index.fatigue_score < 66 ? "bg-amber-500"
                      : "bg-rose-500"
                    }`}
                    style={{ width: `${data.load_index.fatigue_score}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-white w-8 text-right">{Math.round(data.load_index.fatigue_score)}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs text-zinc-500">
                <div>HRV<div className="text-zinc-300">{data.load_index.hrv_load?.toFixed(0) ?? "—"}</div></div>
                <div>Sleep<div className="text-zinc-300">{data.load_index.sleep_debt?.toFixed(0) ?? "—"}</div></div>
                <div>Training<div className="text-zinc-300">{data.load_index.tss_load?.toFixed(0) ?? "—"}</div></div>
                <div>Duty<div className="text-zinc-300">{data.load_index.duty_load?.toFixed(0) ?? "—"}</div></div>
              </div>
            </div>
          )}

          {/* Decoupling efforts list */}
          {data.decoupling_efforts.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-2">Recent long aerobic efforts (≥ 60 min Z1–Z2)</p>
              <div className="space-y-1">
                {data.decoupling_efforts.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-[#27272A] last:border-0">
                    <span className="text-zinc-300">{e.date} — {e.name}</span>
                    <span className={`font-medium ${
                      e.decoupling_pct < 5 ? "text-[#4ADE80]" : e.decoupling_pct < 8 ? "text-[#F59E0B]" : "text-[#F87171]"
                    }`}>
                      {e.decoupling_pct?.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
