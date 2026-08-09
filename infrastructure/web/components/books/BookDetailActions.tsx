"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { AddBookSheet } from "@/components/books/AddBookSheet";
import type { Book } from "@/lib/books-api";

export function BookDetailActions({ book }: { book: Book }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors"
      >
        <Pencil size={13} /> Edit
      </button>

      <AddBookSheet
        isOpen={editing}
        book={book}
        onClose={() => { setEditing(false); router.refresh(); }}
        onDeleted={() => router.push("/explore/books")}
      />
    </>
  );
}
