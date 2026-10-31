"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Block, Panel } from "@/components/ui/kit";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Month = { month: string; places: number; new_places: number; new_countries: string[] };
type PlaceMonths = { months: Month[] };

const short = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" });

/** First visits per month — the place data stays in the background; this is the one number shown. */
export function PlacesMonthsCard({ year }: { year?: number }) {
  const { data } = useQuery<PlaceMonths>({
    queryKey: ["place-months", year ?? "last12"],
    queryFn: () => fetch(`${BASE}/locations/place-stats/months${year ? `?year=${year}` : ""}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const months = data?.months ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const cur = months.find((m) => m.month === sel) ?? [...months].reverse().find((m) => m.places) ?? months[months.length - 1];
  if (!cur || !months.some((m) => m.new_places)) return null;
  const max = Math.max(1, ...months.map((m) => m.new_places));

  return (
    <div className="mb-8">
      <Block title="First visits">
        <Panel className="p-4">
          <p className="text-sm text-[#A1A1AA]">
            <b className="text-[#FAFAFA] font-semibold tabular-nums">{cur.new_places}</b> first visit{cur.new_places === 1 ? "" : "s"} in{" "}
            {new Date(`${cur.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            {cur.new_countries.length > 0 && <span className="text-[#F59E0B]"> · first time in {cur.new_countries.join(", ")}</span>}
          </p>
          <div className="flex items-end gap-1 h-16 mt-3">
            {months.map((m) => {
              const on = m.month === cur.month;
              return (
                <button key={m.month} onClick={() => setSel(m.month)} title={`${m.new_places} first visits`}
                        className="flex-1 h-full flex flex-col justify-end items-stretch">
                  <span className="w-full rounded-sm"
                        style={{ height: `${Math.max(4, (m.new_places / max) * 100)}%`, background: on ? "#F59E0B" : "var(--viz-grid)" }} />
                  <span className={`text-[10px] mt-1 text-center ${on ? "text-[#F59E0B]" : "text-[#52525B]"}`}>{short(m.month)}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      </Block>
    </div>
  );
}
