"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Search } from "lucide-react";
import { correlationsApi } from "@/lib/correlations-api";
import { moodEmoji } from "@/lib/api";

const PAGE_SIZE = 20;

export default function JournalPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const { data: entries, isFetching } = useQuery({
    queryKey: ["journal", query, page],
    queryFn: () => correlationsApi.journal(query, PAGE_SIZE, page * PAGE_SIZE),
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const handleSearch = useCallback(() => {
    setQuery(search.trim());
    setPage(0);
  }, [search]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="text-xs text-[#52525B] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Days with mood notes.</p>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes…"
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg pl-9 pr-4 py-2.5 text-sm
                       text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B] transition-colors"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2.5 bg-[#18181B] border border-[#27272A] rounded-lg text-sm text-[#A1A1AA]
                     hover:border-[#3F3F46] hover:text-[#FAFAFA] transition-colors"
        >
          Search
        </button>
        {query && (
          <button
            onClick={() => { setSearch(""); setQuery(""); setPage(0); }}
            className="px-3 py-2.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Results info */}
      {query && (
        <p className="text-xs text-[#52525B] mb-4">
          Showing results for &ldquo;<span className="text-[#A1A1AA]">{query}</span>&rdquo;
        </p>
      )}

      {/* Loading */}
      {isFetching && (
        <div className="text-center py-8 text-xs text-[#52525B]">Loading…</div>
      )}

      {/* Entries */}
      {!isFetching && entries && (
        <>
          {entries.length === 0 ? (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-12 text-center">
              <p className="text-sm text-[#52525B]">
                {query ? "No entries match your search." : "No journal entries yet."}
              </p>
              <p className="text-xs text-[#3F3F46] mt-1">
                Add mood notes in the daily questionnaire.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry) => (
                <Link
                  key={entry.date}
                  href={`/day/${entry.date}`}
                  className="block bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4
                             hover:border-[#3F3F46] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-xs text-[#52525B] uppercase tracking-widest">
                      {format(parseISO(entry.date), "EEEE, d MMM yyyy")}
                    </p>
                    {entry.mood !== null && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-base">{moodEmoji(entry.mood)}</span>
                        <span className="text-sm font-semibold text-[#F59E0B] tabular-nums">
                          {entry.mood}
                        </span>
                      </div>
                    )}
                  </div>

                  <p className="text-sm text-[#A1A1AA] leading-relaxed whitespace-pre-wrap">
                    {entry.mood_note}
                  </p>

                  {entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {entry.tags.map((slug) => (
                        <span
                          key={slug}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-[#18181B] border border-[#27272A] text-[#71717A]"
                        >
                          {slug}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {entries.length > 0 && (
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-4 py-2 rounded-lg border border-[#27272A] text-[#52525B]
                           disabled:opacity-30 hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors"
              >
                ← Newer
              </button>
              <p className="text-xs text-[#52525B]">Page {page + 1}</p>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={entries.length < PAGE_SIZE}
                className="text-xs px-4 py-2 rounded-lg border border-[#27272A] text-[#52525B]
                           disabled:opacity-30 hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors"
              >
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
