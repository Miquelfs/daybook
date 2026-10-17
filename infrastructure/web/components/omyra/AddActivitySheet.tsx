"use client";

import { useState } from "react";
import { activityIcon } from "@/lib/api";
import { localISODate } from "@/lib/dates";

const SPORT_TYPES = [
  "running", "cycling", "swimming", "hiking", "walking",
  "strength_training", "yoga", "tennis", "rowing", "other",
];

type ActivityForm = {
  date: string;
  activity_type: string;
  name: string;
  duration_minutes: string;
  distance_km: string;
  elevation_m: string;
  avg_heart_rate: string;
  user_notes: string;
  user_rating: number | null;
};

export function AddActivitySheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ActivityForm>({
    date: localISODate(),
    activity_type: "running",
    name: "",
    duration_minutes: "",
    distance_km: "",
    elevation_m: "",
    avg_heart_rate: "",
    user_notes: "",
    user_rating: null,
  });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof ActivityForm, value: string | number | null) =>
    setForm(f => ({ ...f, [key]: value }));

  async function save() {
    if (!form.activity_type) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        date: form.date,
        activity_type: form.activity_type,
        name: form.name || form.activity_type,
        duration_seconds: form.duration_minutes ? parseFloat(form.duration_minutes) * 60 : null,
        distance_meters: form.distance_km ? parseFloat(form.distance_km) * 1000 : null,
        elevation_gain_meters: form.elevation_m ? parseFloat(form.elevation_m) : null,
        avg_heart_rate: form.avg_heart_rate ? parseFloat(form.avg_heart_rate) : null,
        user_notes: form.user_notes || null,
        user_rating: form.user_rating,
      };
      const res = await fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { onSaved(); onClose(); }
    } finally { setSaving(false); }
  }

  const RATING_COLORS: Record<number, string> = {
    1: "#EF4444", 2: "#EF4444", 3: "#F97316", 4: "#F59E0B", 5: "#EAB308",
    6: "#84CC16", 7: "#22C55E", 8: "#22C55E", 9: "#10B981", 10: "#10B981",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Log activity manually</h2>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">×</button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SPORT_TYPES.map(s => (
              <button key={s} type="button" onClick={() => set("activity_type", s)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors capitalize ${form.activity_type === s ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {activityIcon(s)} {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[#71717A] mb-1 block">Date</label>
              <input type="date" className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" value={form.date} onChange={e => set("date", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Name (optional)</label>
              <input className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="e.g. Morning run" value={form.name} onChange={e => set("name", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-[#71717A] mb-1 block">Duration (min)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="60" value={form.duration_minutes} onChange={e => set("duration_minutes", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Distance (km)</label>
              <input type="number" min={0} step="0.1" className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="5.0" value={form.distance_km} onChange={e => set("distance_km", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Elevation (m)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="100" value={form.elevation_m} onChange={e => set("elevation_m", e.target.value)} /></div>
            <div><label className="text-xs text-[#71717A] mb-1 block">Avg HR (bpm)</label>
              <input type="number" min={0} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" placeholder="145" value={form.avg_heart_rate} onChange={e => set("avg_heart_rate", e.target.value)} /></div>
          </div>
          <div>
            <label className="text-xs text-[#71717A] mb-2 block">How did it feel?</label>
            <div className="flex gap-1.5 flex-wrap">
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <button key={n} type="button" onClick={() => set("user_rating", form.user_rating === n ? null : n)}
                  className="w-8 h-8 rounded-lg text-xs font-semibold transition-all"
                  style={form.user_rating === n ? { backgroundColor: RATING_COLORS[n], color: "#09090B" } : { backgroundColor: "#18181B", color: "#52525B" }}>{n}</button>
              ))}
            </div>
          </div>
          <div><label className="text-xs text-[#71717A] mb-1 block">Notes</label>
            <textarea rows={2} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] resize-none placeholder:text-[#3F3F46]"
              placeholder="How did it go?" value={form.user_notes} onChange={e => set("user_notes", e.target.value)} /></div>
          <button disabled={saving} onClick={save}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1">
            {saving ? "Saving…" : "Log activity"}
          </button>
        </div>
      </div>
    </div>
  );
}
