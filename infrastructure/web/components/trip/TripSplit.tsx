"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/kit";

type Night = { date: string; city: string | null; country: string | null };
type Piece = { start_date: string; end_date: string; name: string };

function fmtNight(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** One detected trip that was really two (Tenerife → Barcelona → somewhere else, no night at home between):
 *  pick the first night of the second trip. The split is a rule the nightly rebuild keeps. */
export function TripSplit({ start, end, name, splitFromPrevious }: {
  start: string; end: string; name: string; splitFromPrevious: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nights, setNights] = useState<Night[] | null>(null);
  const [on, setOn] = useState<string | null>(null);
  const [names, setNames] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/locations/trips/${start}/${end}`;

  async function openPicker() {
    setOpen(true);
    if (nights) return;
    try {
      const r = await fetch(`${base}/nights`);
      setNights(((await r.json()).nights ?? []) as Night[]);
    } catch {
      setNights([]);
    }
  }

  async function post(path: string, body?: object) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${base}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Couldn't do that");
      const pieces = (d.trips ?? []) as Piece[];
      const first = pieces[0];
      if (first) router.push(`/explore/trip/${first.start_date}/${first.end_date}`);
      router.refresh();
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const multiNight = start < end;
  if (!multiNight && !splitFromPrevious) return null;

  // the new trip can start on any night after the first
  const choices = (nights ?? []).filter((n) => n.date > start);
  const where = (n: Night) => [n.city, n.country].filter(Boolean).join(", ");

  return (
    <section>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">Trip</p>
      {!open && (
        <div className="flex flex-wrap gap-2">
          {multiNight && <Pill on={false} onClick={openPicker}>Split into two trips</Pill>}
          {splitFromPrevious && (
            <Pill on={false} onClick={() => !busy && post("join")}>Join with the trip before</Pill>
          )}
        </div>
      )}
      {open && (
        <div className="rounded-xl border border-[#27272A] p-4 text-sm">
          <p className="text-[#A1A1AA] mb-3">The second trip starts on the night of…</p>
          {nights === null ? (
            <p className="text-xs text-[#52525B]">Loading nights…</p>
          ) : (
            <div className="flex flex-col gap-1 mb-4 max-h-64 overflow-y-auto">
              {choices.map((n) => (
                <button key={n.date} type="button" onClick={() => setOn(n.date)}
                        className={`flex items-baseline justify-between gap-3 px-3 py-1.5 rounded-md text-left transition-colors ${
                          on === n.date ? "bg-[#F59E0B]/10 text-[#F59E0B]" : "text-[#A1A1AA] hover:bg-[#18181B]"}`}>
                  <span className="tabular-nums">{fmtNight(n.date)}</span>
                  <span className="text-xs text-[#71717A] truncate">{where(n)}</span>
                </button>
              ))}
            </div>
          )}
          {on && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {(["First trip", "Second trip"] as const).map((label, i) => (
                <label key={label} className="text-xs text-[#71717A]">
                  {label} · {i === 0 ? `${fmtNight(start)} → ${fmtNight(choices[choices.findIndex((c) => c.date === on) - 1]?.date ?? start)}` : `from ${fmtNight(on)}`}
                  <input value={names[i]} placeholder={i === 0 ? name : "Name (optional)"}
                         onChange={(e) => setNames(i === 0 ? [e.target.value, names[1]] : [names[0], e.target.value])}
                         className="mt-1 w-full px-2 py-1.5 rounded-md bg-[#18181B] border border-[#27272A] text-[#FAFAFA] text-sm" />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Pill on={!!on} onClick={() => on && !busy && post("split", {
              on, first_name: names[0] || null, second_name: names[1] || null })}>
              {busy ? "Splitting…" : "Split"}
            </Pill>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}
    </section>
  );
}
