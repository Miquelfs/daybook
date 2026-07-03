"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Book } from "@/lib/books-api";
import { SectionLabel } from "@/components/MorningBrief";
import { X } from "lucide-react";

function AddBookSheet({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), author: author.trim() || null, rating, date_finished: date }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? "Failed"); }
      onSaved(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto -mt-2 mb-2" />
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#FAFAFA]">Log a book</p>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={16} /></button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Title *</label>
          <input
            type="text" placeholder="Book title" value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Author</label>
          <input
            type="text" placeholder="Author name" value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Rating</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? null : n)}
                className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                  rating != null && n <= rating ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}
              >{"⭐".repeat(n)}</button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[#F87171]">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
          {saving ? "Saving…" : "Save book"}
        </button>
      </div>
    </div>
  );
}

export function DayBooks({ date }: { date: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

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

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["day-books", date] });
  }

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
                href="/explore/books"
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

      {showAdd && (
        <AddBookSheet date={date} onClose={() => setShowAdd(false)} onSaved={onSaved} />
      )}
    </>
  );
}
