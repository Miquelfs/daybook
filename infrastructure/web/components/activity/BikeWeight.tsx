"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/kit";

/** What the bike weighed with everything on it (a loaded touring bike is 30–40 kg) — the estimate's physics uses it. */
export function BikeWeight({ activityId, rider, bike, isDefault }: {
  activityId: string; rider: number; bike: number; isDefault: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kg, setKg] = useState(String(bike));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(scope: "ride" | "trip", value: number | null) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/bike`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bike_kg: value, scope }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Couldn't save");
      setMsg(scope === "trip" ? `Set on ${d.activity_ids.length} rides of ${d.trip ?? "the trip"}` : null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const value = Number(kg.replace(",", "."));
  const valid = Number.isFinite(value) && value >= 3 && value <= 80;

  return (
    <span>
      {" "}(you {rider} kg + bike{isDefault ? "" : " & luggage"} {bike} kg
      {!open && <> · <button type="button" onClick={() => setOpen(true)} className="underline hover:text-[#A1A1AA]">change</button></>})
      {open && (
        <span className="flex flex-wrap items-center gap-2 mt-2 mb-1">
          <input type="number" inputMode="decimal" min={3} max={80} step={0.5} value={kg}
                 onChange={(e) => setKg(e.target.value)} aria-label="Bike and luggage weight in kg"
                 className="w-20 px-2 py-1 text-xs rounded-md bg-[#18181B] border border-[#27272A] text-[#FAFAFA] tabular-nums" />
          <span>kg with bags, bottles and tools</span>
          <Pill on={false} onClick={() => valid && !busy && save("ride", value)}>This ride</Pill>
          <Pill on={false} onClick={() => valid && !busy && save("trip", value)}>Every ride of this trip</Pill>
          {!isDefault && <Pill on={false} onClick={() => !busy && save("ride", null)}>Default</Pill>}
          <button type="button" onClick={() => setOpen(false)} className="text-[#52525B] hover:text-[#A1A1AA]">Cancel</button>
        </span>
      )}
      {msg && <span className="block text-[#A1A1AA] mt-1">{msg}</span>}
    </span>
  );
}
