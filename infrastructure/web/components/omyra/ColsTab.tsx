"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ClimbsSummary, ColsSummary } from "@/lib/api";
import { ColSign } from "@/components/training/ColSign";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const year = (d: string) => d.slice(0, 4);

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A personal MyCols: every col your bike rides went over, Mallorca's still to climb, and every real climb. */
export function ColsTab() {
  const { data: cols } = useQuery<ColsSummary>({
    queryKey: ["cols"], queryFn: () => fetch(`${API}/training/cols`).then((r) => r.json()),
  });
  const { data: climbs } = useQuery<ClimbsSummary>({
    queryKey: ["climbs"], queryFn: () => fetch(`${API}/training/climbs`).then((r) => r.json()),
  });
  const [allCols, setAllCols] = useState(false);
  const [allClimbs, setAllClimbs] = useState(false);
  const [sort, setSort] = useState<"gain" | "times" | "recent">("gain");

  if (!cols || !climbs) return <div className="h-60 rounded-2xl bg-[#18181B] animate-pulse" />;

  const byEle = [...cols.climbed].sort((a, b) => (b.ele ?? 0) - (a.ele ?? 0));
  const shown = allCols ? byEle : byEle.slice(0, 12);
  const m = cols.mallorca;
  const climbList = [...climbs.climbs].sort((a, b) =>
    sort === "times" ? b.times - a.times : sort === "recent" ? b.last_date.localeCompare(a.last_date) : b.gain_m - a.gain_m);
  const climbsShown = allClimbs ? climbList : climbList.slice(0, 15);

  return (
    <div>
      {/* Hero: the highest col as a big sign, the counts beside it */}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-5 mb-8 grid grid-cols-[minmax(0,11rem)_1fr] gap-5 items-center">
        {cols.highest ? (
          <ColSign size="lg" name={cols.highest.name} ele={cols.highest.ele} kind="col"
                   href={`/activity/${encodeURIComponent(cols.highest.last_activity_id)}`}
                   footer={<>highest · {cols.highest.times}× · since {year(cols.highest.first_date)}</>} />
        ) : <div />}
        <div className="grid grid-cols-2 gap-4">
          {[
            ["Cols", cols.total, `${cols.visits} times over them`],
            ["Climbs", climbs.total, `${climbs.ascents} ascents`],
            ["Climbed", `${(climbs.metres / 1000).toFixed(1)} km`, "vertical, in counted climbs"],
            ["Mallorca road cols", m ? `${m.road_climbed}/${m.road_total}` : "—", m && m.road_total ? `${Math.round(m.road_climbed / m.road_total * 100)}% of the island` : ""],
          ].map(([l, v, sub]) => (
            <div key={l as string}>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{l}</p>
              <p className="text-2xl font-semibold tabular-nums">{v}</p>
              <p className="text-[11px] text-[#71717A]">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* The collection */}
      <Section title="Your cols" action={<span className="text-xs text-[#71717A]">highest first · tap for the last ride</span>}>
        {byEle.length === 0 ? (
          <p className="text-sm text-[#71717A]">No cols yet — they&apos;re picked up from your bike rides after a sync.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {shown.map((c) => (
                <ColSign key={c.osm_id} name={c.name} ele={c.ele} kind="col"
                         href={`/activity/${encodeURIComponent(c.last_activity_id)}`}
                         footer={<>{c.times}× · first {c.first_date}</>} />
              ))}
            </div>
            {byEle.length > 12 && (
              <button onClick={() => setAllCols((v) => !v)} className="mt-3 text-xs text-[#71717A] hover:text-[#A1A1AA]">
                {allCols ? "Show fewer" : `Show all ${byEle.length} cols`}
              </button>
            )}
          </>
        )}
      </Section>

      {/* Mallorca: road cols still to climb */}
      {m && m.todo.length > 0 && (
        <Section title={`Mallorca · ${m.todo.length} road cols still to climb`}>
          <div className="h-1.5 rounded-full bg-[#18181B] overflow-hidden mb-4">
            <div className="h-full rounded-full" style={{ width: `${(m.road_climbed / m.road_total) * 100}%`, background: "#B91C1C" }} />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
            {m.todo.slice(0, 15).map((t) => (
              <ColSign key={t.osm_id} size="sm" faded name={t.name} ele={t.ele} footer={<>{t.km_from_home} km away</>} />
            ))}
          </div>
        </Section>
      )}

      {/* Every real climb, from the elevation of your rides */}
      <Section title="Climbs" action={
        <div className="flex rounded-lg bg-[#18181B] border border-[#27272A] p-0.5 text-[11px]">
          {([["gain", "biggest"], ["times", "most ridden"], ["recent", "recent"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)}
                    className={`px-2.5 py-1 rounded-md ${sort === k ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"}`}>{l}</button>
          ))}
        </div>}>
        {climbList.length === 0 ? (
          <p className="text-sm text-[#71717A]">
            Climbs come from your rides&apos; Garmin elevation (100 m+ at 3 %+). They appear once rides have their
            second-by-second data synced.
          </p>
        ) : (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl divide-y divide-[#18181B] overflow-hidden">
            {climbsShown.map((c) => (
              <Link key={c.key} href={`/activity/${encodeURIComponent(c.last_activity_id)}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[#18181B] transition-colors">
                <div className="w-[4.5rem] shrink-0">
                  <ColSign size="sm" name="" ele={c.ele} kind={c.kind} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-[#71717A] tabular-nums">
                    {c.length_km} km · +{c.gain_m} m · {c.avg_pct}%
                    {c.sides.length ? ` · from ${c.sides.slice(0, 2).join(" / ")}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <p className="text-sm font-semibold">{c.times}×</p>
                  {c.best_vam ? <p className="text-[11px] text-[#71717A]">best {c.best_vam} m/h</p> : null}
                </div>
              </Link>
            ))}
            {climbList.length > 15 && (
              <button onClick={() => setAllClimbs((v) => !v)} className="w-full px-4 py-2.5 text-xs text-left text-[#71717A] hover:text-[#A1A1AA]">
                {allClimbs ? "Show fewer" : `Show all ${climbList.length} climbs`}
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-[#71717A] mt-2">
          VAM = metres climbed per hour — the fairest way to compare ascents of different climbs.
        </p>
      </Section>
    </div>
  );
}
