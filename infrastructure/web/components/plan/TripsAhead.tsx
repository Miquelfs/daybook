"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Plane, Plus } from "lucide-react";
import { ContactsPicker } from "@/components/ContactsPicker";
import type { Contact } from "@/lib/api";
import { plansApi, PLAN_KEYS, type PlannedTrip } from "@/lib/plans-api";
import { Avatar } from "./Avatar";
import { Sheet, Field, inputCls } from "./Sheet";
import { Block, Panel } from "./ui";

/** Just enough to plan a trip here: name, where, when, who. Not a travel planner. */
export function PlannedTripSheet({ trip, defaultStart, onClose }: {
  trip?: PlannedTrip;
  defaultStart?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: trip?.name ?? "",
    destination: trip?.destination ?? "",
    start_date: trip?.start_date ?? defaultStart ?? "",
    end_date: trip?.end_date ?? defaultStart ?? "",
    notes: trip?.notes ?? "",
  });
  const [people, setPeople] = useState<Contact[]>((trip?.with ?? []) as Contact[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const body = {
    name: f.name.trim(), destination: f.destination.trim() || null,
    start_date: f.start_date, end_date: f.end_date || f.start_date,
    notes: f.notes.trim() || null, contact_ids: people.map((p) => p.id),
  };
  const valid = f.name.trim() && f.start_date && (!f.end_date || f.end_date >= f.start_date);

  return (
    <Sheet title={trip ? "Edit trip" : "Plan a trip"} onClose={onClose}>
      <input className={`${inputCls} text-base`} placeholder="Lisbon long weekend" autoFocus={!trip}
             value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Field label="Where (optional)">
        <input className={inputCls} placeholder="Portugal" value={f.destination}
               onChange={(e) => setF({ ...f, destination: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" className={inputCls} value={f.start_date}
                 onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date || e.target.value })} />
        </Field>
        <Field label="Back">
          <input type="date" className={inputCls} value={f.end_date} min={f.start_date || undefined}
                 onChange={(e) => setF({ ...f, end_date: e.target.value })} />
        </Field>
      </div>
      <Field label="With">
        <ContactsPicker selected={people} onChange={setPeople} placeholder="Who's coming?" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} className={`${inputCls} resize-none`} value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <p className="text-[11px] text-[#52525B]">
        When you&apos;re back and the trip is detected, its name and who came carry over automatically.
      </p>
      {error && <p className="text-rose-400 text-xs">{error}</p>}
      <button onClick={() => run(() => (trip ? plansApi.updatePlannedTrip(trip.id, body) : plansApi.createPlannedTrip(body)))}
              disabled={busy || !valid}
              className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
        {busy ? "Saving…" : trip ? "Save" : "Plan trip"}
      </button>
      {trip && (
        <div className="flex justify-end text-xs">
          <button disabled={busy} onClick={() => confirm(`Delete “${trip.name}”?`) && run(() => plansApi.deletePlannedTrip(trip.id))}
                  className="text-rose-400/80 hover:text-rose-400">Delete</button>
        </div>
      )}
    </Sheet>
  );
}

/** Trips ahead — a countdown, dates and who's coming. */
export function TripsAhead() {
  const [editing, setEditing] = useState<PlannedTrip | "new" | null>(null);
  const { data: trips = [] } = useQuery({ queryKey: ["planned-trips"], queryFn: () => plansApi.plannedTrips() });

  return (
    <>
      {trips.length === 0 ? (
        <button onClick={() => setEditing("new")}
                className="w-full flex items-center gap-2 text-xs text-[#52525B] hover:text-[#A1A1AA] px-1">
          <Plane size={13} /> Plan a trip — just the dates and who&apos;s coming
        </button>
      ) : (
        <Block title="Trips ahead" action={
          <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA]">
            <Plus size={12} /> Trip
          </button>
        }>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {trips.map((t) => (
              <button key={t.id} onClick={() => setEditing(t)} className="w-full flex items-center gap-3 py-3 text-left">
                <span className="shrink-0 w-10 h-10 rounded-xl bg-[#18181B] flex items-center justify-center text-[#A1A1AA]">
                  <Plane size={18} strokeWidth={1.75} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA] truncate">
                    {t.name}{t.destination && <span className="text-[#71717A] font-normal"> · {t.destination}</span>}
                  </p>
                  <p className="text-xs text-[#52525B] tabular-nums">
                    {format(parseISO(t.start_date), "EEE d MMM")} – {format(parseISO(t.end_date), "d MMM")} · {t.nights} {t.nights === 1 ? "night" : "nights"}
                  </p>
                </div>
                {t.with.length > 0 && (
                  <div className="flex -space-x-2 shrink-0">
                    {t.with.slice(0, 3).map((p) => <Avatar key={p.id} name={p.name} emoji={p.emoji} size={24} />)}
                  </div>
                )}
                <span className="shrink-0 text-xs text-[#F59E0B] tabular-nums w-12 text-right">
                  {t.ongoing ? "Now" : t.days_until === 1 ? "Tmrw" : `${t.days_until}d`}
                </span>
              </button>
            ))}
          </Panel>
        </Block>
      )}
      {editing && <PlannedTripSheet trip={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
