"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { showsApi, type Show, type ShowIn } from "@/lib/shows-api";

const TYPE_EMOJI: Record<string, string> = {
  movie: "🎬",
  show: "📺",
  documentary: "🎞",
};

const GENRE_EMOJI: Record<string, string> = {
  Action: "💥", Comedy: "😂", Drama: "🎭", Thriller: "😰", Horror: "👻",
  Romance: "💕", "Sci-Fi": "🚀", Fantasy: "🧙", Animation: "✏️",
  Documentary: "🎞", Crime: "🔍", Adventure: "🗺", Mystery: "🕵️",
  History: "📜", Sport: "⚽", Music: "🎵", Family: "👨‍👩‍👧",
};

const PLATFORMS = [
  "Netflix", "HBO Max", "Disney+", "Apple TV+", "Amazon Prime",
  "Cinema", "Movistar+", "YouTube", "Other",
];

const GENRES = Object.keys(GENRE_EMOJI).concat(["Other"]);
const TYPES = ["movie", "show", "documentary"];

function AddShowSheet({
  onClose,
  onSave,
  defaultDate,
}: {
  onClose: () => void;
  onSave: (s: ShowIn) => void;
  defaultDate?: string;
}) {
  const [form, setForm] = useState<ShowIn>({ title: "", date_watched: defaultDate, type: "movie" });

  const set = (key: keyof ShowIn, value: string | number | undefined) =>
    setForm((f) => ({ ...f, [key]: value || undefined }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Add to Watchlist</h2>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">×</button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Type toggle */}
          <div className="flex rounded-lg border border-[#27272A] overflow-hidden">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm((f) => ({ ...f, type: t }))}
                className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
                  form.type === t
                    ? "bg-[#F59E0B]/20 text-[#F59E0B]"
                    : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {TYPE_EMOJI[t]} {t}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Title *</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Date</label>
              <input
                type="date"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                value={form.date_watched ?? ""}
                onChange={(e) => set("date_watched", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Genre</label>
              <select
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                value={form.genre ?? ""}
                onChange={(e) => set("genre", e.target.value)}
              >
                <option value="">—</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Platform / Where</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, platform: f.platform === p ? undefined : p }))}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    form.platform === p
                      ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]"
                      : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Watched with</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
              placeholder="Solo, Alice…"
              value={form.companions ?? ""}
              onChange={(e) => set("companions", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Rating MF (1–10)</label>
              <input
                type="number" min={1} max={10}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="8"
                value={form.rating_mf ?? ""}
                onChange={(e) => set("rating_mf", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Rating AD (1–10)</label>
              <input
                type="number" min={1} max={10}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="8"
                value={form.rating_ad ?? ""}
                onChange={(e) => set("rating_ad", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Notes</label>
            <textarea
              rows={2}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] resize-none"
              placeholder="Thoughts…"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <button
            disabled={!form.title.trim()}
            onClick={() => form.title.trim() && onSave(form)}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ShowRow({ show: s }: { show: Show }) {
  const emoji = TYPE_EMOJI[s.type ?? ""] ?? "🎬";
  const genreEmoji = GENRE_EMOJI[s.genre ?? ""] ?? "";

  return (
    <div className="border-b border-[#1C1C1F] last:border-none py-3 flex items-center gap-3 px-2">
      <span className="text-lg w-7 shrink-0 text-center">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#FAFAFA] truncate">{s.title}</p>
        <p className="text-xs text-[#52525B] truncate">
          {[
            s.genre ? `${genreEmoji} ${s.genre}` : null,
            s.platform,
            s.date_watched ? s.date_watched.slice(0, 7) : null,
            s.companions,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {s.rating_mf != null && (
          <span className="text-xs font-semibold text-[#F59E0B] tabular-nums">{s.rating_mf}/10</span>
        )}
        {s.rating_ad != null && (
          <span className="text-xs text-[#71717A] tabular-nums">AD {s.rating_ad}</span>
        )}
      </div>
    </div>
  );
}

export default function ShowsPage() {
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

  const { data: shows = [], isLoading } = useQuery({
    queryKey: ["shows"],
    queryFn: () => showsApi.list(),
  });

  const { data: stats } = useQuery({
    queryKey: ["show-stats"],
    queryFn: () => showsApi.stats(),
  });

  const createMutation = useMutation({
    mutationFn: (body: ShowIn) => showsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shows"] });
      queryClient.invalidateQueries({ queryKey: ["show-stats"] });
      setShowAdd(false);
    },
  });

  const years = Array.from(
    new Set(shows.map((s) => s.date_watched?.slice(0, 4)).filter(Boolean) as string[])
  ).sort((a, b) => b.localeCompare(a));

  const filtered = shows.filter((s) => {
    if (filterYear !== "all" && s.date_watched?.slice(0, 4) !== filterYear) return false;
    if (filterType !== "all" && s.type !== filterType) return false;
    return true;
  });

  const movieCount = filtered.filter((s) => s.type === "movie").length;
  const showCount = filtered.filter((s) => s.type === "show").length;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <Link
        href="/explore"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Explore
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1">Databases</p>
          <h1 className="text-2xl font-semibold tracking-tight">Shows & Movies</h1>
          {stats && (
            <p className="text-sm text-[#71717A] mt-1">
              {stats.total} watched
              {stats.avg_rating_mf != null && ` · avg ${stats.avg_rating_mf}/10`}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="mt-1 flex items-center gap-1.5 bg-[#F59E0B] hover:bg-[#D97706] text-[#09090B] text-xs font-semibold rounded-lg px-3 py-2 transition-colors shrink-0"
        >
          + Add
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{movieCount > 0 ? movieCount : stats.by_type["movie"] ?? 0}</p>
            <p className="text-xs text-[#52525B]">🎬 Movies</p>
          </div>
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{showCount > 0 ? showCount : stats.by_type["show"] ?? 0}</p>
            <p className="text-xs text-[#52525B]">📺 Shows</p>
          </div>
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{stats.avg_rating_mf ?? "—"}</p>
            <p className="text-xs text-[#52525B]">Avg Rating</p>
          </div>
        </div>
      )}

      {/* Top rated */}
      {stats && stats.top_rated.length > 0 && filterYear === "all" && filterType === "all" && (
        <section className="mb-6">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Top Rated</h2>
          <div className="flex flex-col gap-1">
            {stats.top_rated.slice(0, 5).map((s, i) => (
              <div key={s.id} className="flex items-center gap-2 py-0.5">
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">{i + 1}</span>
                <span className="text-sm">{TYPE_EMOJI[s.type ?? ""] ?? "🎬"}</span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">{s.title}</span>
                <span className="text-xs font-semibold text-[#F59E0B] tabular-nums shrink-0">{s.rating_mf}/10</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Year filter */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-none">
        {(["all", ...years] as string[]).map((y) => (
          <button
            key={y}
            onClick={() => setFilterYear(y)}
            className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
              filterYear === y
                ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {y === "all" ? "All time" : y}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-none">
        {(["all", ...TYPES] as string[]).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
              filterType === t
                ? "border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10"
                : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {t === "all" ? "All types" : `${TYPE_EMOJI[t]} ${t}`}
          </button>
        ))}
      </div>

      {/* List */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">
            {filtered.length} {filtered.length === 1 ? "title" : "titles"}
          </h2>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-[#18181B] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
            <p className="text-sm text-[#71717A]">No titles match your filters.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((s) => <ShowRow key={s.id} show={s} />)}
          </div>
        )}
      </section>

      {showAdd && (
        <AddShowSheet
          onClose={() => setShowAdd(false)}
          onSave={(body) => createMutation.mutate(body)}
          defaultDate={new Date().toISOString().slice(0, 10)}
        />
      )}
    </main>
  );
}
