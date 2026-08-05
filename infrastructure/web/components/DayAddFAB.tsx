"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Plus, UtensilsCrossed, Tv, BookOpen, Music, Apple } from "lucide-react";
import { api, type RestaurantIn } from "@/lib/api";
import { showsApi, type ShowIn } from "@/lib/shows-api";
import { booksApi, type BookIn } from "@/lib/books-api";
import { songsApi, type SongIn } from "@/lib/songs-api";
import { FoodEntryComposer } from "@/components/FoodEntryComposer";

type Mode = "food" | "restaurant" | "show" | "book" | "song";

function RestaurantForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  // Existing cuisines/cities/countries → native autocomplete so you reuse a
  // category instead of typing it blind (and spawning near-duplicates).
  const { data: facets } = useQuery({
    queryKey: ["restaurant-facets"],
    queryFn: () => api.restaurantFacets(),
    staleTime: 5 * 60 * 1000,
  });
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [ratingMf, setRatingMf] = useState("");
  const [ratingAd, setRatingAd] = useState("");
  const [companions, setCompanions] = useState("");
  const [tripContext, setTripContext] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: RestaurantIn = {
        name: name.trim(),
        date_visited: date,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        cuisine: cuisine.trim() || undefined,
        rating_mf: ratingMf ? parseFloat(ratingMf) : undefined,
        rating_ad: ratingAd ? parseFloat(ratingAd) : undefined,
        companions: companions.trim() || undefined,
        trip_context: tripContext.trim() || undefined,
        google_maps_url: googleMapsUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await api.createRestaurant(body);
      qc.invalidateQueries({ queryKey: ["day-restaurants", date] });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required value={name} onChange={e => setName(e.target.value)}
        placeholder="Restaurant name *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="grid grid-cols-2 gap-2">
        <input value={city} onChange={e => setCity(e.target.value)}
          placeholder="City" list="restaurant-cities" autoComplete="off"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={country} onChange={e => setCountry(e.target.value)}
          placeholder="Country" list="restaurant-countries" autoComplete="off"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <input value={cuisine} onChange={e => setCuisine(e.target.value)}
        placeholder="Cuisine" list="restaurant-cuisines" autoComplete="off"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      {cuisine.trim() && facets?.cuisines && !facets.cuisines.some(c => c.toLowerCase() === cuisine.trim().toLowerCase()) && (
        <p className="text-[11px] text-[#71717A] -mt-1">New cuisine — will be added to the list</p>
      )}
      <datalist id="restaurant-cuisines">
        {(facets?.cuisines ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="restaurant-cities">
        {(facets?.cities ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="restaurant-countries">
        {(facets?.countries ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <div className="grid grid-cols-2 gap-2">
        <input value={ratingMf} onChange={e => setRatingMf(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="My rating (0–10)"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={ratingAd} onChange={e => setRatingAd(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="Partner rating"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <input value={companions} onChange={e => setCompanions(e.target.value)}
        placeholder="With (e.g. Adri, Mum)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <input value={tripContext} onChange={e => setTripContext(e.target.value)}
        placeholder="Trip context (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <input value={googleMapsUrl} onChange={e => setGoogleMapsUrl(e.target.value)}
        placeholder="Google Maps URL (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)" rows={2}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] resize-none" />
      <button type="submit" disabled={saving || !name.trim()}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : "Add restaurant"}
      </button>
    </form>
  );
}

function ShowForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [type, setType] = useState("movie");
  const [genre, setGenre] = useState("");
  const [platform, setPlatform] = useState("");
  const [ratingMf, setRatingMf] = useState("");
  const [ratingAd, setRatingAd] = useState("");
  const [companions, setCompanions] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const body: ShowIn = {
        title: title.trim(),
        date_watched: date,
        type,
        genre: genre.trim() || undefined,
        platform: platform.trim() || undefined,
        rating_mf: ratingMf ? parseFloat(ratingMf) : undefined,
        rating_ad: ratingAd ? parseFloat(ratingAd) : undefined,
        companions: companions.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await showsApi.create(body);
      qc.invalidateQueries({ queryKey: ["day-shows", date] });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="grid grid-cols-2 gap-2">
        <select value={type} onChange={e => setType(e.target.value)}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#3F3F46]">
          <option value="movie">Movie</option>
          <option value="show">TV Show</option>
          <option value="documentary">Documentary</option>
        </select>
        <input value={genre} onChange={e => setGenre(e.target.value)}
          placeholder="Genre"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <input value={platform} onChange={e => setPlatform(e.target.value)}
        placeholder="Platform (Netflix, Cinema…)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="grid grid-cols-2 gap-2">
        <input value={ratingMf} onChange={e => setRatingMf(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="My rating (0–10)"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={ratingAd} onChange={e => setRatingAd(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="Partner rating"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <input value={companions} onChange={e => setCompanions(e.target.value)}
        placeholder="Watched with (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)" rows={2}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] resize-none" />
      <button type="submit" disabled={saving || !title.trim()}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : "Add show / movie"}
      </button>
    </form>
  );
}

function BookForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !author.trim()) return;
    setSaving(true);
    try {
      const body: BookIn = {
        title: title.trim(),
        author: author.trim(),
        date_finished: date,
        genre: genre.trim() || undefined,
        language: language.trim() || undefined,
        rating: rating ? parseInt(rating) : undefined,
        notes: notes.trim() || undefined,
      };
      await booksApi.create(body);
      qc.invalidateQueries({ queryKey: ["day-books", date] });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <input required value={author} onChange={e => setAuthor(e.target.value)}
        placeholder="Author *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="grid grid-cols-2 gap-2">
        <input value={genre} onChange={e => setGenre(e.target.value)}
          placeholder="Genre"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={language} onChange={e => setLanguage(e.target.value)}
          placeholder="Language"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <select value={rating} onChange={e => setRating(e.target.value)}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#3F3F46]">
        <option value="">No rating</option>
        {[1,2,3,4,5].map(n => <option key={n} value={n}>{"⭐".repeat(n)}</option>)}
      </select>
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)" rows={2}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] resize-none" />
      <button type="submit" disabled={saving || !title.trim() || !author.trim()}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : "Add book"}
      </button>
    </form>
  );
}

function SongForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [url, setUrl] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [mood, setMood] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // One-tap: open a YouTube Music search for what's typed so the link is easy
  // to grab and paste back into the URL field.
  const searchQuery = [title, artist].filter(Boolean).join(" ").trim();
  const ytMusicSearch = `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const body: SongIn = {
        date,
        title: title.trim(),
        artist: artist.trim() || undefined,
        url: url.trim() || undefined,
        rating: rating ?? undefined,
        mood: mood.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await songsApi.create(body);
      qc.invalidateQueries({ queryKey: ["day-songs", date] });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Song title *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <input value={artist} onChange={e => setArtist(e.target.value)}
        placeholder="Artist"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="YouTube Music URL (optional)"
          className="flex-1 min-w-0 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <a href={ytMusicSearch} target="_blank" rel="noopener noreferrer"
          onClick={e => { if (!searchQuery) e.preventDefault(); }}
          className={`shrink-0 flex items-center gap-1 px-3 rounded-lg text-xs font-medium transition-colors ${
            searchQuery ? "bg-[#FF0033]/10 text-[#FF6B81] hover:bg-[#FF0033]/20" : "bg-[#18181B] text-[#3F3F46] cursor-not-allowed"
          }`}>
          🔎 Search
        </a>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(rating === n ? null : n)}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              rating != null && n <= rating ? "bg-[#FAFAFA] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
            }`}>⭐</button>
        ))}
      </div>
      <input value={mood} onChange={e => setMood(e.target.value)}
        placeholder="Mood / vibe (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)" rows={2}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] resize-none" />
      <button type="submit" disabled={saving || !title.trim()}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : "Add song of the day"}
      </button>
    </form>
  );
}

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode; color: string }> = {
  food:       { label: "Food", icon: <Apple size={15} />, color: "text-amber-400" },
  restaurant: { label: "Restaurant", icon: <UtensilsCrossed size={15} />, color: "text-orange-400" },
  show:       { label: "Show / Movie", icon: <Tv size={15} />, color: "text-blue-400" },
  book:       { label: "Book", icon: <BookOpen size={15} />, color: "text-emerald-400" },
  song:       { label: "Song", icon: <Music size={15} />, color: "text-pink-400" },
};

export function DayAddFAB({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("food");

  function close() { setOpen(false); }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-[#F59E0B] hover:bg-[#FBBF24] text-black rounded-full flex items-center justify-center shadow-lg transition-colors"
        aria-label="Add entry"
      >
        <Plus size={22} strokeWidth={2.5} />
      </button>

      {/* Sheet */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={close} />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto">
            <div className="bg-[#111113] rounded-t-2xl border border-[#27272A] border-b-0 px-5 pb-8 pt-4">
              {/* Handle */}
              <div className="flex justify-center mb-4">
                <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-[#FAFAFA]">Add to today</p>
                <button onClick={close} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                  <X size={16} className="text-[#71717A]" />
                </button>
              </div>

              {/* Type selector */}
              <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mb-5 overflow-x-auto">
                {(Object.keys(MODE_META) as Mode[]).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      mode === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                    }`}>
                    {MODE_META[m].icon}{MODE_META[m].label}
                  </button>
                ))}
              </div>

              {/* Form */}
              {mode === "food"       && <FoodEntryComposer date={date} onDone={close} />}
              {mode === "restaurant" && <RestaurantForm date={date} onDone={close} />}
              {mode === "show"       && <ShowForm date={date} onDone={close} />}
              {mode === "book"       && <BookForm date={date} onDone={close} />}
              {mode === "song"       && <SongForm date={date} onDone={close} />}
            </div>
          </div>
        </>
      )}
    </>
  );
}
