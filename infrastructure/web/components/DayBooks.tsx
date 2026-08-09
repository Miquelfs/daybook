"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Book } from "@/lib/books-api";
import { SectionLabel } from "@/components/MorningBrief";
import { AddBookSheet } from "@/components/books/AddBookSheet";

export function DayBooks({ date }: { date: string }) {
  const [showAdd, setShowAdd] = useState(false);

  const { data: books = [] } = useQuery<Book[]>({
    queryKey: ["day-books", date],
    queryFn: async () => {
      const res = await fetch(`/api/books?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  if (books.length === 0 && !showAdd) return null;

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Finished reading</SectionLabel>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs px-2.5 py-1 bg-[#18181B] border border-[#27272A] rounded-lg text-[#71717A] hover:text-[#A1A1AA] hover:bg-[#27272A] transition-colors"
          >+ Add</button>
        </div>

        {books.length === 0 ? (
          <p className="text-xs text-[#3F3F46] py-2">Nothing logged yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {books.map((b) => (
              <a
                key={b.id}
                href={`/explore/books/${b.id}`}
                className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors"
              >
                <span className="text-xl">📖</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA] truncate">{b.title}</p>
                  <p className="text-xs text-[#52525B] truncate">{b.author}</p>
                </div>
                {b.rating != null && (
                  <span className="text-sm font-semibold text-[#F59E0B] tabular-nums shrink-0">{"⭐".repeat(b.rating)}</span>
                )}
              </a>
            ))}
          </div>
        )}
      </section>

      <AddBookSheet isOpen={showAdd} onClose={() => setShowAdd(false)} defaultDate={date} />
    </>
  );
}
