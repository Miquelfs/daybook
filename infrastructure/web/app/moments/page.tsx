"use client";

import { useState, useMemo, useEffect } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, subDays, parseISO, getDaysInMonth, startOfMonth, getDay } from "date-fns";
import { api } from "@/lib/api";
import type { DaySummary } from "@/lib/api";
import Link from "next/link";
import { X, Trash2 } from "lucide-react";

function photoProxyUrl(path: string): string {
  const filename = path.replace(/^\/photos\//, "").replace(/^.*\//, "");
  return `/api/photos/${filename}`;
}

const PAGE_SIZE = 365;

function windowFor(page: number) {
  const end = subDays(new Date(), page * PAGE_SIZE);
  const start = subDays(end, PAGE_SIZE - 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

// Group photos by "YYYY-MM" month key
function groupByMonth(days: DaySummary[]): { month: string; days: DaySummary[] }[] {
  const map = new Map<string, DaySummary[]>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, days]) => ({ month, days }));
}

export default function MomentsPage() {
  const [lightbox, setLightbox] = useState<DaySummary | null>(null);
  const queryClient = useQueryClient();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ["moments"],
      queryFn: ({ pageParam = 0 }) => {
        const { start, end } = windowFor(pageParam as number);
        return api.range(start, end);
      },
      initialPageParam: 0,
      getNextPageParam: (_last, _all, lastParam) => (lastParam as number) + 1,
    });

  const { mutate: deletePhoto, isPending: isDeleting } = useMutation({
    mutationFn: (date: string) => api.deletePhoto(date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moments"] });
      setLightbox(null);
    },
  });

  const allDays = data?.pages.flat() ?? [];
  const photoCount = allDays.filter((d) => d.photo_path).length;

  // Build a lookup: date string → DaySummary (only days with photos)
  const photoByDate = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const d of allDays) {
      if (d.photo_path) map.set(d.date, d);
    }
    return map;
  }, [allDays]);

  const monthGroups = useMemo(() => {
    const photoDays = allDays.filter((d) => d.photo_path);
    return groupByMonth(photoDays);
  }, [allDays]);

  // Scroll to bottom on initial load so current month is visible
  useEffect(() => {
    if (!isLoading && monthGroups.length > 0) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    }
  }, [isLoading, monthGroups.length]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-10">
      <header className="mb-8">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Today</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Moments</h1>
        <p className="text-sm text-[#71717A] mt-0.5">{photoCount} photo{photoCount !== 1 ? "s" : ""}</p>
      </header>

      {isLoading ? (
        <div className="space-y-10">
          {[0, 1].map((i) => (
            <div key={i}>
              <div className="h-4 w-24 bg-[#18181B] rounded animate-pulse mb-4" />
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, j) => (
                  <div key={j} className="aspect-square bg-[#18181B] rounded animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : photoCount === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-12 text-center">
          <p className="text-sm text-[#52525B]">No photos yet</p>
          <p className="text-xs text-[#3F3F46] mt-1">Add a photo from the Today view each day</p>
        </div>
      ) : (
        <div className="space-y-10">
          {hasNextPage && (
            <div className="flex justify-center mb-2">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] disabled:text-[#52525B] px-6 py-2 border border-[#27272A] rounded-full transition-colors"
              >
                {isFetchingNextPage ? "Loading…" : "Load older months"}
              </button>
            </div>
          )}
          {monthGroups.map(({ month }) => {
            const monthDate = parseISO(`${month}-01`);
            const daysInMonth = getDaysInMonth(monthDate);
            // Monday-first: convert Sunday=0 → 6, Mon=1 → 0, etc.
            const rawStart = getDay(startOfMonth(monthDate));
            const startOffset = (rawStart + 6) % 7;

            return (
              <section key={month}>
                <h2 className="text-sm font-semibold text-[#D4D4D8] mb-3 tracking-wide">
                  {format(monthDate, "MMMM yyyy")}
                </h2>

                {/* Day-of-week headers */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                    <div key={i} className="text-center text-[10px] text-[#3F3F46]">{d}</div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {/* Leading empty cells */}
                  {Array.from({ length: startOffset }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square" />
                  ))}

                  {/* Day cells */}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const dayNum = i + 1;
                    const dateStr = `${month}-${String(dayNum).padStart(2, "0")}`;
                    const day = photoByDate.get(dateStr);

                    if (day) {
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          onClick={() => setLightbox(day)}
                          className="relative aspect-square overflow-hidden rounded-md group"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoProxyUrl(day.photo_path!)}
                            alt={dateStr}
                            className="w-full h-full object-cover group-active:brightness-75 transition-all"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-white/90 font-medium leading-none">
                            {dayNum}
                          </span>
                        </button>
                      );
                    }

                    return (
                      <div
                        key={dateStr}
                        className="aspect-square rounded-md bg-[#111113] flex items-center justify-center"
                      >
                        <span className="text-[10px] text-[#2A2A2E]">{dayNum}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}


      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-16 bg-black/50 hover:bg-red-900/80 text-white rounded-full p-2 transition-colors disabled:opacity-50"
            disabled={isDeleting}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Delete this photo? This can't be undone.")) {
                deletePhoto(lightbox.date);
              }
            }}
          >
            <Trash2 size={22} />
          </button>
          <button
            type="button"
            className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white rounded-full p-2 transition-colors"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
          >
            <X size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoProxyUrl(lightbox.photo_path!)}
            alt={lightbox.date}
            className="max-w-full max-h-[80vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-4 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-[#D4D4D8]">
              {format(parseISO(lightbox.date), "EEEE, d MMMM yyyy")}
            </p>
            <Link
              href={`/day/${lightbox.date}`}
              className="text-xs text-[#F59E0B] hover:text-[#FCD34D] mt-1 inline-block"
              onClick={() => setLightbox(null)}
            >
              View that day →
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
