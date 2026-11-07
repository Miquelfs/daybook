"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Star, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { photoUrl } from "@/lib/travel-api";

export interface LightboxPhoto {
  id: number | null;           // null → a day photo (not a moment photo)
  path: string;
  caption: string | null;
  title: string | null;
  date: string;
}

/** Full-screen photos of the whole trip: arrows, swipe, Esc; set any one as the trip's cover. */
export function Lightbox({ photos, start, coverId, onCover, onClose }: {
  photos: LightboxPhoto[];
  start: number;
  coverId: number | null;
  onCover?: (id: number) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const p = photos[i];
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col"
         onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
         onTouchEnd={(e) => {
           if (touch.current == null) return;
           const dx = e.changedTouches[0].clientX - touch.current;
           if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
           touch.current = null;
         }}>
      <div className="flex items-center justify-between px-4 py-3 text-xs text-[#A1A1AA]">
        <span className="tabular-nums">{i + 1} / {photos.length}</span>
        <div className="flex items-center gap-4">
          {p.id != null && onCover && (
            <button onClick={() => onCover(p.id!)}
                    className={`inline-flex items-center gap-1 ${coverId === p.id ? "text-[#F59E0B]" : "hover:text-[#FAFAFA]"}`}>
              <Star size={14} fill={coverId === p.id ? "currentColor" : "none"} /> {coverId === p.id ? "Cover" : "Make cover"}
            </button>
          )}
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative flex items-center justify-center px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(p.path)} alt={p.caption ?? ""} className="max-w-full max-h-full object-contain select-none" />
        {photos.length > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous"
                    className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 items-center justify-center text-white">
              <ChevronLeft size={20} />
            </button>
            <button onClick={() => go(1)} aria-label="Next"
                    className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 items-center justify-center text-white">
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      <div className="px-4 py-4 text-center">
        {p.title && <p className="text-sm text-[#FAFAFA]">{p.title}</p>}
        {p.caption && <p className="text-xs text-[#A1A1AA] mt-0.5">{p.caption}</p>}
        <p className="text-[10px] uppercase tracking-widest text-[#52525B] mt-1">{format(parseISO(p.date), "EEE d MMM yyyy")}</p>
      </div>
    </div>
  );
}
