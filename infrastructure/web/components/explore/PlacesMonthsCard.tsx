"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Block, Chip, Panel, Stat, Stats } from "@/components/ui/kit";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Month = {
  month: string; places: number; cities: number; countries: number;
  new_places: number; new_cities: number; new_city_names: string[]; new_countries: string[];
};
type PlaceMonths = { months: Month[]; totals: { places: number; cities: number; countries: number } };
type MonthDetail = {
  month: string;
  new_places: { date: string; name: string; city: string | null }[];
  new_cities: { date: string; city: string; country: string | null }[];
  new_countries: { date: string; country: string }[];
};

const short = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" });
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const DAYS_SHOWN = 6;

/** Places by month: how much of the world each month touched and what was new — every new place links to its day. */
export function PlacesMonthsCard({ year }: { year?: number }) {
  const { data } = useQuery<PlaceMonths>({
    queryKey: ["place-months", year ?? "last12"],
    queryFn: () => fetch(`${BASE}/locations/place-stats/months${year ? `?year=${year}` : ""}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const months = data?.months ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const cur = months.find((m) => m.month === sel) ?? [...months].reverse().find((m) => m.places) ?? months[months.length - 1];

  const { data: detail } = useQuery<MonthDetail>({
    queryKey: ["place-month", cur?.month],
    queryFn: () => fetch(`${BASE}/locations/place-stats/month/${cur!.month}`).then((r) => r.json()),
    enabled: !!cur?.month,
    staleTime: 600_000,
  });
  // new places grouped by the day they were first visited
  const byDay = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const p of detail?.new_places ?? []) g.set(p.date, [...(g.get(p.date) ?? []), p.name]);
    return [...g.entries()];
  }, [detail]);

  if (!cur || !months.some((m) => m.places)) return null;
  const max = Math.max(1, ...months.map((m) => m.places));

  return (
    <div className="mb-8">
      <Block title="Places by month"
             action={data && <span className="text-xs text-[#52525B] tabular-nums">
               {data.totals.places.toLocaleString("en-GB")} places · {data.totals.cities} cities · {data.totals.countries} countries
             </span>}>
        <Panel className="p-4">
          {/* 12 months: all places (grey) with the new ones (amber) inside — tap a month */}
          <div className="flex items-end gap-1 h-20">
            {months.map((m) => {
              const on = m.month === cur.month;
              return (
                <button key={m.month} onClick={() => { setSel(m.month); setAll(false); }}
                        title={`${m.places} places · ${m.new_places} new`}
                        className="flex-1 h-full flex flex-col justify-end items-stretch">
                  <span className="relative w-full rounded-sm overflow-hidden"
                        style={{ height: `${Math.max(4, (m.places / max) * 100)}%`, background: "var(--viz-grid)" }}>
                    <span className="absolute inset-x-0 bottom-0"
                          style={{ height: `${m.places ? (m.new_places / m.places) * 100 : 0}%`,
                                   background: on ? "#F59E0B" : "var(--viz-ref)" }} />
                  </span>
                  <span className={`text-[10px] mt-1 text-center ${on ? "text-[#F59E0B]" : "text-[#52525B]"}`}>{short(m.month)}</span>
                </button>
              );
            })}
          </div>

          <p className="text-xs text-[#71717A] mt-4 mb-2">
            {new Date(`${cur.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </p>
          <Stats cols={3}>
            <Stat label="New places" value={cur.new_places} sub={`of ${cur.places}`} />
            <Stat label="New cities" value={cur.new_cities} sub={`of ${cur.cities}`} />
            <Stat label="Countries" value={cur.countries}
                  sub={cur.new_countries.length ? `${cur.new_countries.join(", ")} new` : "none new"} />
          </Stats>

          {(detail?.new_cities.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {detail!.new_cities.map((c) => (
                <Chip key={c.city + c.date} accent href={`/explore/place/${encodeURIComponent(c.city)}`}
                      title={`first visit ${c.date}`}>{c.city}</Chip>
              ))}
            </div>
          )}

          {byDay.length > 0 && (
            <div className="mt-4 divide-y divide-[#18181B]">
              {(all ? byDay : byDay.slice(0, DAYS_SHOWN)).map(([d, names]) => (
                <Link key={d} href={`/day/${d}`} className="flex gap-3 py-2 group">
                  <span className="text-xs text-[#71717A] tabular-nums w-24 shrink-0 group-hover:text-[#F59E0B]">{dayLabel(d)}</span>
                  <span className="text-xs text-[#A1A1AA] flex-1 min-w-0 line-clamp-2">
                    {names.slice(0, 5).join(" · ")}{names.length > 5 ? ` +${names.length - 5}` : ""}
                  </span>
                </Link>
              ))}
              {byDay.length > DAYS_SHOWN && (
                <button onClick={() => setAll((v) => !v)} className="w-full text-left text-xs text-[#52525B] hover:text-[#A1A1AA] pt-2">
                  {all ? "Show less" : `${byDay.length - DAYS_SHOWN} more days`}
                </button>
              )}
            </div>
          )}
        </Panel>
      </Block>
    </div>
  );
}
