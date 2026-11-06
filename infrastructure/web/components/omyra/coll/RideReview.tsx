"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Block, Panel, Stat, Stats } from "@/components/ui/kit";
import { collApi, COLL_KEYS, type CollReview } from "@/lib/coll-api";
import { fmtDate, fmtDur, fmtKm } from "./parts";

const signed = (m: number) => (m === 0 ? "on plan" : `${m > 0 ? "+" : "−"}${fmtDur(Math.abs(m))}`);

/** Faster than the plan reads as good (emerald), slower as neutral ink — it's information, not a grade. */
function Delta({ m }: { m: number | undefined }) {
  if (m == null) return <span className="text-[#52525B]">—</span>;
  return <span className={m < -2 ? "text-emerald-400" : "text-[#A1A1AA]"}>{signed(m)}</span>;
}

/** A ride of a Coll route against its plan: time by section, the climbs, the fuel. */
export function RideReview({ review: r }: { review: CollReview }) {
  const maxDelta = Math.max(5, ...r.sections.filter((s) => s.ridden).map((s) => Math.abs(s.delta_min ?? 0)));
  const partial = r.covered_km < r.route_km - 2;
  const f = r.fuel;

  return (
    <div className="space-y-8">
      <Block title="Against the plan"
             note={<>On <Link href={`/omyra?tab=coll&course=${r.course_id}`} className="underline hover:text-[#A1A1AA]">{r.course_name}</Link>
               {partial ? ` · km ${fmtKm(r.from_km)}–${fmtKm(r.to_km)} of ${fmtKm(r.route_km)}` : ""}
               {` · planned at ${r.pace.kmh} km/h`}
               {r.pace.learned ? ` (your pace, corrected ${Math.round((r.pace.learned.factor - 1) * 100)} % from ${r.pace.learned.rides} route ride${r.pace.learned.rides === 1 ? "" : "s"})` : ""}</>}>
        <Stats cols={4}>
          <Stat label="Planned" value={fmtDur(r.predicted_min)} sub={`riding, ${fmtKm(r.covered_km)} km`} />
          <Stat label="You rode" value={fmtDur(r.moving_min)} sub={<Delta m={r.delta_min} />} />
          <Stat label="Stopped" value={fmtDur(r.stopped_min)} sub={`${fmtDur(r.elapsed_min)} start to finish`} />
          <Stat label="Like a flat" value={r.flat_kmh ?? "—"} unit="km/h" sub="this terrain, at your effort" />
        </Stats>
      </Block>

      <Block title="By section">
        <Panel className="divide-y divide-[#18181B]">
          {r.sections.map((s, i) => (
            <div key={i} className={`px-4 py-2.5 flex items-center gap-3 ${s.ridden ? "" : "opacity-40"}`}>
              <span className="w-20 shrink-0 text-xs text-[#71717A] tabular-nums">km {Math.round(s.from_km)}–{Math.round(s.to_km)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.name ?? `To km ${Math.round(s.to_km)}`}</p>
                <p className="text-xs text-[#71717A] tabular-nums">
                  plan {fmtDur(s.predicted_min)}
                  {s.ridden ? ` · rode ${fmtDur(s.moving_min!)}${s.kmh ? ` at ${s.kmh} km/h` : ""}${s.avg_hr ? ` · ${s.avg_hr} bpm` : ""}`
                    : " · not ridden"}
                  {s.ridden && s.elapsed_min! - s.moving_min! >= 2 ? ` · stopped ${fmtDur(s.elapsed_min! - s.moving_min!)}` : ""}
                </p>
              </div>
              {s.ridden && (
                <div className="w-28 shrink-0 flex items-center gap-2">
                  <div className="flex-1 h-1.5 relative bg-[#18181B] rounded-full">
                    <div className={`absolute top-0 h-full rounded-full ${(s.delta_min ?? 0) < 0 ? "bg-[#3F3F46] right-1/2" : "bg-[#F59E0B] left-1/2"}`}
                         style={{ width: `${(Math.abs(s.delta_min ?? 0) / maxDelta) * 50}%` }} />
                  </div>
                  <span className="text-xs tabular-nums w-14 text-right"><Delta m={s.delta_min} /></span>
                </div>
              )}
            </div>
          ))}
        </Panel>
      </Block>

      {r.climbs.some((c) => c.moving_min != null) && (
        <Block title="Climbs">
          <Panel className="divide-y divide-[#18181B]">
            {r.climbs.filter((c) => c.moving_min != null).map((c, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-[#71717A] tabular-nums">km {c.km}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name ?? `Climb to km ${c.top_km}`}
                    {c.is_best && (r.rides_of_route ?? 0) > 1 && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">best</span>}
                  </p>
                  <p className="text-xs text-[#71717A] tabular-nums">
                    {c.length_km} km · +{c.gain_m} m · {c.avg_pct}%
                    {c.vam ? ` · ${c.vam} m/h` : ""}{c.avg_hr ? ` · ${c.avg_hr} bpm` : ""}
                    {c.best && !c.is_best ? <> · best {fmtDur(c.best.moving_min)} on <Link href={`/activity/${c.best.activity_id}`} className="underline">{fmtDate(c.best.date)}</Link></> : ""}
                  </p>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <p className="text-sm font-semibold">{fmtDur(c.moving_min!)}</p>
                  <p className="text-xs"><Delta m={Math.round(c.moving_min! - c.est_min)} /></p>
                </div>
              </div>
            ))}
          </Panel>
        </Block>
      )}

      <Block title="Fuel">
        {!f ? (
          <p className="text-xs text-[#52525B]">Nothing recorded — Coll logs each “taken” (hold LAP on the reminder); a watch ride needs a fuel log.</p>
        ) : f.source === "log" ? (
          <Stats cols={2}>
            <Stat label="Carbs" value={f.carbs_g} unit="g" sub="from your fuel log" />
            <Stat label="Per hour" value={f.carbs_g_h ?? "—"} unit="g/h" />
          </Stats>
        ) : (
          <Panel className="p-4 space-y-4">
            <Stats cols={3}>
              <Stat label="Carbs eaten" value={f.carbs_g} unit="g" sub={`of ${f.planned_carbs_g} g planned`} />
              <Stat label="Per hour" value={f.carbs_g_h ?? "—"} unit="g/h" sub={f.planned_g_h ? `plan ${f.planned_g_h} g/h` : undefined} />
              <Stat label="Reminders" value={`${(f.items ?? []).reduce((a, x) => a + x.taken, 0)}/${(f.items ?? []).reduce((a, x) => a + x.expected, 0)}`}
                    sub={`${(f.items ?? []).reduce((a, x) => a + x.on_time, 0)} on time`} />
            </Stats>
            <div className="divide-y divide-[#18181B] text-xs">
              {(f.items ?? []).map((it) => (
                <div key={it.name} className="py-2 flex items-center gap-3 tabular-nums">
                  <span className="w-20 font-medium text-sm">{it.name}</span>
                  <span className="flex-1 text-[#A1A1AA]">
                    every {it.every_min} min · taken {it.taken} of {it.expected}
                    {it.late ? ` · ${it.late} late (≈ ${it.avg_late_min} min)` : ""}
                    {it.early ? ` · ${it.early} early` : ""}
                  </span>
                  {it.overdue_at_end_min > 0 && <span className="text-[#71717A]">overdue {fmtDur(it.overdue_at_end_min)} at the end</span>}
                </div>
              ))}
            </div>
            {!!f.timeline?.length && (
              <div className="flex flex-wrap gap-1.5">
                {f.timeline.map((t, i) => (
                  <span key={i} title={t.taken_min == null ? `${t.item} due at ${fmtDur(t.due_min!)} — never taken` :
                                       `${t.item} taken at ${fmtDur(t.taken_min)}`}
                        className={`text-[11px] tabular-nums rounded-lg px-2 py-0.5 border ${
                          t.taken_min == null ? "border-[#27272A] text-[#52525B] line-through"
                            : (t.late_min ?? 0) > 5 ? "border-transparent bg-[#F59E0B]/10 text-[#F59E0B]"
                            : "border-[#27272A] bg-[#18181B] text-[#D4D4D8]"}`}>
                    {t.item} {fmtDur(t.taken_min ?? t.due_min ?? 0)}{(t.late_min ?? 0) > 5 ? ` +${t.late_min}` : ""}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        )}
      </Block>
    </div>
  );
}

/** On an activity page: the review when the ride followed a Coll route; nothing otherwise. */
export function ActivityRouteReview({ activityId }: { activityId: string }) {
  const { data } = useQuery({ queryKey: COLL_KEYS.review(activityId), queryFn: () => collApi.review(activityId),
                              retry: false, staleTime: 60_000 });
  if (!data || data.error) return null;
  return <RideReview review={data} />;
}
