"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { type Book, type BooksStats } from "@/lib/books-api";
import { AddBookSheet } from "@/components/books/AddBookSheet";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span className="text-xs leading-none" title={`${rating}/5`}>
      {"⭐".repeat(rating)}
    </span>
  );
}

function BookCover({ cover_url, title }: { cover_url: string | null; title: string }) {
  if (!cover_url) {
    return (
      <div className="w-12 h-16 rounded bg-[#27272A] flex items-center justify-center shrink-0">
        <span className="text-xl">📖</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cover_url}
      alt={title}
      width={48}
      height={64}
      className="w-12 h-16 object-cover rounded shrink-0 bg-[#27272A]"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
    />
  );
}

interface Props {
  initialBooks: Book[];
  initialStats: BooksStats | null;
}

export function BooksClient({ initialBooks, initialStats: stats }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterGenre, setFilterGenre] = useState<string>("all");

  // ── Filtered book list (both filters applied) ────────────────────────────────
  const filtered = initialBooks.filter((b) => {
    if (filterYear !== "all" && b.date_finished?.slice(0, 4) !== filterYear) return false;
    if (filterGenre !== "all" && b.genre !== filterGenre) return false;
    return true;
  });

  // ── KPIs derived from filtered list ─────────────────────────────────────────
  const filteredBooks = filtered.length;
  const filteredPages = filtered.reduce((sum, b) => sum + (b.pages ?? 0), 0);

  // ── Genre counts scoped to selected year (for genre pills) ───────────────────
  const genreCounts: Record<string, number> = {};
  initialBooks.forEach((b) => {
    if (filterYear !== "all" && b.date_finished?.slice(0, 4) !== filterYear) return;
    if (b.genre) genreCounts[b.genre] = (genreCounts[b.genre] ?? 0) + 1;
  });
  const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).map(([g]) => g);

  // ── Top authors derived from filtered list ───────────────────────────────────
  const authorMap: Record<string, { books: number; ratingSum: number; ratingCount: number }> = {};
  filtered.forEach((b) => {
    if (!authorMap[b.author]) authorMap[b.author] = { books: 0, ratingSum: 0, ratingCount: 0 };
    authorMap[b.author].books++;
    if (b.rating) { authorMap[b.author].ratingSum += b.rating; authorMap[b.author].ratingCount++; }
  });
  const topAuthors = Object.entries(authorMap)
    .map(([author, d]) => ({
      author,
      books: d.books,
      avg_rating: d.ratingCount > 0 ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.books - a.books || (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .slice(0, 5);

  // ── Bar chart: books per year scoped to genre filter ─────────────────────────
  const booksPerYearFiltered: Record<string, number> = {};
  initialBooks.forEach((b) => {
    if (!b.date_finished) return;
    if (filterGenre !== "all" && b.genre !== filterGenre) return;
    const y = b.date_finished.slice(0, 4);
    booksPerYearFiltered[y] = (booksPerYearFiltered[y] ?? 0) + 1;
  });
  const allYears = stats
    ? Object.keys(stats.books_per_year).sort()
    : Array.from(new Set(initialBooks.filter((b) => b.date_finished).map((b) => b.date_finished!.slice(0, 4)))).sort();
  const maxBarCount = Math.max(...allYears.map((y) => booksPerYearFiltered[y] ?? 0), 1);

  // ── Month breakdown for selected year (genre-filtered) ───────────────────────
  const monthData: number[] = Array(12).fill(0);
  if (filterYear !== "all") {
    initialBooks.forEach((b) => {
      if (!b.date_finished) return;
      if (b.date_finished.slice(0, 4) !== filterYear) return;
      if (filterGenre !== "all" && b.genre !== filterGenre) return;
      const m = parseInt(b.date_finished.slice(5, 7), 10) - 1;
      monthData[m]++;
    });
  }
  const maxMonthCount = Math.max(...monthData, 1);

  const thisYear = new Date().getFullYear().toString();
  const nowMonth = new Date().getMonth();

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Books</h1>
        <p className="text-sm text-[#71717A] mt-1">
          {stats?.reading_pace.total_books ?? 0} books read ·{" "}
          {stats ? Object.values(stats.pages_per_year).reduce((a, b) => a + b, 0).toLocaleString() : 0} pages
        </p>
      </div>

      {/* KPI cards — always reflect current filters */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">{filteredBooks}</p>
          <p className="text-xs text-[#52525B] mt-1">
            {filterYear === "all" && filterGenre === "all" ? "total books"
              : filterYear !== "all" && filterGenre === "all" ? `books in ${filterYear}`
              : filterYear === "all" ? `${filterGenre} books`
              : `${filterGenre} in ${filterYear}`}
          </p>
          {filterYear === "all" && filterGenre === "all" && stats?.current_year?.vs_last_year_books_pct != null && (
            <p className={`text-xs mt-1 ${stats.current_year.vs_last_year_books_pct >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {stats.current_year.vs_last_year_books_pct >= 0 ? "+" : ""}
              {stats.current_year.vs_last_year_books_pct}% {stats.current_year.note}
            </p>
          )}
        </div>
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">
            {filteredPages > 0 ? (filteredPages / 1000).toFixed(1) + "k" : "0"}
          </p>
          <p className="text-xs text-[#52525B] mt-1">
            {filterYear === "all" && filterGenre === "all" ? "total pages" : "pages"}
          </p>
          {filterYear === "all" && filterGenre === "all" && stats?.current_year?.vs_last_year_pages_pct != null && (
            <p className={`text-xs mt-1 ${stats.current_year.vs_last_year_pages_pct >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              {stats.current_year.vs_last_year_pages_pct >= 0 ? "+" : ""}
              {stats.current_year.vs_last_year_pages_pct}% {stats.current_year.note}
            </p>
          )}
        </div>
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
          <p className="text-2xl font-bold text-[#FAFAFA]">{stats?.reading_pace.monthly_streak ?? 0}</p>
          <p className="text-xs text-[#52525B] mt-1">month streak</p>
          {stats?.reading_pace.avg_days_between_books !== null && (
            <p className="text-xs text-[#71717A] mt-1">
              avg {stats?.reading_pace.avg_days_between_books}d/book
            </p>
          )}
        </div>
      </div>

      {/* ── Year bar chart (counts respect genre filter) ── */}
      <div className="mb-5">
        <div className="flex items-end gap-1.5 mb-1" style={{ height: "56px" }}>
          {/* "All" column */}
          <button
            onClick={() => { setFilterYear("all"); setFilterGenre("all"); }}
            className={`flex flex-col items-center justify-end flex-none w-10 h-full transition-opacity ${filterYear === "all" ? "opacity-100" : "opacity-35 hover:opacity-60"}`}
          >
            <div className={`w-full rounded-sm ${filterYear === "all" ? "bg-[#F59E0B]" : "bg-[#27272A]"}`} style={{ height: "100%" }} />
          </button>

          {allYears.map((year) => {
            const count = booksPerYearFiltered[year] ?? 0;
            const pct = (count / maxBarCount) * 100;
            const isSelected = filterYear === year;
            const isThisYear = year === thisYear;
            return (
              <button
                key={year}
                onClick={() => { setFilterYear(isSelected ? "all" : year); setFilterGenre("all"); }}
                className={`flex flex-col items-center justify-end gap-1 flex-1 h-full transition-opacity ${isSelected || filterYear === "all" ? "opacity-100" : "opacity-35 hover:opacity-60"}`}
                title={`${year}: ${count} books`}
              >
                <span className="text-[9px] text-[#52525B] tabular-nums">{count > 0 ? count : ""}</span>
                <div
                  className={`w-full rounded-sm transition-colors ${isSelected ? "bg-[#F59E0B]" : isThisYear ? "bg-[#A16207]" : "bg-[#27272A]"}`}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
              </button>
            );
          })}
        </div>

        {/* Full 4-digit year labels */}
        <div className="flex items-center gap-1.5">
          <div className="flex-none w-10 text-center">
            <span className={`text-[9px] ${filterYear === "all" ? "text-[#F59E0B] font-medium" : "text-[#3F3F46]"}`}>all</span>
          </div>
          {allYears.map((year) => (
            <div key={year} className="flex-1 text-center overflow-hidden">
              <span className={`text-[9px] ${filterYear === year ? "text-[#F59E0B] font-medium" : "text-[#3F3F46]"}`}>
                {year}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Month breakdown (when a year is selected) ── */}
      {filterYear !== "all" && (
        <div className="mb-5">
          <div className="flex items-end gap-1" style={{ height: "40px" }}>
            {monthData.map((count, i) => {
              const pct = (count / maxMonthCount) * 100;
              const isPast = filterYear < thisYear || (filterYear === thisYear && i <= nowMonth);
              return (
                <div key={i} className="flex flex-col items-center gap-0.5 flex-1 h-full justify-end">
                  {count > 0 && <span className="text-[8px] text-[#52525B]">{count}</span>}
                  <div
                    className={`w-full rounded-sm ${count > 0 ? "bg-[#F59E0B]/70" : isPast ? "bg-[#1C1C1F]" : "bg-[#18181B]"}`}
                    style={{ height: count > 0 ? `${Math.max(pct, 10)}%` : "8%" }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1 mt-1">
            {MONTHS.map((m) => (
              <div key={m} className="flex-1 text-center">
                <span className="text-[8px] text-[#3F3F46]">{m[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Genre filter pills ── */}
      {genres.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none mb-5">
          <button
            onClick={() => setFilterGenre("all")}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors ${
              filterGenre === "all"
                ? "bg-[#F59E0B]/20 text-[#F59E0B] font-medium border border-[#F59E0B]/30"
                : "border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            All genres
          </button>
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setFilterGenre(filterGenre === g ? "all" : g)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap shrink-0 transition-colors ${
                filterGenre === g
                  ? "bg-[#F59E0B]/20 text-[#F59E0B] font-medium border border-[#F59E0B]/30"
                  : "border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              {g} <span className={filterGenre === g ? "text-[#F59E0B]/70" : "text-[#3F3F46]"}>{genreCounts[g]}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Top authors (from filtered list) ── */}
      {topAuthors.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Top authors</h2>
          <div className="flex flex-col gap-1">
            {topAuthors.map((a, i) => (
              <div key={a.author} className="flex items-center gap-2">
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right">{i + 1}</span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">{a.author}</span>
                <span className="text-xs text-[#52525B]">{a.books} {a.books === 1 ? "book" : "books"}</span>
                {a.avg_rating !== null && (
                  <span className="text-xs text-[#F59E0B]">★ {a.avg_rating}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Book count ── */}
      <p className="text-xs text-[#52525B] mb-3">
        {filteredBooks} {filteredBooks === 1 ? "book" : "books"}
        {filterYear !== "all" || filterGenre !== "all" ? " · filtered" : ""}
      </p>

      {/* ── Book list ── */}
      <div className="flex flex-col divide-y divide-[#18181B]">
        {filtered.map((book) => (
          <Link
            key={book.id}
            href={`/explore/books/${book.id}`}
            className="flex items-start gap-4 py-4 hover:bg-[#0C0C0E] -mx-2 px-2 rounded-lg transition-colors"
          >
            <BookCover cover_url={book.cover_url} title={book.title} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#FAFAFA] leading-tight truncate">{book.title}</p>
              <p className="text-xs text-[#71717A] mt-0.5">{book.author}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {book.genre && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#18181B] border border-[#27272A] text-[#71717A]">
                    {book.genre}
                  </span>
                )}
                {book.pages && (
                  <span className="text-[10px] text-[#3F3F46]">{book.pages} pp</span>
                )}
                {book.date_finished && (
                  <span className="text-[10px] text-[#3F3F46]">
                    {book.date_finished.slice(0, 7)}
                  </span>
                )}
              </div>
              {book.notes && (
                <p className="text-xs text-[#52525B] mt-1 italic truncate">"{book.notes}"</p>
              )}
            </div>
            <div className="shrink-0 pt-1">
              <StarRating rating={book.rating} />
            </div>
          </Link>
        ))}
      </div>

      {filteredBooks === 0 && (
        <p className="text-sm text-[#52525B] text-center py-12">No books found.</p>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-[#F59E0B] text-[#09090B] flex items-center justify-center shadow-lg hover:bg-[#FCD34D] transition-colors z-30"
        aria-label="Add book"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      <AddBookSheet isOpen={showAdd} onClose={() => setShowAdd(false)} />
    </>
  );
}
