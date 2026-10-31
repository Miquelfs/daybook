"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type DayPlaceStats = {
  date: string; places: number;
  new_places: { name: string; city: string | null }[];
  new_countries: string[];
};

/** Under the day's map, only when it happened: how many first visits (and a first country). */
export function DayPlaces({ date }: { date: string }) {
  const { data } = useQuery<DayPlaceStats>({
    queryKey: ["place-day", date],
    queryFn: () => fetch(`${BASE}/locations/place-stats/day/${date}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const n = data?.new_places.length ?? 0;
  if (!data || (!n && !data.new_countries.length)) return null;

  return (
    <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-[#A1A1AA]">
      <Sparkles size={12} className="text-[#F59E0B]" />
      {n > 0 && <><b className="text-[#FAFAFA] font-medium tabular-nums">{n}</b> first visit{n === 1 ? "" : "s"}</>}
      {data.new_countries.length > 0 && <>{n > 0 ? " · " : ""}first time in {data.new_countries.join(", ")}</>}
    </p>
  );
}
