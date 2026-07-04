"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PlaceDate } from "@/lib/api";
import { ChevronLeft } from "lucide-react";
import { PlacePinMap } from "@/components/PlacePinMap";

const PAGE_SIZE = 10;

const moodEmoji = (m: number | null) => {
  if (!m) return null;
  if (m >= 9) return "🌟";
  if (m >= 7) return "😊";
  if (m >= 5) return "😐";
  if (m >= 3) return "😕";
  return "😔";
};

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export default function PlacePage() {
  const { name } = useParams<{ name: string }>();
  const placeName = decodeURIComponent(name);
  const [pages, setPages] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ["place-summary", placeName],
    queryFn: () => api.placeSummary(placeName),
  });

  const { data: visits = [], isLoading, isFetching } = useQuery({
    queryKey: ["place-dates", placeName, pages],
    queryFn: () => api.placeDates(placeName, { limit: pages * PAGE_SIZE }),
    placeholderData: (prev: PlaceDate[] | undefined) => prev,
  });

  const totalDays = summary?.total_days ?? visits.length;
  const withMood = visits.filter((d) => d.mood);
  const avgMood = withMood.length > 0
    ? (withMood.reduce((s, d) => s + (d.mood ?? 0), 0) / withMood.length).toFixed(1)
    : null;
  const country = summary?.country ?? visits[0]?.country ?? null;
  const city = summary?.city ?? visits[0]?.city ?? null;
  const hasMore = visits.length < totalDays && visits.length >= pages * PAGE_SIZE;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-6"
      >
        <ChevronLeft size={12} /> Places
      </Link>

      <h1 className="text-2xl font-semibold text-[#FAFAFA] mb-1">{placeName}</h1>
      {(city || country) && (
        <p className="text-sm text-[#71717A] mb-6">
          {city}{city && country ? " · " : ""}{country}
        </p>
      )}

      {/* Map pin */}
      {summary?.lat != null && summary?.lng != null && (
        <div className="mb-6">
          <PlacePinMap lat={summary.lat} lng={summary.lng} label={placeName} />
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Visits</p>
          <p className="text-2xl font-semibold text-[#F59E0B] tabular-nums">{totalDays}</p>
          <p className="text-xs text-[#52525B] mt-0.5">{totalDays === 1 ? "day" : "days"} recorded</p>
        </div>
        {avgMood && (
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Avg mood here</p>
            <p className="text-2xl font-semibold text-[#F59E0B] tabular-nums">{avgMood}</p>
            <p className="text-xs text-[#52525B] mt-0.5">out of 10</p>
          </div>
        )}
      </div>

      {/* First / last visit */}
      {summary?.first_visit && summary?.last_visit && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Link
            href={`/day/${summary.first_visit}`}
            className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 hover:border-[#3F3F46] transition-colors group"
          >
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">First visit</p>
            <p className="text-sm text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
              {formatDate(summary.first_visit)} →
            </p>
          </Link>
          <Link
            href={`/day/${summary.last_visit}`}
            className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 hover:border-[#3F3F46] transition-colors group"
          >
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Last visit</p>
            <p className="text-sm text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
              {formatDate(summary.last_visit)} →
            </p>
          </Link>
        </div>
      )}

      {/* Visit list — newest first, paginated */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
          Recent visits
        </h2>
        {isLoading ? (
          <div className="h-40 flex items-center justify-center text-[#52525B]">Loading…</div>
        ) : visits.length === 0 ? (
          <p className="text-sm text-[#52525B]">No recorded visits yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visits.map((entry) => (
              <Link
                key={entry.date}
                href={`/day/${entry.date}`}
                className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[#0D0D0F] border border-[#27272A] hover:border-[#3F3F46] hover:bg-[#18181B] transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
                    {formatDate(entry.date)}
                  </p>
                  {entry.mood_note && (
                    <p className="text-xs text-[#52525B] mt-1 line-clamp-2">{entry.mood_note}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {entry.mood && (
                    <span className="text-sm">{moodEmoji(entry.mood)}</span>
                  )}
                  {entry.mood && (
                    <span className="text-xs text-[#F59E0B] tabular-nums font-mono">{entry.mood}</span>
                  )}
                  {entry.energy && (
                    <span className="text-xs text-[#52525B] tabular-nums">⚡{entry.energy}</span>
                  )}
                </div>
              </Link>
            ))}
            {hasMore && (
              <button
                onClick={() => setPages((p) => p + 1)}
                disabled={isFetching}
                className="mt-1 py-2.5 rounded-xl border border-[#27272A] text-xs text-[#71717A] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors uppercase tracking-widest disabled:opacity-50"
              >
                {isFetching ? "Loading…" : `Load more (${totalDays - visits.length} left)`}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
