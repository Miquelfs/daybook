import Link from "next/link";
import { notFound } from "next/navigation";
import { booksApi } from "@/lib/books-api";

interface Props {
  params: Promise<{ id: string }>;
}

const OWNERSHIP_LABEL: Record<string, string> = {
  own: "Propi",
  kindle: "Kindle",
  library: "Biblioteca",
};

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const book = await booksApi.get(parseInt(id)).catch(() => null);
  if (!book) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/explore/books"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-6 inline-block"
      >
        ← Books
      </Link>

      <div className="flex gap-6 mb-8">
        {/* Cover */}
        <div className="shrink-0">
          {book.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_url}
              alt={book.title}
              width={96}
              height={128}
              className="w-24 h-32 object-cover rounded-lg bg-[#27272A]"
            />
          ) : (
            <div className="w-24 h-32 rounded-lg bg-[#27272A] flex items-center justify-center">
              <span className="text-4xl">📖</span>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-[#FAFAFA] leading-tight">{book.title}</h1>
          <p className="text-sm text-[#71717A] mt-1">{book.author}</p>

          {book.rating && (
            <p className="text-lg mt-2" title={`${book.rating}/5`}>
              {"⭐".repeat(book.rating)}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {book.genre && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#18181B] border border-[#27272A] text-[#A1A1AA]">
                {book.genre}
              </span>
            )}
            {book.language && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#18181B] border border-[#27272A] text-[#71717A]">
                {book.language}
              </span>
            )}
            {book.ownership && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#18181B] border border-[#27272A] text-[#71717A]">
                {OWNERSHIP_LABEL[book.ownership] ?? book.ownership}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {book.date_finished && (
          <div className="bg-[#18181B] rounded-xl p-4">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Finished</p>
            <p className="text-sm text-[#D4D4D8]">{book.date_finished}</p>
          </div>
        )}
        {book.pages && (
          <div className="bg-[#18181B] rounded-xl p-4">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pages</p>
            <p className="text-sm text-[#D4D4D8]">{book.pages.toLocaleString()}</p>
          </div>
        )}
        {book.location && (
          <div className="bg-[#18181B] rounded-xl p-4">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Where read</p>
            <p className="text-sm text-[#D4D4D8]">{book.location}</p>
          </div>
        )}
        {book.gift_from && (
          <div className="bg-[#18181B] rounded-xl p-4">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Gift from</p>
            <p className="text-sm text-[#D4D4D8]">{book.gift_from}</p>
          </div>
        )}
      </div>

      {/* Notes */}
      {book.notes && (
        <div className="bg-[#18181B] rounded-xl p-5">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Notes</p>
          <p className="text-sm text-[#A1A1AA] italic leading-relaxed">"{book.notes}"</p>
        </div>
      )}
    </main>
  );
}
