import Link from "next/link";
import { Globe, PersonStanding, Database } from "lucide-react";
import { api } from "@/lib/api";
import { booksApi } from "@/lib/books-api";
import { showsApi } from "@/lib/shows-api";

export default async function DatabasesPage() {
  const [restaurantStats, bookStats, showStats] = await Promise.all([
    api.restaurantStats().catch(() => null),
    booksApi.stats().catch(() => null),
    showsApi.stats().catch(() => null),
  ]);

  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block"
        >
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Restaurants, books & shows</p>

        {/* Section tabs */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <Link href="/explore" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Globe size={13} />Travel
          </Link>
          <Link href="/explore/movement" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <PersonStanding size={13} />Movement
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Database size={13} />Databases
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Link
          href="/explore/restaurants"
          className="flex items-center gap-4 bg-[#18181B] border border-[#27272A] rounded-xl px-5 py-4 hover:border-[#3F3F46] transition-colors"
        >
          <span className="text-3xl">🍽</span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-[#FAFAFA]">Restaurants</p>
            <p className="text-xs text-[#52525B] mt-0.5">
              {restaurantStats
                ? `${restaurantStats.total} visited · avg ${restaurantStats.avg_rating_mf ?? "—"}/10`
                : "Dining log with ratings"}
            </p>
          </div>
          <span className="text-[#52525B] text-sm">→</span>
        </Link>

        <Link
          href="/explore/books"
          className="flex items-center gap-4 bg-[#18181B] border border-[#27272A] rounded-xl px-5 py-4 hover:border-[#3F3F46] transition-colors"
        >
          <span className="text-3xl">📚</span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-[#FAFAFA]">Books</p>
            <p className="text-xs text-[#52525B] mt-0.5">
              {bookStats
                ? `${bookStats.current_year.books} read this year · ${Object.values(bookStats.books_per_year as Record<string,number>).reduce((a, b) => a + b, 0)} total`
                : "Reading log"}
            </p>
          </div>
          <span className="text-[#52525B] text-sm">→</span>
        </Link>

        <Link
          href="/explore/shows"
          className="flex items-center gap-4 bg-[#18181B] border border-[#27272A] rounded-xl px-5 py-4 hover:border-[#3F3F46] transition-colors"
        >
          <span className="text-3xl">🎬</span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-[#FAFAFA]">Shows & Movies</p>
            <p className="text-xs text-[#52525B] mt-0.5">
              {showStats
                ? `${showStats.total} watched · avg ${showStats.avg_rating_mf ?? "—"}/10`
                : "Watching log with ratings"}
            </p>
          </div>
          <span className="text-[#52525B] text-sm">→</span>
        </Link>
      </div>
    </main>
  );
}
