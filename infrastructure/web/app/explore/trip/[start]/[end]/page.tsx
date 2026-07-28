export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ImagePlus } from "lucide-react";
import { api } from "@/lib/api";
import { TripJourney } from "@/components/TripJourney";
import { TripExpenses } from "@/components/TripExpenses";
import { SectionLabel } from "@/components/MorningBrief";

interface Props {
  params: Promise<{ start: string; end: string }>;
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = new Date(end + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

function photoProxy(path: string): string {
  return `/api/photos/${path.split("/").pop()}`;
}

export default async function TripDetailPage({ params }: Props) {
  const { start, end } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) notFound();

  const [trip, tracks, days] = await Promise.all([
    api.trip(start, end).catch(() => null),
    api.tracksRange(start, end).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.range(start, end).catch(() => []),
  ]);

  if (!trip) notFound();

  // Every date in the trip window (inclusive), for the day scrubber.
  const tripDates: string[] = [];
  for (let t = new Date(start + "T12:00:00"); t <= new Date(end + "T12:00:00"); t.setDate(t.getDate() + 1)) {
    tripDates.push(t.toISOString().slice(0, 10));
  }

  const withPhotos = days.filter((d) => d.photo_path);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3"
      >
        <ChevronLeft size={13} /> Explore
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">🌍 {trip.name}</h1>
        <p className="text-sm text-[#71717A] mt-1">
          {fmtRange(trip.start_date, trip.end_date)} · {trip.n_nights} night{trip.n_nights === 1 ? "" : "s"}
          {trip.max_distance_from_home_km != null && (
            <span className="text-[#3F3F46]"> · {Math.round(trip.max_distance_from_home_km)} km out</span>
          )}
        </p>
        {trip.cities.length > 0 && (
          <p className="text-xs text-[#52525B] mt-1">{trip.cities.join(" · ")}</p>
        )}
      </div>

      <div className="flex flex-col gap-10">
        {/* Interactive day-by-day journey */}
        <section>
          <SectionLabel>Where I went</SectionLabel>
          <TripJourney dates={tripDates} geojson={tracks} />
        </section>

        {/* Spending across the trip */}
        <TripExpenses start={trip.start_date} end={trip.end_date} />

        {/* Photos, tap to open the day (add/replace there) */}
        <section>
          <SectionLabel>Photos</SectionLabel>
          {withPhotos.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {withPhotos.map((d) => (
                <Link
                  key={d.date}
                  href={`/day/${d.date}`}
                  className="relative aspect-square rounded-lg overflow-hidden border border-[#27272A] group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoProxy(d.photo_path!)}
                    alt={d.photo_caption ?? d.date}
                    className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                  />
                  <span className="absolute bottom-1 left-1.5 text-[10px] text-white/90 tabular-nums drop-shadow">
                    {new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#52525B]">No photos yet for these days.</p>
          )}

          {/* Add photos: photos live per-day, so link into each day of the trip */}
          <div className="mt-3">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">Add a photo to a day</p>
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => (
                <Link
                  key={d.date}
                  href={`/day/${d.date}`}
                  className="inline-flex items-center gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-full px-2.5 py-1 text-xs text-[#A1A1AA] hover:border-[#F59E0B]/40 hover:text-[#F59E0B] transition-colors"
                >
                  {d.photo_path ? null : <ImagePlus size={11} />}
                  {new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
