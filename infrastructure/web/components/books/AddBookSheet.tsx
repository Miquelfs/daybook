"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Check, Loader } from "lucide-react";
import { booksApi, type BookIn } from "@/lib/books-api";

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

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AddBookSheet({ isOpen, onClose }: Props) {
  const qc = useQueryClient();

  const [title, setTitle]     = useState("");
  const [author, setAuthor]   = useState("");
  const [dateFinished, setDateFinished] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [genre, setGenre]         = useState(GENRES[0]);
  const [language, setLanguage]   = useState(LANGUAGES[1]);
  const [ownership, setOwnership] = useState(OWNERSHIP[0].value);
  const [pages, setPages]         = useState("");
  const [rating, setRating]       = useState<number>(0);
  const [notes, setNotes]         = useState("");
  const [giftFrom, setGiftFrom]   = useState("");

  useEffect(() => {
    if (isOpen) {
      setTitle(""); setAuthor(""); setNotes(""); setGiftFrom(""); setPages(""); setRating(0);
      setDateFinished(new Date().toISOString().slice(0, 10));
      setGenre(GENRES[0]); setLanguage(LANGUAGES[1]); setOwnership(OWNERSHIP[0].value);
    }
  }, [isOpen]);

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () => {
      const body: BookIn = {
        title: title.trim(),
        author: author.trim(),
        date_finished: dateFinished || undefined,
        genre: genre || undefined,
        language: language || undefined,
        ownership: ownership || undefined,
        pages: pages ? parseInt(pages) : undefined,
        rating: rating > 0 ? rating : undefined,
        notes: notes.trim() || undefined,
        gift_from: giftFrom.trim() || undefined,
      };
      return booksApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["books"] });
      onClose();
    },
  });

  const canSave = !isPending && title.trim().length > 0 && author.trim().length > 0;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
          <h2 className="text-base font-semibold text-[#FAFAFA]">Add book</h2>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Title */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Book title"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Author */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author name"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Rating stars */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? 0 : n)}
                  className={`text-2xl transition-opacity ${n <= rating ? "opacity-100" : "opacity-25"}`}
                >
                  ⭐
                </button>
              ))}
            </div>
          </div>

          {/* Genre */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Genre</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGenre(g)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    genre === g
                      ? "bg-[#F59E0B] text-[#09090B]"
                      : "bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Language + Ownership row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Language</label>
              <div className="flex flex-col gap-1.5">
                {LANGUAGES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLanguage(l)}
                    className={`px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                      language === l
                        ? "bg-[#27272A] text-[#FAFAFA]"
                        : "text-[#71717A] hover:text-[#A1A1AA]"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Format</label>
              <div className="flex flex-col gap-1.5">
                {OWNERSHIP.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOwnership(o.value)}
                    className={`px-3 py-2 rounded-xl text-sm text-left transition-colors ${
                      ownership === o.value
                        ? "bg-[#27272A] text-[#FAFAFA]"
                        : "text-[#71717A] hover:text-[#A1A1AA]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Pages + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Pages</label>
              <input
                type="number"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                placeholder="0"
                inputMode="numeric"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
              />
            </div>
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Date finished</label>
              <input
                type="date"
                value={dateFinished}
                onChange={(e) => setDateFinished(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] [color-scheme:dark]"
              />
            </div>
          </div>

          {/* Gift from */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Gift from (optional)</label>
            <input
              type="text"
              value={giftFrom}
              onChange={(e) => setGiftFrom(e.target.value)}
              placeholder="Name of person who gave it to you"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Thoughts, recommendations…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B] resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-[#EF4444] text-center">
              {error instanceof Error ? error.message : "Save failed — check connection"}
            </p>
          )}

          <button
            type="button"
            onClick={() => save()}
            disabled={!canSave}
            className="w-full py-3.5 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isPending ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
            Save book
          </button>
        </div>
      </div>
    </>
  );
}
