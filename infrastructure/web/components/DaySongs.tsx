"use client";

import { useQuery } from "@tanstack/react-query";
import type { Song } from "@/lib/songs-api";
import { SectionLabel } from "@/components/MorningBrief";

// The day's "song of the day" (usually one, occasionally more). Read-only here —
// add/edit happens through the day FAB and the /explore/songs database.
export function DaySongs({ date }: { date: string }) {
  const { data: songs = [] } = useQuery<Song[]>({
    queryKey: ["day-songs", date],
    queryFn: async () => {
      const res = await fetch(`/api/songs?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  if (songs.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Song of the day</SectionLabel>
      </div>

      <div className="flex flex-col gap-2">
        {songs.map((s) => {
          const inner = (
            <>
              <span className="text-xl">{s.url ? "▶️" : "🎵"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA] truncate">{s.title}</p>
                {s.artist && <p className="text-xs text-[#52525B] truncate">{s.artist}</p>}
              </div>
              {s.rating != null && (
                <span className="text-sm font-semibold text-[#F59E0B] tabular-nums shrink-0">
                  {"⭐".repeat(s.rating)}
                </span>
              )}
            </>
          );
          const cls =
            "bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors";
          return s.url ? (
            <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className={cls}>
              {inner}
            </a>
          ) : (
            <a key={s.id} href="/explore/songs" className={cls}>
              {inner}
            </a>
          );
        })}
      </div>
    </section>
  );
}
