"use client";

import { useQuery } from "@tanstack/react-query";
import { Chip, Stat, Stats } from "@/components/ui/kit";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type DayPlaceStats = {
  date: string; places: number; cities: string[]; countries: string[];
  new_places: { name: string; city: string | null }[];
  new_cities: { city: string; country: string | null }[];
  new_countries: string[];
};

/** Under the day's map: how many places, which cities, and what was a first visit (amber) — all tappable. */
export function DayPlaces({ date }: { date: string }) {
  const { data } = useQuery<DayPlaceStats>({
    queryKey: ["place-day", date],
    queryFn: () => fetch(`${BASE}/locations/place-stats/day/${date}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  if (!data || !data.places) return null;
  const isNewCity = (c: string) => data.new_cities.some((n) => n.city === c);

  return (
    <div className="mt-3">
      <Stats cols={3}>
        <Stat label="Places" value={data.places} />
        <Stat label="First visits" value={data.new_places.length} />
        <Stat label={data.cities.length === 1 ? "City" : "Cities"} value={data.cities.length}
              sub={data.new_cities.length ? `${data.new_cities.length} new` : undefined} />
      </Stats>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {data.new_countries.map((c) => <Chip key={c} accent>first time in {c}</Chip>)}
        {data.cities.map((c) => (
          <Chip key={c} accent={isNewCity(c)} href={`/explore/place/${encodeURIComponent(c)}`}>
            {c}{isNewCity(c) ? " · new" : ""}
          </Chip>
        ))}
        {data.new_places.slice(0, 8).map((p) => (
          <Chip key={p.name + p.city} href={`/explore/place/${encodeURIComponent(p.name)}`} title="first visit">
            {p.name}
          </Chip>
        ))}
        {data.new_places.length > 8 && <span className="text-xs text-[#52525B] self-center">+{data.new_places.length - 8}</span>}
      </div>
    </div>
  );
}
