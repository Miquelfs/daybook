"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import type { Trip } from "@/lib/api";

function fmtRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = new Date(end + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

export function TripCard({ trip, flag }: { trip: Trip; flag: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [draft, setDraft] = useState(trip.user_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/locations/trips/${trip.start_date}/${trip.end_date}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: draft.trim() || null }),
    }).catch(() => null);
    setSaving(false);
    if (res && res.ok) {
      setName(draft.trim() || trip.auto_name || "Trip");
      setEditing(false);
      router.refresh();
    }
  }

  const go = () => router.push(`/day/${trip.start_date}`);

  if (editing) {
    return (
      <div className="bg-[#0D0D0F] border border-[#F59E0B]/40 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={trip.auto_name ?? "Trip name"}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
          />
          <button onClick={save} disabled={saving} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40"><Check size={16} /></button>
          <button onClick={() => setEditing(false)} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={16} /></button>
        </div>
        <p className="text-[10px] text-[#3F3F46] mt-1">Empty resets to auto name ({trip.auto_name})</p>
      </div>
    );
  }

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-[#3F3F46] transition-colors group">
      <div className="flex items-center justify-between gap-2">
        <button onClick={go} className="text-sm text-[#D4D4D8] group-hover:text-[#FAFAFA] font-medium truncate transition-colors text-left flex-1">
          {flag} {name}
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {trip.max_distance_from_home_km != null && (
            <span className="text-[10px] text-[#3F3F46] tabular-nums">{Math.round(trip.max_distance_from_home_km)} km out</span>
          )}
          <button
            onClick={() => { setDraft(trip.user_name ?? ""); setEditing(true); }}
            className="text-[#3F3F46] hover:text-[#A1A1AA] transition-colors opacity-0 group-hover:opacity-100"
            aria-label="Rename trip"
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>
      <button onClick={go} className="text-xs text-[#52525B] mt-0.5 text-left block w-full">
        {fmtRange(trip.start_date, trip.end_date)}
        {trip.cities.length > 0 && <span className="text-[#3F3F46]"> · {trip.cities.slice(0, 3).join(", ")}</span>}
        {trip.home_at_start && <span className="text-[#3F3F46]"> · from {trip.home_at_start}</span>}
      </button>
    </div>
  );
}
