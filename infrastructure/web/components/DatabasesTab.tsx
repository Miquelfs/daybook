"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

export function DatabasesTab() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative z-30">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-sm px-4 py-2 rounded-full border transition-colors ${
          open
            ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
            : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] hover:border-[#3F3F46]"
        }`}
      >
        Databases {open ? "↑" : "↓"}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-44 bg-[#09090B] border border-[#27272A] rounded-xl overflow-hidden shadow-2xl z-30">
          <Link
            href="/explore/restaurants"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] transition-colors"
          >
            <span>🍽</span> Restaurants
          </Link>
          <div className="border-t border-[#18181B]" />
          <Link
            href="/explore/shows"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] transition-colors"
          >
            <span>🎬</span> Shows & Movies
          </Link>
          <div className="border-t border-[#18181B]" />
          <Link
            href="/explore/books"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] transition-colors"
          >
            <span>📚</span> Books
          </Link>
        </div>
      )}
    </div>
  );
}
