"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Show } from "@/lib/shows-api";
import { SectionLabel } from "@/components/MorningBrief";
import { X } from "lucide-react";

const TYPE_EMOJI: Record<string, string> = { movie: "🎬", show: "📺", documentary: "🎞" };
const TYPES = ["movie", "show", "documentary"] as const;

function AddShowSheet({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"movie" | "show" | "documentary">("movie");
  const [platform, setPlatform] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          type,
          platform: platform.trim() || null,
          rating_mf: rating,
          date_watched: date,
        }),
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
          <p className="text-sm font-semibold text-[#FAFAFA]">Log what you watched</p>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={16} /></button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Type</label>
          <div className="flex gap-2">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  type === t ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}
              >
                <span>{TYPE_EMOJI[t]}</span> {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Title *</label>
          <input
            type="text" placeholder="Title" value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Platform</label>
          <input
            type="text" placeholder="e.g. Netflix, Apple TV+" value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Rating (1–10)</label>
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? null : n)}
                className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                  rating === n ? "bg-[#F59E0B] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}
              >{n}</button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[#F87171]">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function DayShows({ date }: { date: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

  const { data: shows = [] } = useQuery<Show[]>({
    queryKey: ["day-shows", date],
    queryFn: async () => {
      const res = await fetch(`/api/shows?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["day-shows", date] });
  }

  if (shows.length === 0 && !showAdd) return null;

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Watched</SectionLabel>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs px-2.5 py-1 bg-[#18181B] border border-[#27272A] rounded-lg text-[#71717A] hover:text-[#A1A1AA] hover:bg-[#27272A] transition-colors"
          >+ Add</button>
        </div>

        {shows.length === 0 ? (
          <p className="text-xs text-[#3F3F46] py-2">Nothing logged yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {shows.map((s) => (
              <a
                key={s.id}
                href="/explore/shows"
                className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors"
              >
                <span className="text-xl">{TYPE_EMOJI[s.type ?? ""] ?? "🎬"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA] truncate">{s.title}</p>
                  <p className="text-xs text-[#52525B] truncate">
                    {[s.genre, s.platform].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {s.rating_mf != null && (
                  <span className="text-sm font-semibold text-[#F59E0B] tabular-nums shrink-0">{s.rating_mf}/10</span>
                )}
              </a>
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <AddShowSheet date={date} onClose={() => setShowAdd(false)} onSaved={onSaved} />
      )}
    </>
  );
}
