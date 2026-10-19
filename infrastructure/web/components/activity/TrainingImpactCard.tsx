"use client";

import type { ActivityImpact } from "@/lib/api";

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
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold tabular-nums">
            {impact.tss ?? "—"}<span className="text-sm text-[#A1A1AA] font-normal"> TSS</span>
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

        {load?.fitness != null && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Tile label="Fitness" value={load.fitness.toFixed(0)} sub={`${signed(load.fitness_delta)} today`} />
            <Tile label="Fatigue" value={load.fatigue!.toFixed(0)} sub={`${signed(load.fatigue_delta)} today`} />
            <Tile label="Form" value={signed(load.form_next, 0)}
                  sub={load.form_before != null ? `was ${signed(load.form_before, 0)}` : undefined} />
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
