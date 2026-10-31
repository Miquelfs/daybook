"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Month = {
  month: string; places: number; cities: number; countries: number;
  new_places: number; new_cities: number; new_city_names: string[]; new_countries: string[];
};
type PlaceMonths = { months: Month[]; totals: { places: number; cities: number; countries: number } };

const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" });

/** Places by month: how much of the world each month touched, and how much of it was new. */
export function PlacesMonthsCard({ year }: { year?: number }) {
  const { data } = useQuery<PlaceMonths>({
    queryKey: ["place-months", year ?? "last12"],
    queryFn: () => fetch(`${BASE}/locations/place-stats/months${year ? `?year=${year}` : ""}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const months = data?.months ?? [];
  const [sel, setSel] = useState<string | null>(null);
  if (!months.some((m) => m.places)) return null;
  const cur = months.find((m) => m.month === sel) ?? [...months].reverse().find((m) => m.places) ?? months[months.length - 1];
  const max = Math.max(1, ...months.map((m) => m.places));

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Places by month</h2>
        {data && (
          <span className="text-xs text-[#71717A] tabular-nums">
            all time {data.totals.places.toLocaleString("en-GB")} places · {data.totals.cities} cities · {data.totals.countries} countries
          </span>
        )}
      </div>
      <div className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] p-5">
        {/* the selected month in numbers */}
        <p className="text-[10px] text-[#71717A] uppercase tracking-widest">
          {new Date(`${cur.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </p>
        <div className="grid grid-cols-3 gap-3 mt-2">
          {[
            { v: cur.new_places, l: "new places", sub: `of ${cur.places}`, c: "#10B981" },
            { v: cur.new_cities, l: "new cities", sub: `of ${cur.cities}`, c: "#8B5CF6" },
            { v: cur.countries, l: cur.countries === 1 ? "country" : "countries",
              sub: cur.new_countries.length ? `${cur.new_countries.join(", ")} new` : "none new", c: "#F59E0B" },
          ].map((x) => (
            <div key={x.l}>
              <p className="text-[28px] leading-none font-semibold tabular-nums" style={{ color: x.v ? x.c : undefined }}>{x.v}</p>
              <p className="text-[11px] text-[#A1A1AA] mt-1">{x.l}</p>
              <p className="text-[11px] text-[#52525B] truncate">{x.sub}</p>
            </div>
          ))}
        </div>
        {cur.new_city_names.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {cur.new_city_names.map((c) => (
              <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-[#8B5CF6]/12 text-[#8B5CF6]">{c}</span>
            ))}
            {cur.new_cities > cur.new_city_names.length && (
              <span className="text-[11px] text-[#52525B] self-center">+{cur.new_cities - cur.new_city_names.length} more</span>
            )}
          </div>
        )}

        {/* 12 months: all places (light) with the new ones (green) stacked inside — tap a month */}
        <div className="flex items-end gap-1.5 h-28 mt-5">
          {months.map((m) => {
            const on = m.month === cur.month;
            return (
              <button key={m.month} onClick={() => setSel(m.month)} title={`${m.places} places · ${m.new_places} new`}
                      className="flex-1 h-full flex flex-col justify-end items-stretch group">
                <span className="relative w-full rounded-md overflow-hidden transition-all"
                      style={{ height: `${Math.max(3, (m.places / max) * 100)}%`, background: on ? "color-mix(in srgb, #10B981 28%, transparent)" : "var(--viz-grid)" }}>
                  <span className="absolute inset-x-0 bottom-0 rounded-md"
                        style={{ height: `${m.places ? (m.new_places / m.places) * 100 : 0}%`, background: "#10B981", opacity: on ? 1 : 0.55 }} />
                </span>
                <span className={`text-[9px] mt-1 text-center ${on ? "text-[#FAFAFA] font-semibold" : "text-[#52525B]"}`}>{label(m.month)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
