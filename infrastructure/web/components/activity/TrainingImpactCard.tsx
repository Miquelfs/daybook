"use client";

import { useQuery } from "@tanstack/react-query";
import type { ActivityImpact, FitnessSummary } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const C = { ef: "var(--viz-hr)", muted: "var(--viz-i1)", race: "var(--viz-i4)", ref: "var(--viz-ref)" };

function signed(v: number | undefined | null, digits = 1): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#71717A] tabular-nums">{sub}</p>}
    </div>
  );
}

/** Progress toward a race demand, with a tick for the previous best. */
function Progress({ label, value, total, unit, pct, prev, prevLabel }: {
  label: string; value: number; total: number; unit: string; pct: number; prev?: number | null; prevLabel?: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#A1A1AA]">{label}</span>
        <span className="tabular-nums text-[#FAFAFA]">
          {Math.round(value)} <span className="text-[#71717A]">/ {Math.round(total)} {unit} · {pct}%</span>
        </span>
      </div>
      <div className="relative h-2 bg-[#18181B] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: C.race }} />
        {prev != null && prev > 0 && (
          <div className="absolute top-0 bottom-0 w-[2px]" style={{ left: `${Math.min(100, (prev / total) * 100)}%`, background: C.ref }}
               title={prevLabel} />
        )}
      </div>
      {prevLabel && <p className="text-[10px] text-[#71717A] mt-1">{prevLabel}</p>}
    </div>
  );
}

/** 0–21 with Whoop's bands: light < 10, moderate < 14, high < 18, all out. */
function StrainBar({ value }: { value: number }) {
  const bands = [[0, 10, "light"], [10, 14, "moderate"], [14, 18, "high"], [18, 21, "all out"]] as const;
  return (
    <div className="mb-4">
      <div className="relative flex gap-[2px] h-1.5 rounded-full overflow-hidden">
        {bands.map(([lo, hi], i) => (
          <div key={lo} style={{ flexGrow: hi - lo, flexBasis: 0, background: ["var(--viz-i1)", "var(--viz-i3)", "var(--viz-i5)", "var(--viz-i7)"][i],
                                 opacity: value >= lo ? 1 : 0.35 }} />
        ))}
      </div>
      <div className="relative h-3">
        <span className="absolute top-0 w-0.5 h-2 bg-[#FAFAFA] -translate-x-1/2" style={{ left: `${(Math.min(21, value) / 21) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-[#71717A] -mt-1">
        <span>0</span><span>light · moderate · high · all out</span><span>21</span>
      </div>
    </div>
  );
}

export function useFitnessSummary() {
  return useQuery<FitnessSummary | null>({
    queryKey: ["fitness-summary"],
    queryFn: () => fetch(`${BASE}/training/fitness-summary`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    staleTime: 300_000,
  });
}

/** Today's fitness against the race-day target. */
function GoalFitnessLine() {
  const { data } = useFitnessSummary();
  const g = data?.goal, L = data?.load;
  if (!g || !L) return null;
  return (
    <p className="text-xs text-[#71717A] mt-3">
      {g.name} needs fitness ~{g.target_fitness} on race day — you&apos;re at {Math.round(L.fitness)} ({g.pct}%).{" "}
      {g.status === "there" ? "Already there: hold it and arrive fresh."
        : `That's +${g.needed_ramp_per_week}/week until the taper; last 4 weeks: ${L.ramp_per_week >= 0 ? "+" : ""}${L.ramp_per_week}/week.`}
    </p>
  );
}

/** What the three numbers mean, in plain words. */
export function LoadExplainer() {
  return (
    <details className="mt-3 group">
      <summary className="text-xs text-[#71717A] cursor-pointer hover:text-[#A1A1AA] list-none">
        <span className="group-open:hidden">What do these mean? →</span><span className="hidden group-open:inline">Hide ↑</span>
      </summary>
      <div className="mt-2 space-y-1.5 text-xs text-[#A1A1AA] leading-relaxed">
        <p><b className="text-[#FAFAFA]">Fitness</b> — your average daily training load (TSS) over ~6 weeks. It rises slowly with
          consistent training and is the number that has to grow for race day.</p>
        <p><b className="text-[#FAFAFA]">Fatigue</b> — the same average over ~1 week. It jumps after big days and fades in a few rest days.</p>
        <p><b className="text-[#FAFAFA]">Form</b> — fitness minus fatigue. Positive: fresh (good before a race or a key session).
          −10 to −30: the productive zone where fitness is being built. Below −30: back off.</p>
        <p><b className="text-[#FAFAFA]">TSS</b> — load of one session: 100 = one hour flat-out at threshold. <b className="text-[#FAFAFA]">Strain</b> —
          Whoop-style 0–21 from time in each HR zone; it saturates, so going from 18 to 20 takes far more than 8 to 10.</p>
      </div>
    </details>
  );
}

export function TrainingImpactCard({ impact, sport }: { impact: ActivityImpact; sport: string }) {
  const { load, efficiency: ef, race } = impact;
  const hist = ef?.history ?? [];
  const efMax = Math.max(...hist.map((h) => h.ef), 0.001);
  const efMin = Math.min(...hist.map((h) => h.ef), efMax);
  const noun = sport === "run" ? "runs" : sport === "ride" ? "rides" : "sessions";

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Training impact</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
          <span className="flex flex-wrap items-baseline gap-x-4">
            {impact.strain && (
              <span className="text-xl font-semibold tabular-nums" title="Whoop-style strain, 0–21: time in each heart-rate zone, weighted by zone, on a scale where every point is harder to earn">
                {impact.strain.value.toFixed(1)}<span className="text-sm text-[#A1A1AA] font-normal"> strain · {impact.strain.label}</span>
              </span>
            )}
            <span className="text-xl font-semibold tabular-nums">
              {impact.tss ?? "—"}<span className="text-sm text-[#A1A1AA] font-normal"> TSS</span>
            </span>
          </span>
          {load?.week_share_pct != null && (
            <span className="text-xs text-[#71717A] tabular-nums text-right">
              {load.week_share_pct >= 100 ? <>first session this week</> : <>{load.week_share_pct}% of this week<br />({load.week_tss} TSS so far)</>}
            </span>
          )}
        </div>
        {load?.form_label && (
          <p className="text-sm text-[#A1A1AA] mb-4">
            Tomorrow&apos;s form {signed(load.form_next)} — {load.form_label}
          </p>
        )}
        {impact.tss_source && impact.tss_source !== "power" && (
          <p className="text-[10px] text-[#52525B] -mt-3 mb-4">load from {impact.tss_source}</p>
        )}

        {impact.strain && (
          <StrainBar value={impact.strain.value} />
        )}

        {load?.fitness != null && (
          <div className="mb-5">
            <div className="grid grid-cols-3 gap-3">
              <Tile label="Fitness" value={load.fitness.toFixed(0)} sub={`${signed(load.fitness_delta)} today`} />
              <Tile label="Fatigue" value={load.fatigue!.toFixed(0)} sub={`${signed(load.fatigue_delta)} today`} />
              <Tile label="Form" value={signed(load.form_next, 0)}
                    sub={load.form_before != null ? `was ${signed(load.form_before, 0)}` : undefined} />
            </div>
            <GoalFitnessLine />
            <LoadExplainer />
          </div>
        )}

        {ef && ef.pct != null && hist.length > 0 && (
          <div className="mb-5">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Aerobic efficiency</p>
              <span className="text-sm font-semibold tabular-nums">{signed(ef.pct)}%</span>
            </div>
            <p className="text-xs text-[#A1A1AA] mb-2">{ef.verdict} <span className="text-[#71717A]">(vs median of your last {ef.n} similar {noun})</span></p>
            <div className="flex items-end gap-1 h-12" role="img" aria-label="Efficiency of recent similar sessions">
              {hist.map((h) => (
                <div key={h.date + h.ef} className="flex-1 rounded-t"
                     title={`${h.date}: EF ${h.ef}${h.this ? " (this one)" : ""}`}
                     style={{
                       height: `${25 + ((h.ef - efMin) / Math.max(1e-6, efMax - efMin)) * 75}%`,
                       background: h.this ? C.ef : C.muted,
                     }} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-[#52525B] mt-1">
              <span>{hist[0]?.date.slice(5)}</span><span>this one</span>
            </div>
          </div>
        )}

        {race && (
          <div className="border-t border-[#27272A] pt-4">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-3">
              {race.goal} · {race.weeks_to_race} weeks to go
            </p>
            <Progress label="Distance" value={race.km} total={race.race_km} unit="km" pct={race.km_pct}
                      prev={race.longest_before_km}
                      prevLabel={race.is_longest ? `Your longest ride yet (previous ${race.longest_before_km ?? 0} km) ✓`
                        : race.longest_before_km ? `Longest so far: ${race.longest_before_km} km` : undefined} />
            <Progress label="Climbing" value={race.climb_m} total={race.race_climb_m} unit="m" pct={race.climb_pct} />
            {(race.durability || race.fuel) && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                {race.durability && (
                  <Tile label="Durability" value={
                    <span className={race.durability.ok ? "text-emerald-400" : "text-amber-400"}>
                      {race.durability.ok ? "✓" : "△"} {race.durability.decoupling_pct}%
                    </span>} sub={race.durability.note} />
                )}
                {race.fuel && (
                  <Tile label="Fuel on the bike" value={
                    race.fuel.carbs_g_h != null ? (
                      <span className={race.fuel.ok ? "text-emerald-400" : "text-amber-400"}>
                        {race.fuel.ok ? "✓" : "△"} {race.fuel.carbs_g_h} g/h
                      </span>) : <span className="text-[#71717A]">not logged</span>}
                    sub={race.fuel.carbs_g_h != null
                      ? `target ${race.fuel.target_g_h ?? "60–90"} g/h · ${race.fuel.carbs_g} g total`
                      : "log what you ate in Food → \"On the bike\""} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
