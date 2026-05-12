"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { format, subDays, parseISO } from "date-fns";
import { api } from "@/lib/api";
import { DayCard } from "@/components/DayCard";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

const PAGE_SIZE = 30; // days per page

function windowFor(page: number): { start: string; end: string } {
  const end = subDays(new Date(), page * PAGE_SIZE);
  const start = subDays(end, PAGE_SIZE - 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

export default function TimelinePage() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey: ["timeline"],
    queryFn: ({ pageParam = 0 }) => {
      const { start, end } = windowFor(pageParam as number);
      return api.range(start, end);
    },
    initialPageParam: 0,
    getNextPageParam: (_last, _all, lastParam) => (lastParam as number) + 1,
  });

  const allDays = data?.pages.flat() ?? [];

  // Group by year-month for section headers
  const grouped = allDays.reduce<Record<string, typeof allDays>>((acc, day) => {
    const key = day.date.slice(0, 7); // YYYY-MM
    if (!acc[key]) acc[key] = [];
    acc[key].push(day);
    return acc;
  }, {});

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      {/* Header */}
      <header className="pt-10 pb-6 border-b border-[#27272A] flex items-center gap-4">
        <Link
          href="/"
          className="text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1">All days</p>
          <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
        </div>
      </header>

      <div className="mt-6">
        {isError && (
          <div className="border border-red-900 bg-red-950/30 rounded-lg px-4 py-4 text-sm text-red-400 mb-4">
            <p className="font-medium mb-1">Could not load timeline</p>
            <p className="text-xs text-red-600 font-mono">{String(error)}</p>
            <p className="text-xs text-red-700 mt-2">Check that the API is reachable and NEXT_PUBLIC_API_URL is set correctly in the build.</p>
          </div>
        )}
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-12 bg-[#18181B] rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : (
          Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([month, days]) => (
              <div key={month} className="mb-6">
                <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2 px-4">
                  {format(parseISO(`${month}-01`), "MMMM yyyy")}
                </p>
                <div className="flex flex-col">
                  {[...days]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((day) => (
                      <DayCard key={day.date} day={day} />
                    ))}
                </div>
              </div>
            ))
        )}

        {/* Load more */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] disabled:text-[#52525B] transition-colors px-6 py-2 border border-[#27272A] rounded-full"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      </div>
    </main>
  );
}
