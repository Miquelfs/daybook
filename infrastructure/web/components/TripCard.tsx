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

export function TripCard({ trip, flag }: { trip: Trip; flag?: React.ReactNode }) {
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

  const start = new Date(trip.start_date + "T12:00:00");
  const far = trip.max_distance_from_home_km;
  return (
    <div
      onClick={go}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") go(); }}
      className="relative bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 hover:border-[#3F3F46] transition-colors group flex gap-3.5 cursor-pointer"
    >
      {/* Date tile — the trip's first day, like a calendar leaf */}
      <div className="shrink-0 w-12 rounded-xl overflow-hidden border border-[#27272A] text-center self-start">
        <p className="text-[9px] font-semibold uppercase tracking-widest py-0.5 bg-[#F59E0B]/15 text-[#F59E0B]">
          {start.toLocaleDateString("en-GB", { month: "short" })}
        </p>
        <p className="text-lg font-semibold tabular-nums leading-tight py-1">{start.getDate()}</p>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[15px] text-[#FAFAFA] font-semibold leading-snug line-clamp-2 flex-1 min-w-0">
            {flag && <span className="mr-1.5 align-middle">{flag}</span>}{name}
          </p>
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
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
        <p className="text-xs text-[#71717A] tabular-nums mt-0.5">{fmtRange(trip.start_date, trip.return_date ?? trip.end_date)}</p>

        {/* The trip in three numbers */}
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#18181B] text-[#D4D4D8] tabular-nums">
            {trip.n_nights} night{trip.n_nights === 1 ? "" : "s"}
          </span>
          {far != null && far >= 1 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#18181B] text-[#A1A1AA] tabular-nums">
              {far >= 1000 ? `${(far / 1000).toFixed(1)}k` : Math.round(far)} km away
            </span>
          )}
          {trip.passenger_flight_count > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-500 tabular-nums">
              ✈ {trip.passenger_flight_count} flight{trip.passenger_flight_count > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {trip.cities.length > 0 && (
          <p className="text-xs text-[#52525B] mt-2 truncate">
            {trip.cities.slice(0, 4).map((city, i) => (
              <Fragment key={city}>
                {i > 0 && " · "}
                <Link
                  href={`/explore/place/${encodeURIComponent(city)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-[#A1A1AA] hover:underline transition-colors"
                >
                  {city}
                </Link>
              </Fragment>
            ))}
            {trip.cities.length > 4 && ` +${trip.cities.length - 4}`}
          </p>
        )}
      </div>

      {trip.cover_photo_path && (
        <div className="shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-[#27272A] self-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoProxy(trip.cover_photo_path)} alt="" className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  );
}
