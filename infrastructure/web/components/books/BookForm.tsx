"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader, Trash2 } from "lucide-react";
import { booksApi, type Book, type BookIn } from "@/lib/books-api";

const GENRES = [
  "Policíaca", "Acció", "Misteri", "Fantasia", "Humor",
  "Drama", "Clàssic", "Juvenil", "Creixement Personal",
  "Economia", "Històrica",
];

const LANGUAGES = ["Català", "Castellà", "English"];
const OWNERSHIP = [
  { value: "own", label: "Propi" },
  { value: "kindle", label: "Kindle" },
  { value: "library", label: "Biblioteca" },
];

const INPUT =
  "w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]";
const LABEL =
  "text-xs text-[#52525B] uppercase tracking-widest mb-2 block";

interface Props {
  /** When provided, the form edits this book (and shows a delete button). */
  initial?: Book;
  /** Prefills `date_finished` in create mode (e.g. the day being viewed). */
  defaultDate?: string;
  onSaved: (book: Book) => void;
  onDeleted?: () => void;
}

export function BookForm({ initial, defaultDate, onSaved, onDeleted }: Props) {
  const qc = useQueryClient();
  const uid = useId();
  const isEdit = !!initial;

  // Known authors / locations / genres for autocomplete.
  const { data: facets } = useQuery({
    queryKey: ["book-facets"],
    queryFn: () => booksApi.facets(),
    staleTime: 5 * 60 * 1000,
  });

  const [title, setTitle]       = useState(initial?.title ?? "");
  const [author, setAuthor]     = useState(initial?.author ?? "");
  const [dateFinished, setDateFinished] = useState(
    initial?.date_finished ?? defaultDate ?? new Date().toISOString().slice(0, 10),
  );
  const [genre, setGenre]         = useState(initial?.genre ?? GENRES[0]);
  const [language, setLanguage]   = useState(initial?.language ?? LANGUAGES[1]);
  const [ownership, setOwnership] = useState(initial?.ownership ?? OWNERSHIP[0].value);
  const [pages, setPages]         = useState(initial?.pages != null ? String(initial.pages) : "");
  const [rating, setRating]       = useState<number>(initial?.rating ?? 0);
  const [location, setLocation]   = useState(initial?.location ?? "");
  const [notes, setNotes]         = useState(initial?.notes ?? "");
  const [giftFrom, setGiftFrom]   = useState(initial?.gift_from ?? "");

  const genreOptions = Array.from(new Set([...GENRES, ...(facets?.genres ?? [])]));

  const buildBody = (): BookIn => ({
    title: title.trim(),
    author: author.trim(),
    date_finished: dateFinished || undefined,
    genre: genre || undefined,
    language: language || undefined,
    ownership: ownership || undefined,
    pages: pages ? parseInt(pages) : undefined,
    rating: rating > 0 ? rating : undefined,
    location: location.trim() || undefined,
    notes: notes.trim() || undefined,
    gift_from: giftFrom.trim() || undefined,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["books"] });
    qc.invalidateQueries({ queryKey: ["book-facets"] });
    if (dateFinished) qc.invalidateQueries({ queryKey: ["day-books", dateFinished] });
    if (initial?.date_finished) qc.invalidateQueries({ queryKey: ["day-books", initial.date_finished] });
  };

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () =>
      isEdit ? booksApi.update(initial!.id, buildBody()) : booksApi.create(buildBody()),
    onSuccess: (book) => { invalidate(); onSaved(book); },
  });

  const { mutate: remove, isPending: isDeleting } = useMutation({
    mutationFn: () => booksApi.delete(initial!.id),
    onSuccess: () => { invalidate(); onDeleted?.(); },
  });

  const busy = isPending || isDeleting;
  const canSave = !busy && title.trim().length > 0 && author.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Title */}
      <div>
        <label className={LABEL}>Title</label>
        <input
          type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Book title" className={INPUT}
        />
      </div>

      {/* Author — autocomplete against authors already in the log */}
      <div>
        <label className={LABEL}>Author</label>
        <input
          type="text" value={author} onChange={(e) => setAuthor(e.target.value)}
          placeholder="Author name" list={`${uid}-authors`} autoComplete="off"
          className={INPUT}
        />
        <datalist id={`${uid}-authors`}>
          {(facets?.authors ?? []).map((a) => <option key={a} value={a} />)}
        </datalist>
        {author.trim() &&
          facets?.authors &&
          !facets.authors.some((a) => a.toLowerCase() === author.trim().toLowerCase()) && (
            <p className="text-[11px] text-[#71717A] mt-1.5">New author — will be added to the list</p>
          )}
      </div>

      {/* Rating stars */}
      <div>
        <label className={LABEL}>Rating</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n} type="button"
              onClick={() => setRating(rating === n ? 0 : n)}
              className={`text-2xl transition-opacity ${n <= rating ? "opacity-100" : "opacity-25"}`}
            >⭐</button>
          ))}
        </div>
      </div>

      {/* Genre */}
      <div>
        <label className={LABEL}>Genre</label>
        <div className="flex flex-wrap gap-2">
          {genreOptions.map((g) => (
            <button
              key={g} type="button" onClick={() => setGenre(g)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                genre === g
                  ? "bg-[#F59E0B] text-[#09090B]"
                  : "bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]"
              }`}
            >{g}</button>
          ))}
        </div>
      </div>

      {/* Language + Ownership row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Language</label>
          <div className="flex flex-col gap-1.5">
            {LANGUAGES.map((l) => (
              <button
                key={l} type="button" onClick={() => setLanguage(l)}
                className={`px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                  language === l ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"
                }`}
              >{l}</button>
            ))}
          </div>
        </div>
        <div>
          <label className={LABEL}>Format</label>
          <div className="flex flex-col gap-1.5">
            {OWNERSHIP.map((o) => (
              <button
                key={o.value} type="button" onClick={() => setOwnership(o.value)}
                className={`px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                  ownership === o.value ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"
                }`}
              >{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Pages + Date row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Pages</label>
          <input
            type="number" value={pages} onChange={(e) => setPages(e.target.value)}
            placeholder="0" inputMode="numeric" className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>Date finished</label>
          <input
            type="date" value={dateFinished} onChange={(e) => setDateFinished(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Location — autocomplete against places already logged */}
      <div>
        <label className={LABEL}>Where read (optional)</label>
        <input
          type="text" value={location} onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Barcelona, on holiday…" list={`${uid}-locations`} autoComplete="off"
          className={INPUT}
        />
        <datalist id={`${uid}-locations`}>
          {(facets?.locations ?? []).map((l) => <option key={l} value={l} />)}
        </datalist>
      </div>

      {/* Gift from */}
      <div>
        <label className={LABEL}>Gift from (optional)</label>
        <input
          type="text" value={giftFrom} onChange={(e) => setGiftFrom(e.target.value)}
          placeholder="Name of person who gave it to you" className={INPUT}
        />
      </div>

      {/* Notes */}
      <div>
        <label className={LABEL}>Notes</label>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Thoughts, recommendations…"
          className={`${INPUT} resize-none`}
        />
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] text-center">
          {error instanceof Error ? error.message : "Save failed — check connection"}
        </p>
      )}

      <button
        type="button" onClick={() => save()} disabled={!canSave}
        className="w-full py-3.5 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {isPending ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
        {isEdit ? "Save changes" : "Save book"}
      </button>

      {isEdit && onDeleted && (
        <button
          type="button"
          onClick={() => { if (confirm(`Delete "${initial!.title}"? This can't be undone.`)) remove(); }}
          disabled={busy}
          className="w-full py-3 rounded-xl border border-[#3F1D1D] text-[#EF4444] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#1F1315] disabled:opacity-40 transition-colors"
        >
          {isDeleting ? <Loader size={16} className="animate-spin" /> : <Trash2 size={16} />}
          Delete book
        </button>
      )}
    </div>
  );
}
