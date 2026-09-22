"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Check, X, Trash2 } from "lucide-react";
import type { Trip } from "@/lib/api";

function fmtRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = new Date(end + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

function photoProxy(path: string): string {
  return `/api/photos/${path.split("/").pop()}`;
}

export function TripCard({ trip, flag }: { trip: Trip; flag: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [draft, setDraft] = useState(trip.user_name ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    const res = await fetch(`/api/locations/trips/${trip.start_date}/${trip.end_date}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res && res.ok) {
      router.refresh();
    } else {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

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

  const go = () => router.push(`/explore/trip/${trip.start_date}/${trip.end_date}`);

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
    <div
      onClick={go}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") go(); }}
      className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 hover:border-[#3F3F46] hover:bg-[#111113] transition-colors group flex items-center gap-3 cursor-pointer"
    >
      {trip.cover_photo_path && (
        <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-[#27272A]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoProxy(trip.cover_photo_path)} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[#D4D4D8] group-hover:text-[#FAFAFA] font-medium truncate transition-colors flex-1">
            {flag} {name}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {trip.passenger_flight_count > 0 && (
              <span className="text-[10px] text-sky-400 tabular-nums">
                ✈ {trip.passenger_flight_count} flight{trip.passenger_flight_count > 1 ? "s" : ""}
              </span>
            )}
            {trip.max_distance_from_home_km != null && (
              <span className="text-[10px] text-[#3F3F46] tabular-nums">{Math.round(trip.max_distance_from_home_km)} km out</span>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] text-[#71717A]">Delete?</span>
                <button onClick={remove} disabled={deleting} className="text-red-400 hover:text-red-300 disabled:opacity-40" aria-label="Confirm delete"><Check size={13} /></button>
                <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="text-[#52525B] hover:text-[#A1A1AA]" aria-label="Cancel delete"><X size={13} /></button>
              </div>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setDraft(trip.user_name ?? ""); setEditing(true); }}
                  className="text-[#3F3F46] hover:text-[#A1A1AA] transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label="Rename trip"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="text-[#3F3F46] hover:text-red-400 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  aria-label="Delete trip"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="text-xs text-[#52525B] mt-0.5 flex flex-wrap items-baseline gap-x-1">
          <span>
            {fmtRange(trip.start_date, trip.return_date ?? trip.end_date)}
          </span>
          {trip.cities.length > 0 && (
            <span className="text-[#3F3F46]">
              {" "}·{" "}
              {trip.cities.slice(0, 3).map((city, i) => (
                <Fragment key={city}>
                  {i > 0 && ", "}
                  <Link
                    href={`/explore/place/${encodeURIComponent(city)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-[#A1A1AA] hover:underline transition-colors"
                  >
                    {city}
                  </Link>
                </Fragment>
              ))}
            </span>
          )}
          {trip.home_at_start && <span className="text-[#3F3F46]"> · from {trip.home_at_start}</span>}
        </div>
      </div>
    </div>
  );
}
