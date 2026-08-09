"use client";

import { X } from "lucide-react";
import { BookForm } from "@/components/books/BookForm";
import type { Book } from "@/lib/books-api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the sheet edits this book (title + delete button). */
  book?: Book;
  /** Prefill date_finished in create mode. */
  defaultDate?: string;
  /** Called after a delete (edit mode). Defaults to onClose. */
  onDeleted?: () => void;
}

export function AddBookSheet({ isOpen, onClose, book, defaultDate, onDeleted }: Props) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
          <h2 className="text-base font-semibold text-[#FAFAFA]">{book ? "Edit book" : "Add book"}</h2>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* key forces a fresh form when switching between add / different books */}
          <BookForm
            key={book?.id ?? "new"}
            initial={book}
            defaultDate={defaultDate}
            onSaved={onClose}
            onDeleted={book ? (onDeleted ?? onClose) : undefined}
          />
        </div>
      </div>
    </>
  );
}
