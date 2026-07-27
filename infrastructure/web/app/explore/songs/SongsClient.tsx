"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Play, Download, X, Trash2, Music } from "lucide-react";
import { songsApi, type Song, type SongsStats, type SongIn } from "@/lib/songs-api";

// Pull a YouTube video id out of a music.youtube.com / youtube.com / youtu.be URL
// so we can build a single "play all" playlist link.
function youtubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(embed|shorts)\/([^/?]+)/);
    return m?.[2] ?? null;
  } catch {
    return null;
  }
}

function AddSongSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = [title, artist].filter(Boolean).join(" ").trim();
  const ytSearch = `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    setSaving(true); setError(null);
    try {
      const body: SongIn = {
        date, title: title.trim(),
        artist: artist.trim() || undefined,
        url: url.trim() || undefined,
        rating: rating ?? undefined,
      };
      await songsApi.create(body);
      onSaved(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  const inputCls =
    "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10 space-y-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto -mt-2 mb-1" />
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#FAFAFA]">Add a song</p>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={16} /></button>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} [color-scheme:dark]`} />
        <input placeholder="Song title *" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        <input placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} className={inputCls} />
        <div className="flex gap-2">
          <input placeholder="YouTube Music URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} className={`flex-1 min-w-0 ${inputCls}`} />
          <a href={ytSearch} target="_blank" rel="noopener noreferrer"
            onClick={(e) => { if (!q) e.preventDefault(); }}
            className={`shrink-0 flex items-center px-3 rounded-lg text-xs font-medium ${q ? "bg-[#FF0033]/10 text-[#FF6B81] hover:bg-[#FF0033]/20" : "bg-[#18181B] text-[#3F3F46]"}`}>🔎 Search</a>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(rating === n ? null : n)}
              className={`flex-1 py-2 rounded-lg text-sm ${rating != null && n <= rating ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"}`}>⭐</button>
          ))}
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
        <button onClick={submit} disabled={saving || !title.trim()}
          className="w-full py-3 bg-[#F59E0B] hover:bg-[#FBBF24] text-black text-sm font-semibold rounded-xl disabled:opacity-50">
          {saving ? "Saving…" : "Save song"}
        </button>
      </div>
    </div>
  );
}

interface Props {
  initialSongs: Song[];
  initialStats: SongsStats | null;
}

export function SongsClient({ initialSongs, initialStats: stats }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [filterYear, setFilterYear] = useState<string>("all");

  const years = useMemo(() => {
    const set = new Set<string>();
    initialSongs.forEach((s) => set.add(s.date.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [initialSongs]);

  const filtered = useMemo(
    () => initialSongs.filter((s) => filterYear === "all" || s.date.slice(0, 4) === filterYear),
    [initialSongs, filterYear]
  );

  const distinctArtists = new Set(filtered.map((s) => s.artist).filter(Boolean)).size;
  const daysCovered = new Set(filtered.map((s) => s.date)).size;

  // Top artists within the filtered set
  const artistCounts: Record<string, number> = {};
  filtered.forEach((s) => { if (s.artist) artistCounts[s.artist] = (artistCounts[s.artist] ?? 0) + 1; });
  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // "Play all" — a temporary YouTube playlist from the filtered songs' ids
  const ids = filtered.map((s) => youtubeId(s.url)).filter((x): x is string => !!x);
  const playAllUrl = ids.length ? `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(",")}` : null;

  const yearParam = filterYear === "all" ? undefined : Number(filterYear);

  async function onSaved() { router.refresh(); }
  async function del(id: number) {
    await songsApi.delete(id).catch(() => {});
    router.refresh();
  }

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Song of the day</h1>
          <p className="text-sm text-[#71717A] mt-1">
            {stats?.total_songs ?? initialSongs.length} songs · {stats?.total_with_links ?? 0} with links
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="shrink-0 flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] transition-colors">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">{filtered.length}</p>
          <p className="text-xs text-[#52525B] mt-1">{filterYear === "all" ? "total songs" : `songs in ${filterYear}`}</p>
        </div>
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">{distinctArtists}</p>
          <p className="text-xs text-[#52525B] mt-1">artists</p>
        </div>
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">{daysCovered}</p>
          <p className="text-xs text-[#52525B] mt-1">days covered</p>
        </div>
      </div>

      {/* Year filter */}
      {years.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button onClick={() => setFilterYear("all")}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filterYear === "all" ? "bg-[#27272A] text-[#FAFAFA] border-transparent" : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"}`}>
            All
          </button>
          {years.map((y) => (
            <button key={y} onClick={() => setFilterYear(y)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filterYear === y ? "bg-[#27272A] text-[#FAFAFA] border-transparent" : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"}`}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Playlist export */}
      <div className="flex items-center gap-2 flex-wrap mb-6 bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3">
        <span className="text-xs text-[#52525B] uppercase tracking-widest mr-1">
          {filterYear === "all" ? "All-time" : filterYear} playlist
        </span>
        {playAllUrl && (
          <a href={playAllUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-[#FF0033]/10 text-[#FF6B81] hover:bg-[#FF0033]/20 transition-colors">
            <Play size={13} /> Play all ({ids.length})
          </a>
        )}
        <a href={songsApi.exportUrl(yearParam, "m3u")} download
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 transition-colors">
          <Download size={13} /> M3U
        </a>
        <a href={songsApi.exportUrl(yearParam, "csv")} download
          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-[#27272A] text-[#A1A1AA] hover:bg-[#3F3F46] hover:text-[#FAFAFA] transition-colors">
          <Download size={13} /> CSV
        </a>
      </div>

      {/* Top artists */}
      {topArtists.length > 0 && (
        <div className="mb-6">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Most played artists</p>
          <div className="flex flex-wrap gap-2">
            {topArtists.map(([artist, n]) => (
              <span key={artist} className="text-xs px-3 py-1.5 rounded-full bg-[#18181B] border border-[#27272A] text-[#D4D4D8]">
                {artist} <span className="text-[#52525B]">· {n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Song list */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center">
          <Music size={22} className="mx-auto text-[#3F3F46] mb-2" />
          <p className="text-sm text-[#71717A]">No songs logged {filterYear === "all" ? "yet" : `in ${filterYear}`}.</p>
          <p className="text-xs text-[#3F3F46] mt-1">Tap <span className="text-[#F59E0B]">+ Add</span> — or log one from any day&apos;s + button.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <div key={s.id}
              className="group bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors">
              <span className="text-lg shrink-0">{s.url ? "▶️" : "🎵"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA] truncate">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.title}</a>
                  ) : s.title}
                </p>
                <p className="text-xs text-[#52525B] truncate">
                  {[s.artist, s.date].filter(Boolean).join(" · ")}
                  {s.mood ? ` · ${s.mood}` : ""}
                </p>
              </div>
              {s.rating != null && (
                <span className="text-xs font-semibold text-[#F59E0B] shrink-0">{"⭐".repeat(s.rating)}</span>
              )}
              <button onClick={() => del(s.id)}
                className="shrink-0 p-1.5 rounded-lg text-[#3F3F46] opacity-0 group-hover:opacity-100 hover:text-[#EF4444] hover:bg-[#18181B] transition-all"
                title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddSongSheet onClose={() => setShowAdd(false)} onSaved={onSaved} />}
    </>
  );
}
