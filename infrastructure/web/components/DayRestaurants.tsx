"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { Restaurant } from "@/lib/api";
import { SectionLabel } from "@/components/MorningBrief";
import { X } from "lucide-react";

function AddRestaurantSheet({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          city: city.trim() || null,
          cuisine: cuisine.trim() || null,
          rating_mf: rating,
          date: date,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail ?? "Failed"); }
      onSaved(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto -mt-2 mb-2" />
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#FAFAFA]">Log a restaurant</p>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={16} /></button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Name *</label>
          <input
            type="text" placeholder="Restaurant name" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-[#71717A] uppercase tracking-wider">City</label>
            <input
              type="text" placeholder="e.g. Barcelona" value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-[#71717A] uppercase tracking-wider">Cuisine</label>
            <input
              type="text" placeholder="e.g. Japanese" value={cuisine}
              onChange={(e) => setCuisine(e.target.value)}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-[#71717A] uppercase tracking-wider">Rating (1–10)</label>
          <div className="flex gap-1.5 flex-wrap">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? null : n)}
                className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                  rating === n ? "bg-[#F59E0B] text-[#09090B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
                }`}
              >{n}</button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[#F87171]">{error}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-[#FAFAFA] text-[#09090B] text-sm font-semibold rounded-xl hover:bg-[#E4E4E7] disabled:opacity-50">
          {saving ? "Saving…" : "Save restaurant"}
        </button>
      </div>
    </div>
  );
}

export function DayRestaurants({ date }: { date: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const queryClient = useQueryClient();

  const { data: restaurants = [] } = useQuery<Restaurant[]>({
    queryKey: ["day-restaurants", date],
    queryFn: async () => {
      const res = await fetch(`/api/restaurants?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["day-restaurants", date] });
  }

  if (restaurants.length === 0 && !showAdd) return null;

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionLabel>Dining</SectionLabel>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs px-2.5 py-1 bg-[#18181B] border border-[#27272A] rounded-lg text-[#71717A] hover:text-[#A1A1AA] hover:bg-[#27272A] transition-colors"
          >+ Add</button>
        </div>

        {restaurants.length === 0 ? (
          <p className="text-xs text-[#3F3F46] py-2">Nothing logged yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {restaurants.map((r) => (
              <Link
                key={r.id}
                href={`/explore/restaurants?id=${r.id}`}
                className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors"
              >
                <span className="text-xl">🍽</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA] truncate">{r.name}</p>
                  <p className="text-xs text-[#52525B]">
                    {[r.cuisine, r.city].filter(Boolean).join(" · ")}
                    {r.notes && <span className="italic"> · {r.notes}</span>}
                  </p>
                </div>
                {r.google_maps_url && (
                  <a
                    href={r.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm shrink-0"
                    title="Open in Maps"
                  >📍</a>
                )}
                {r.rating_mf != null && (
                  <span className="text-sm font-semibold text-[#F59E0B] tabular-nums shrink-0">{r.rating_mf}/10</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <AddRestaurantSheet date={date} onClose={() => setShowAdd(false)} onSaved={onSaved} />
      )}
    </>
  );
}
