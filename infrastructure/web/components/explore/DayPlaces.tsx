"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Sparkles } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type DayPlaceStats = {
  date: string; places: number; cities: string[]; countries: string[];
  new_places: { name: string; city: string | null }[];
  new_cities: { city: string; country: string | null }[];
  new_countries: string[];
};

/** Under the day's map: how many places, which cities, and what was a first visit. */
export function DayPlaces({ date }: { date: string }) {
  const { data } = useQuery<DayPlaceStats>({
    queryKey: ["place-day", date],
    queryFn: () => fetch(`${BASE}/locations/place-stats/day/${date}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  if (!data || !data.places) return null;
  const firsts = data.new_countries.length + data.new_cities.length;

  return (
    <div className="mt-3 rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums leading-none">{data.places}</p>
          <p className="text-[11px] text-[#71717A] mt-1">places</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums leading-none" style={{ color: data.new_places.length ? "#10B981" : undefined }}>
            {data.new_places.length}
          </p>
          <p className="text-[11px] text-[#71717A] mt-1">first visits</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums leading-none" style={{ color: firsts ? "#8B5CF6" : undefined }}>
            {data.cities.length}
          </p>
          <p className="text-[11px] text-[#71717A] mt-1">{data.cities.length === 1 ? "city" : "cities"}{firsts ? ` · ${data.new_cities.length} new` : ""}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {data.new_countries.map((c) => (
          <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-[#F59E0B]/15 text-[#F59E0B] font-semibold inline-flex items-center gap-1">
            <Sparkles size={11} /> first time in {c}
          </span>
        ))}
        {data.cities.map((c) => {
          const isNew = data.new_cities.some((n) => n.city === c);
          return (
            <Link key={c} href={`/explore/place/${encodeURIComponent(c)}`}
                  className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                    isNew ? "bg-[#8B5CF6]/12 text-[#8B5CF6] font-semibold" : "bg-[#18181B] text-[#A1A1AA]"}`}>
              <MapPin size={10} />{c}{isNew ? " · new" : ""}
            </Link>
          );
        })}
      </div>

      {data.new_places.length > 0 && (
        <p className="text-xs text-[#71717A] mt-2.5 leading-relaxed">
          <span className="text-[#10B981]">New:</span>{" "}
          {data.new_places.slice(0, 6).map((p) => p.name).join(" · ")}
          {data.new_places.length > 6 ? ` +${data.new_places.length - 6} more` : ""}
        </p>
      )}
    </div>
  );
}
