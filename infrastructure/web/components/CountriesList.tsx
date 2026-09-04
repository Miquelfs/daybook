"use client";

import { useTravelMapRef } from "@/components/TravelMapContext";
import type { WorldCoverage } from "@/lib/api";

interface Props {
  countries: { country: string; days: number }[];
  details: WorldCoverage["country_details"];
  totalDays: number;
  flags: Record<string, string>;
}

export function CountriesList({ countries, details, totalDays, flags }: Props) {
  const mapRef = useTravelMapRef();
  const byName = new Map(details.map((d) => [d.country, d]));

  return (
    <div className="flex flex-col gap-1">
      {countries.map((c, idx) => {
        const pct = totalDays > 0 ? (c.days / totalDays) * 100 : 0;
        const isTop3 = idx < 3;
        const iso2 = byName.get(c.country)?.iso2 ?? null;
        return (
          <button
            key={c.country}
            onClick={() => mapRef.current?.focusCountry({ country: c.country, iso2 })}
            className="flex items-center gap-2 w-full text-left rounded-lg px-1 py-0.5 -mx-1 hover:bg-[#18181B] transition-colors"
          >
            <span className="text-base w-6 text-center shrink-0">
              {flags[c.country] ?? "🌍"}
            </span>
            <span className="text-sm text-[#D4D4D8] flex-1 truncate">{c.country}</span>
            <div className="w-20 h-1.5 rounded-full bg-[#27272A] shrink-0">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, 2)}%`, background: "#F59E0B" }}
              />
            </div>
            <span
              className="text-xs tabular-nums w-8 text-right shrink-0"
              style={{ color: isTop3 ? "#F59E0B" : "#52525B" }}
            >
              {c.days}d
            </span>
          </button>
        );
      })}
    </div>
  );
}
