"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Trash2 } from "lucide-react";
import { Block, Empty, Panel } from "@/components/ui/kit";
import { collApi, type CollRide } from "@/lib/coll-api";
import { fmtDur, quiet } from "./parts";

/** Rides Coll brought home — each one an activity like the watch's. */
export function RidesView({ rides, onOpenRoute, onChange }: {
  rides: CollRide[]; onOpenRoute: (id: number) => void; onChange: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(id: number, f: () => Promise<unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await f();
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!rides.length) {
    return (
      <Block title="Rides">
        <Empty>
          No rides yet. Coll uploads each ride when it&apos;s home on Wi-Fi; it shows up here and as an activity.
          If the watch recorded the same ride, the watch&apos;s activity is the one that counts.
        </Empty>
      </Block>
    );
  }

  const km = rides.reduce((a, r) => a + (r.summary?.distance_m ?? 0), 0) / 1000;
  const mins = rides.reduce((a, r) => a + (r.summary?.moving_s ?? 0), 0) / 60;

  return (
    <Block title="Rides" note={`${rides.length} ride${rides.length === 1 ? "" : "s"} · ${Math.round(km).toLocaleString("en-GB")} km · ${fmtDur(mins)} moving`}>
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      <Panel className="divide-y divide-[#18181B] overflow-hidden">
        {rides.map((r) => {
          const s = r.summary;
          const day = r.activity_date ?? r.start_utc.slice(0, 10);
          const d = new Date(`${day}T12:00:00`);
          const kmh = s && s.moving_s ? (s.distance_m / s.moving_s) * 3.6 : null;
          return (
            <div key={r.id} className="px-4 py-3 flex items-start gap-3">
              <Link href={`/day/${day}`} className="w-11 shrink-0 bg-[#18181B] rounded-xl py-1.5 text-center hover:opacity-80">
                <p className="text-lg font-semibold leading-none tabular-nums">{d.getDate()}</p>
                <p className="text-[10px] uppercase tracking-widest text-[#71717A] mt-1">
                  {d.toLocaleDateString("en-GB", { month: "short" })}
                </p>
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {r.activity_id
                    ? <Link href={`/activity/${r.activity_id}`} className="hover:underline">{r.activity_name ?? r.name ?? "Ride"}</Link>
                    : (r.name ?? "Ride")}
                </p>
                {s && (
                  <p className="text-xs text-[#A1A1AA] mt-0.5 tabular-nums">
                    {(s.distance_m / 1000).toFixed(1)} km · {fmtDur(s.moving_s / 60)}
                    {s.ascent_m != null && ` · +${s.ascent_m} m`}
                    {kmh && ` · ${kmh.toFixed(1)} km/h`}
                    {s.avg_hr != null && ` · ${s.avg_hr} bpm`}
                    {s.avg_power != null && ` · ${s.avg_power} W`}
                  </p>
                )}
                <p className="text-xs text-[#52525B] mt-0.5">
                  {s?.course
                    ? <>On <button onClick={() => onOpenRoute(s.course!.id)} className="underline hover:text-[#A1A1AA]">{s.course.name}</button></>
                    : "No route"}
                  {r.status === "merged" && " · the watch recorded it too: its activity counts"}
                  {` · ${r.format === "clg" ? "ride log" : "GPX"}`}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-3 pt-0.5">
                <button className={quiet} disabled={busy === r.id} title="Import again from the uploaded file"
                        onClick={() => act(r.id, () => collApi.reimportRide(r.id))}>
                  <RefreshCw size={13} className={busy === r.id ? "animate-spin" : ""} />
                </button>
                <button className={`${quiet} hover:text-rose-400`} disabled={busy === r.id} title="Forget this ride"
                        onClick={() => confirm(`Forget this ride${r.status === "activity" ? " and its activity" : ""}?`) &&
                          act(r.id, () => collApi.removeRide(r.id))}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </Panel>
    </Block>
  );
}
