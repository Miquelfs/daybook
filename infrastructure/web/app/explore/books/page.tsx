import Link from "next/link";
import { booksApi } from "@/lib/books-api";
import { BooksClient } from "./BooksClient";

export default async function BooksPage() {
  const [stats, books] = await Promise.all([
    booksApi.stats().catch(() => null),
    booksApi.list().catch(() => []),
  ]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <Link
        href="/explore"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Explore
      </Link>
      <BooksClient initialBooks={books} initialStats={stats} />
    </main>
  );
}
