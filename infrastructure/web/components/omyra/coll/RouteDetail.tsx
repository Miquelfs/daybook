"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Clock, Droplets, MapPin, Mountain, Pencil, RefreshCw, Trash2,
} from "lucide-react";
import { Block, Empty, Hero, Panel, Skeleton, Stat, Stats, Toggle } from "@/components/ui/kit";
import { GradeProfile } from "@/components/training/StageProfile";
import { CollMap } from "@/components/omyra/CollMap";
import { collApi, COLL_KEYS, turnText, type CollCourse, type CollSettings } from "@/lib/coll-api";
import {
  field, fmtDate, fmtDur, fmtKm, FuelChips, Group, quiet, routeSteps, Select, Stepper, whenText,
} from "./parts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
interface Goal { id: number; name: string; race_date: string; status: string }

const KIND_ICON = { feed: Droplets, summit: Mountain, hazard: AlertTriangle, poi: MapPin } as const;

/** One route, as a page: where it goes and what it asks of you, then what Coll will do on it. */
export function RouteDetail({ course, settings, onBack, onChange }: {
  course: CollCourse; settings: CollSettings; onBack: () => void; onChange: () => void;
}) {
  const qc = useQueryClient();
  const id = course.id;
  const { data: c } = useQuery({
    queryKey: COLL_KEYS.course(id), queryFn: () => collApi.course(id),
    refetchInterval: (q) => (q.state.data && ["pending", "building"].includes(q.state.data.status) ? 5000 : false),
  });
  const { data: goals } = useQuery<Goal[]>({
    queryKey: ["race-goals"], queryFn: () => fetch(`${API}/race-plans/goals`).then((r) => r.json()),
  });
  const [focus, setFocus] = useState<number | null>(null);
  const [allTurns, setAllTurns] = useState(false);
  const [editFuel, setEditFuel] = useState(false);
  const [editCut, setEditCut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const line = useMemo(() => (c?.polyline ? [{ id: c.id, name: c.name, polyline: c.polyline, synced: c.on_device }] : []),
                       [c?.id, c?.name, c?.polyline, c?.on_device]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <button onClick={onBack} className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-flex items-center gap-1">
      <ArrowLeft size={12} />All routes
    </button>
  );
  if (!c) return <div className="space-y-4">{back}<Skeleton h={420} /></div>;

  async function save(body: Parameters<typeof collApi.patch>[1]) {
    setErr(null);
    try {
      qc.setQueryData(COLL_KEYS.course(id), await collApi.patch(id, body));
      onChange();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  }

  const b = c.brief;
  const s = c.summary ?? {};
  const isRace = c.goal_id !== null;
  const turns = allTurns ? c.turns : c.turns.slice(0, 15);
  const steps = routeSteps(course);
  const day = b?.date;
  const kmh = b ? Math.round((b.km / (b.est_minutes / 60)) * 10) / 10 : null;

  return (
    <div className="space-y-8">
      <div>
        {back}
        <div className="flex items-start justify-between gap-4 mt-2">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight truncate">{c.name}</h2>
            <p className="text-sm text-[#71717A] mt-0.5">
              {day ? <Link href={`/day/${day}`} className="hover:underline">{fmtDate(day, true)}</Link> : "No date — an uploaded route"}
              {isRace && " · race course"}
              {c.session_id && " · from the plan"}
            </p>
          </div>
        </div>
      </div>

      <Hero eyebrow={day ? whenText(day) : "Route"} value={b ? fmtKm(b.km) : "—"} unit="km"
            sub={b ? <>+{b.climb_m.toLocaleString("en-GB")} m climbing · ≈ {fmtDur(b.est_minutes)} riding at {kmh} km/h</> : null}>
        <div className="mt-5 pt-4 border-t border-[#18181B]">
          <Stepper steps={steps} />
          {c.status === "building" && <p className="text-xs text-[#F59E0B] mt-3 text-center truncate">{c.progress?.trim() || "Converting…"}</p>}
          {c.status === "failed" && <p className="text-xs text-rose-400 mt-3 text-center">{c.error}</p>}
          {course.on_coll === "next sync" && c.status === "ready" &&
            <p className="text-xs text-[#71717A] mt-3 text-center">Coll takes it the next time it syncs at home.</p>}
        </div>
      </Hero>

      {/* Map + gradient profile */}
      <Panel className="overflow-hidden">
        {c.polyline
          ? <CollMap lines={line} selected={c.id} pack={c.map} turns={c.turns} focus={focus} height="380px" bare />
          : <div className="h-40 flex items-center justify-center text-xs text-[#52525B]">The map appears once it's converted</div>}
        {b && b.profile.length > 2 && (
          <div className="p-4 border-t border-[#18181B]">
            <GradeProfile profile={b.profile} height={120}
                          markers={(b.markers ?? []).map((m) => ({ ...m, name: m.name.startsWith("Climb ") ? `+${m.gain_m} m` : m.name }))} />
          </div>
        )}
      </Panel>

      {b && (
        <Stats cols={4}>
          <Stat label="Climbing" value={`+${b.climb_m.toLocaleString("en-GB")}`} unit="m"
                sub={b.high_m != null ? `high point ${b.high_m} m` : undefined} />
          <Stat label="Riding time" value={fmtDur(b.est_minutes)}
                sub={b.pace.source === "your rides" ? `your pace, ${b.pace.rides} rides` : "touring estimate"} />
          <Stat label="Carbs to carry" value={b.carry ? b.carry.carbs_g.toLocaleString("en-GB") : "—"} unit={b.carry ? "g" : undefined}
                sub={b.carry?.carbs_g_h ? `${b.carry.carbs_g_h} g/h` : undefined} />
          <Stat label="Daylight" value={b.daylight ? b.daylight.sunset : "—"} unit={b.daylight ? "sunset" : undefined}
                sub={b.daylight ? (b.daylight.needs_lights ? "longer than the day: lights" : `start by ${b.daylight.latest_start}`) : "no date"} />
        </Stats>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <Block title="Climbs">
          {b?.climbs?.length ? (
            <Panel className="divide-y divide-[#18181B]">
              {b.climbs.map((cl, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="w-12 shrink-0 text-xs text-[#71717A] tabular-nums">km {cl.km}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cl.name ?? `Climb to km ${cl.top_km}`}</p>
                    <p className="text-xs text-[#71717A] tabular-nums">
                      {cl.length_km} km · +{cl.gain_m} m · {cl.avg_pct}% avg · {cl.max_200m_pct}% max
                    </p>
                  </div>
                  <span className="text-xs text-[#A1A1AA] tabular-nums shrink-0">≈ {fmtDur(cl.est_min)}</span>
                </div>
              ))}
            </Panel>
          ) : <Empty>{b?.has_elevation === false ? "The GPX has no elevation." : "No real climbs on this route."}</Empty>}
        </Block>

        <Block title="Along the way">
          {(b?.along?.length || b?.cutoffs?.length) ? (
            <Panel className="divide-y divide-[#18181B] max-h-[420px] overflow-y-auto">
              {[...(b.along ?? []).map((w) => ({ ...w, cut: null as string | null })),
                ...(b.cutoffs ?? []).filter((x) => x.km != null).map((x) => ({ km: x.km!, kind: "cut" as const, name: x.name ?? "Cut-off", off_m: 0, cut: x.at }))]
                .sort((x, y) => x.km - y.km)
                .map((w, i) => {
                  const Icon = w.kind === "cut" ? Clock : KIND_ICON[w.kind] ?? MapPin;
                  return (
                    <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="w-12 shrink-0 text-xs text-[#71717A] tabular-nums">km {fmtKm(w.km)}</span>
                      <Icon size={13} className={`shrink-0 ${w.kind === "hazard" ? "text-rose-400" : w.kind === "cut" ? "text-[#F59E0B]" : "text-[#52525B]"}`} />
                      <span className="flex-1 min-w-0 truncate text-[#D4D4D8]">{w.name}</span>
                      {w.cut && <span className="text-xs text-[#F59E0B] tabular-nums">by {w.cut}</span>}
                    </div>
                  );
                })}
            </Panel>
          ) : <Empty>No feeds, summits or warnings in the GPX.</Empty>}
        </Block>
      </div>

      {/* Fuel and cut-offs: what Coll reminds you of on this route */}
      <Block title="Fuel on this route">
        <Panel className="p-4 space-y-4">
          <Group title={c.fuel.source ? `Reminders · from the ${c.fuel.source}` : "Reminders"}
                 right={<button onClick={() => setEditFuel(!editFuel)} className={quiet}><Pencil size={11} />{editFuel ? "Done" : "Change"}</button>}>
            <FuelChips plan={c.fuel.fuel_plan} />
            {c.fuel.note && <p className="text-xs text-[#52525B] mt-2">{c.fuel.note}</p>}
            {editFuel && (
              <div className="mt-3">
                <input className={field} autoFocus placeholder="e.g. Gel:30:25,Drink:20 — empty to follow the plan again"
                       defaultValue={c.fuel_plan ?? ""}
                       onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                       onBlur={async (e) => { if (await save({ fuel_plan: e.target.value })) setEditFuel(false); }} />
                <p className="text-xs text-[#52525B] mt-1">name:every minutes[:carbs g], comma-separated · carb product: {settings.fuel_product?.name ?? "—"}</p>
              </div>
            )}
          </Group>
          {b?.carry && b.carry.items.some((x) => x.carbs_g) && (
            <Group title={`To carry for ≈ ${fmtDur(b.est_minutes)}`}>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
                {b.carry.items.filter((x) => x.carbs_g).map((x) => (
                  <span key={x.name}><span className="font-semibold">{x.count}</span> <span className="text-[#A1A1AA]">× {x.name}</span>
                    <span className="text-[#52525B]"> · {x.carbs_g} g</span></span>
                ))}
              </div>
            </Group>
          )}
          {isRace && (
            <Group title="Cut-off times"
                   right={<button onClick={() => setEditCut(!editCut)} className={quiet}><Pencil size={11} />{editCut ? "Done" : "Change"}</button>}>
              {b?.cutoffs?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {b.cutoffs.map((x, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-[#18181B] border border-[#27272A] rounded-lg px-2.5 py-1">
                      <span className="font-medium text-[#FAFAFA]">{x.name ?? `km ${x.km}`}</span>
                      <span className="text-[#71717A]">{x.km != null ? `km ${fmtKm(x.km)} · ` : ""}by {x.at}</span>
                    </span>
                  ))}
                </div>
              ) : <p className="text-xs text-[#52525B]">None yet. Coll beeps when you're projected to miss one by under 15 min.</p>}
              {editCut && (
                <div className="mt-3">
                  <input className={field} autoFocus placeholder="Temps tall@13:30; 225@19:00 Sa Granja" defaultValue={c.cutoffs ?? ""}
                         onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                         onBlur={async (e) => { if (await save({ cutoffs: e.target.value })) setEditCut(false); }} />
                  <p className="text-xs text-[#52525B] mt-1">km or a waypoint name, @ local time, separated by “;”</p>
                </div>
              )}
            </Group>
          )}
          {err && <p className="text-xs text-rose-400">{err}</p>}
        </Panel>
      </Block>

      {/* What Coll will say: the navigation check before a ride */}
      {c.status === "ready" && (
        <Block title="Navigation check"
               note={(s.keeps ?? 0) > 0 ? "Coll speaks at every real junction. KEEP prompts (amber) are where the road forks gently — check those on the map." : undefined}>
          <Panel className="p-4 space-y-4">
            <Stats cols={4}>
              <Stat label="Prompts" value={c.turns.length} sub={`${s.keeps ?? 0} keep · ${s.roundabouts ?? 0} roundabout`} />
              <Stat label="On mapped roads" value={s.matched_pct ?? "—"} unit="%"
                    sub={s.matched_pct != null && s.matched_pct < 95 ? "check off-road bits" : "good"} />
              <Stat label="Tunnels" value={s.tunnels?.length ?? 0} sub={s.tunnels?.length ? "climbing corrected" : undefined} />
              <Stat label="Pack" value={Math.round((s.bytes ?? 0) / 1024)} unit="KB" sub={`${c.waypoints ?? 0} waypoints`} />
            </Stats>
            {c.turns.length > 0 && (
              <div>
                <div className="rounded-xl border border-[#18181B] divide-y divide-[#18181B]">
                  {turns.map((t, i) => (
                    <button key={i} onClick={() => setFocus(i)} disabled={!c.map}
                            className={`w-full text-left px-3 py-2 flex items-center gap-3 text-xs transition-colors hover:bg-[#18181B] ${focus === i ? "bg-[#18181B]" : ""}`}>
                      <span className="text-[#71717A] w-14 shrink-0 tabular-nums">km {(t.at / 1000).toFixed(1)}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.kind === 1 ? "bg-[#F59E0B]" : "bg-[#3F3F46]"}`} />
                      <span className={t.kind === 1 ? "text-[#F59E0B] font-medium" : "text-[#D4D4D8]"}>{turnText(t)}</span>
                    </button>
                  ))}
                </div>
                {c.turns.length > 15 && (
                  <button onClick={() => setAllTurns(!allTurns)} className={`${quiet} mt-2`}>
                    {allTurns ? "Show fewer" : `Show all ${c.turns.length} prompts`}
                  </button>
                )}
              </div>
            )}
          </Panel>
        </Block>
      )}

      {b?.attempts && b.attempts.length > 0 && (
        <Block title="Your rides on it">
          <Panel className="divide-y divide-[#18181B]">
            {b.attempts.map((a) => (
              <Link key={a.activity_id} href={`/activity/${a.activity_id}`}
                    className="px-4 py-2.5 flex items-center gap-3 hover:bg-[#18181B] transition-colors">
                <span className="text-sm font-medium flex-1">{fmtDate(a.date)}</span>
                <span className="text-xs text-[#A1A1AA] tabular-nums">
                  {a.moving_time_seconds ? fmtDur(a.moving_time_seconds / 60) : "—"}
                  {a.distance_meters && a.moving_time_seconds ? ` · ${(a.distance_meters / a.moving_time_seconds * 3.6).toFixed(1)} km/h` : ""}
                  {a.avg_heart_rate ? ` · ${a.avg_heart_rate} bpm` : ""}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-[#52525B]">{a.source === "coll" ? "Coll" : "watch"}</span>
              </Link>
            ))}
          </Panel>
        </Block>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4 border-t border-[#18181B]">
        <Toggle on={c.on_device} onChange={(v) => save({ on_device: v })}
                label={c.on_device ? "On Coll" : "Kept off Coll"} />
        <button className={quiet} disabled={c.status === "building"}
                onClick={async () => { qc.setQueryData(COLL_KEYS.course(id), await collApi.rebuild(id)); onChange(); }}>
          <RefreshCw size={12} />Convert again
        </button>
        {!c.session_id && (goals ?? []).some((g) => g.status === "active") && (
          <div className="w-52">
            <Select value={c.goal_id ?? ""} onChange={(v) => save({ goal_id: v ? Number(v) : null })}>
              <option value="">Not a race course</option>
              {(goals ?? []).filter((g) => g.status === "active" || g.id === c.goal_id).map((g) =>
                <option key={g.id} value={g.id}>Race course · {g.name}</option>)}
            </Select>
          </div>
        )}
        {!c.auto && (
          <button className={`${quiet} hover:text-rose-400`}
                  onClick={async () => { if (confirm(`Delete ${c.name}?`)) { await collApi.remove(id); onChange(); onBack(); } }}>
            <Trash2 size={12} />Delete
          </button>
        )}
        {c.built_at && <span className="text-xs text-[#52525B] ml-auto">Converted {fmtDate(c.built_at.slice(0, 10))}</span>}
      </div>
    </div>
  );
}
