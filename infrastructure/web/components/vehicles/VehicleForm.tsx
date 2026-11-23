"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Pill } from "@/components/ui/kit";
import { fmtAmount } from "@/lib/money-api";
import { vehiclesApi, KIND_LABEL, DEFAULT_TAG, type Vehicle, type VehicleInput, type VehicleKind } from "@/lib/statements-api";

const input = "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]";
const label = "text-[10px] text-[#52525B] uppercase tracking-widest mb-1 block";
const TAGS = [
  { slug: "motorcycle", label: "Scooter ride" },
  { slug: "car_drive", label: "Car drive" },
];

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

// Add / edit a vehicle. Which Transportation subcategories are its costs, and which day tag marks
// the days you used it (that's how the GPS finds its routes).
export function VehicleForm({ initial, onSave, saving, error }: {
  initial?: Vehicle;
  onSave: (v: VehicleInput) => void;
  saving?: boolean;
  error?: string | null;
}) {
  const [kind, setKind] = useState<VehicleKind>(initial?.kind ?? "scooter");
  const [name, setName] = useState(initial?.name ?? "");
  const [makeModel, setMakeModel] = useState(initial?.make_model ?? "");
  const [plate, setPlate] = useState(initial?.plate ?? "");
  const [year, setYear] = useState(initial?.year?.toString() ?? "");
  const [fuel, setFuel] = useState(initial?.fuel ?? "petrol");
  const [boughtOn, setBoughtOn] = useState(initial?.bought_on ?? "");
  const [boughtKm, setBoughtKm] = useState(initial?.bought_km?.toString() ?? "");
  const [boughtPrice, setBoughtPrice] = useState(initial?.bought_price?.toString() ?? "");
  const [soldOn, setSoldOn] = useState(initial?.sold_on ?? "");
  const [tag, setTag] = useState<string | null>(initial ? initial.day_tag : DEFAULT_TAG.scooter ?? null);
  const [subs, setSubs] = useState<string[]>(initial?.subcategories ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const { data: known = [] } = useQuery({ queryKey: ["vehicles", "subcategories"], queryFn: () => vehiclesApi.subcategories() });
  const lower = new Set(subs.map((s) => s.toLowerCase()));
  const toggleSub = (s: string) =>
    setSubs(lower.has(s.toLowerCase()) ? subs.filter((x) => x.toLowerCase() !== s.toLowerCase()) : [...subs, s]);

  function pickKind(k: VehicleKind) {
    setKind(k);
    if (!initial) setTag(DEFAULT_TAG[k] ?? null);
  }

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      onSave({
        name: name.trim(), kind, make_model: makeModel.trim() || null, plate: plate.trim() || null,
        year: num(year), fuel: fuel || null, bought_on: boughtOn || null, bought_km: num(boughtKm),
        bought_price: num(boughtPrice), sold_on: soldOn || null, day_tag: tag, subcategories: subs,
        notes: notes.trim() || null,
      });
    }}>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(KIND_LABEL) as VehicleKind[]).map((k) => (
          <Pill key={k} on={kind === k} onClick={() => pickKind(k)}>{KIND_LABEL[k]}</Pill>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><span className={label}>Name</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="The scooter" /></div>
        <div><span className={label}>Make & model</span>
          <input className={input} value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="Honda PCX 125" /></div>
        <div><span className={label}>Plate</span>
          <input className={input} value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
        <div><span className={label}>Year</span>
          <input className={input} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></div>
        <div><span className={label}>Fuel</span>
          <select className={input} value={fuel} onChange={(e) => setFuel(e.target.value)}>
            {["petrol", "diesel", "electric", "hybrid"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select></div>
        <div><span className={label}>Bought on</span>
          <input type="date" className={input} value={boughtOn} onChange={(e) => setBoughtOn(e.target.value)} /></div>
        <div><span className={label}>Km when bought</span>
          <input className={input} inputMode="decimal" value={boughtKm} onChange={(e) => setBoughtKm(e.target.value)} /></div>
        <div><span className={label}>Price (€)</span>
          <input className={input} inputMode="decimal" value={boughtPrice} onChange={(e) => setBoughtPrice(e.target.value)} /></div>
        {initial && (
          <div><span className={label}>Sold on</span>
            <input type="date" className={input} value={soldOn} onChange={(e) => setSoldOn(e.target.value)} /></div>
        )}
      </div>

      <div>
        <span className={label}>Days you used it (routes come from the GPS on these days)</span>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => <Pill key={t.slug} on={tag === t.slug} onClick={() => setTag(tag === t.slug ? null : t.slug)}>{t.label}</Pill>)}
        </div>
      </div>

      <div>
        <span className={label}>Its costs — Transportation subcategories from before</span>
        {known.length === 0 ? (
          <p className="text-xs text-[#52525B]">No Transportation subcategories yet — new costs can be logged from the vehicle&apos;s page.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {known.map((s) => (
              <Pill key={s.subcategory} on={lower.has(s.subcategory.toLowerCase())} onClick={() => toggleSub(s.subcategory)}>
                {s.subcategory}<span className="text-[#52525B]">{s.count} · {fmtAmount(s.total)}</span>
              </Pill>
            ))}
          </div>
        )}
      </div>

      <div><span className={label}>Notes</span>
        <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      <button type="submit" disabled={!name.trim() || saving}
              className="inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 disabled:opacity-50">
        <Check size={13} />{initial ? "Save" : "Add vehicle"}
      </button>
    </form>
  );
}
