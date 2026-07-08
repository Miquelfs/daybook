"use client";

import { useRef, useState } from "react";
import { Camera, Loader, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  date: string;
  initialPhotoUrl: string | null;
}

// Photos are served through the Next.js proxy (/api/photos/...) so the browser
// always loads them from the same origin — avoids mixed-content and CORS issues.
function toProxyUrl(url: string | null): string | null {
  if (!url) return null;
  // url is either "/photos/2026-05-17.jpg" or "2026-05-17.jpg"
  const filename = url.replace(/^\/photos\//, "").replace(/^.*\//, "");
  return `/api/photos/${filename}`;
}

export function PhotoOfDay({ date, initialPhotoUrl }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(toProxyUrl(initialPhotoUrl));
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/days/${date}/photo`, {
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

  async function handleDelete() {
    if (!confirm("Delete this photo? This can't be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deletePhoto(date);
      setPhotoUrl(null);
      setExpanded(false);
    } catch (e) {
      console.error("Photo delete error:", e);
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {photoUrl ? (
        <>
          <div className="relative rounded-xl overflow-hidden border border-[#27272A] cursor-pointer" onClick={() => setExpanded(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={`Photo of ${date}`}
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
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              disabled={deleting}
              className="absolute bottom-2 right-11 bg-black/50 hover:bg-red-900/80 text-white rounded-full p-1.5 transition-colors disabled:opacity-50"
              title="Delete photo"
            >
              <Trash2 size={14} />
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
                alt={`Photo of ${date}`}
                className="max-w-full max-h-[85vh] object-contain rounded-xl"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="absolute top-4 right-16 bg-black/50 hover:bg-red-900/80 text-white rounded-full p-2 transition-colors disabled:opacity-50"
                disabled={deleting}
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
              >
                <Trash2 size={22} />
              </button>
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
          <span className="text-sm">{uploading ? "Uploading…" : "Add a photo"}</span>
        </button>
      )}

      {/* Single shared file input */}
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
