export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api, type TracksGeoJSON } from "@/lib/api";
import { TripJourney } from "@/components/TripJourney";
import { TripExpenses } from "@/components/TripExpenses";
import { SectionLabel } from "@/components/MorningBrief";
import { WithPicker } from "@/components/plan/WithPicker";
import { TripPlan } from "@/components/plan/TripPlan";
import { Flag } from "@/components/Flag";
import { localISODate } from "@/lib/dates";
import { TripStory } from "@/components/trip/TripStory";

interface Props {
  params: Promise<{ start: string; end: string }>;
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = new Date(end + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

export default async function TripDetailPage({ params }: Props) {
  const { start, end } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) notFound();

  // Fetch the trip first so we know its return day, then pull the tracks for
  // the full span — the trip window includes the travel-home day (return_date)
  // even though the route key is the last away night (end).
  const trip = await api.trip(start, end).catch(() => null);
  if (!trip) notFound();

  const rangeEnd = trip.return_date ?? end;

  // Every date in the trip window (inclusive of the home-coming day), for the scrubber.
  const tripDates: string[] = [];
  for (let t = new Date(start + "T12:00:00"); t <= new Date(rangeEnd + "T12:00:00"); t.setDate(t.getDate() + 1)) {
    tripDates.push(localISODate(t));
  }

  // Tracks per day — the exact request the day page makes. One /tracks-range call
  // for the whole trip can outlast the server-fetch timeout on the Pi and come
  // back empty; per day, a slow or failed day only blanks itself.
  const perDay = await Promise.all(tripDates.map((d) =>
    api.tracks(d)
      .then((g) => g.features.map((f) => ({ ...f, properties: { ...f.properties, date: d } })))
      .catch(() => [])));
  const tracks: TracksGeoJSON = { type: "FeatureCollection", features: perDay.flat() };

  const away = trip.n_nights;
  const furthest = trip.max_distance_from_home_km != null
    ? `${Math.round(trip.max_distance_from_home_km).toLocaleString("en-GB")} km from home` : null;
  const sub = [trip.home_at_start ? `from ${trip.home_at_start}` : null, furthest,
               trip.passenger_flight_count ? `${trip.passenger_flight_count} flight${trip.passenger_flight_count === 1 ? "" : "s"}` : null]
    .filter(Boolean).join(" · ");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3"
      >
        <ChevronLeft size={13} /> Explore
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Flag country={trip.primary_country} fallback="" /> {trip.name}
        </h1>
        <p className="text-sm text-[#71717A] mt-1">{fmtRange(trip.start_date, rangeEnd)}</p>
      </div>

      <div className="flex flex-col gap-8">
        {/* The story: cover, hero, the trip in a few lines, route + moments, day by day, export */}
        <TripStory start={trip.start_date} end={rangeEnd} name={trip.name}
                   hero={{ eyebrow: "Away from home", value: away, unit: away === 1 ? "night" : "nights", sub: sub || undefined }} />

        <section>
          <SectionLabel>With</SectionLabel>
          <WithPicker trip={{ start: trip.start_date, end: trip.end_date }} />
        </section>

        <TripPlan start={trip.start_date} end={trip.end_date} />

        {/* Spending across the trip */}
        <TripExpenses start={trip.start_date} end={rangeEnd} />

        {/* Every stop, day by day, on the detailed map */}
        <section>
          <SectionLabel>Every stop</SectionLabel>
          <TripJourney dates={tripDates} geojson={tracks} />
        </section>
      </div>
    </main>
  );
}
