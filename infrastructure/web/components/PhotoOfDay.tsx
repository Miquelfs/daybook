"use client";

import { useRef, useState } from "react";
import { Camera, Loader, X } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  date: string;
  initialPhotoUrl: string | null;
  /** Show a Today/Yesterday switch — for the Today page, where a long day
      often rolls past midnight before the photo gets uploaded. */
  allowYesterday?: boolean;
}

// Photos are served through the Next.js proxy (/api/photos/...) so the browser
// always loads them from the same origin — avoids mixed-content and CORS issues.
function toProxyUrl(url: string | null): string | null {
  if (!url) return null;
  // url is either "/photos/2026-05-17.jpg" or "2026-05-17.jpg"
  const filename = url.replace(/^\/photos\//, "").replace(/^.*\//, "");
  return `/api/photos/${filename}`;
}

function dayBefore(date: string): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function PhotoOfDay({ date, initialPhotoUrl, allowYesterday = false }: Props) {
  const [targetDate, setTargetDate] = useState(date);
  const [photoUrl, setPhotoUrl] = useState<string | null>(toProxyUrl(initialPhotoUrl));
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const yesterday = dayBefore(date);

  async function switchTarget(d: string) {
    if (d === targetDate) return;
    setTargetDate(d);
    setError(null);
    if (d === date) {
      setPhotoUrl(toProxyUrl(initialPhotoUrl));
      return;
    }
    setPhotoUrl(null);
    try {
      const other = await api.day(d);
      setPhotoUrl(toProxyUrl(other.photo_url ?? null));
    } catch {
      /* no photo yet — the upload placeholder shows */
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/days/${targetDate}/photo`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload failed ${res.status}${text ? `: ${text}` : ""}`);
      }
      const { photo_url } = await res.json();
      setPhotoUrl(toProxyUrl(photo_url));
    } catch (e) {
      console.error("Photo upload error:", e);
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const targetSwitch = allowYesterday && (
    <div className="flex items-center gap-1">
      {[
        { d: date, label: "Today" },
        { d: yesterday, label: "Yesterday" },
      ].map(({ d, label }) => (
        <button
          key={d}
          type="button"
          onClick={() => switchTarget(d)}
          className={`px-2.5 py-1 rounded-full text-[10px] uppercase tracking-widest border transition-colors ${
            targetDate === d
              ? "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#F59E0B]"
              : "border-[#27272A] text-[#3F3F46] hover:text-[#71717A]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {targetSwitch}

      {photoUrl ? (
        <>
          <div className="relative rounded-xl overflow-hidden border border-[#27272A] cursor-pointer" onClick={() => setExpanded(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={`Photo of ${targetDate}`}
              className="w-full object-cover"
              style={{ maxHeight: 280 }}
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
              className="absolute bottom-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors"
              title="Replace photo"
            >
              <Camera size={14} />
            </button>
          </div>

          {/* Expanded overlay — rendered outside the thumbnail so clicks don't re-trigger setExpanded(true) */}
          {expanded && (
            <div
              className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
              onClick={() => setExpanded(false)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt={`Photo of ${targetDate}`}
                className="max-w-full max-h-[85vh] object-contain rounded-xl"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="absolute top-4 right-4 bg-black/50 hover:bg-black/80 text-white rounded-full p-2 transition-colors"
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              >
                <X size={22} />
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border border-dashed border-[#27272A] rounded-xl px-4 py-6 flex flex-col items-center gap-2 text-[#52525B] hover:border-[#3F3F46] hover:text-[#A1A1AA] transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader size={20} className="animate-spin" /> : <Camera size={20} />}
          <span className="text-sm">
            {uploading ? "Uploading…" : targetDate === date && !allowYesterday && targetDate !== new Date().toISOString().slice(0, 10)
              ? `Add a photo to ${targetDate}`
              : "Add a photo"}
          </span>
        </button>
      )}

      {/* Single shared file input — uploads always target targetDate */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  );
}
