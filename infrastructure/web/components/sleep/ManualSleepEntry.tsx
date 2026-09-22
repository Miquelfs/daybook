"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { format } from "date-fns";
import { api } from "@/lib/api";

const inputCls =
  "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] [color-scheme:dark]";

// For nights the watch died / wasn't worn — a minimal manual log (just the
// times) so sleep debt and dashboards don't have a hole for that night.
export function ManualSleepEntry({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(format(new Date(Date.now() - 86400000), "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState("23:00");
  const [endTime, setEndTime] = useState("07:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.addManualSleep({ date, start_time: startTime, end_time: endTime });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
      >
        <Plus size={13} /> Log a night manually
      </button>
    );
  }

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[#FAFAFA]">Log a night manually</p>
        <button onClick={() => setOpen(false)} className="text-[#52525B] hover:text-[#A1A1AA]">
          <X size={16} />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-[#52525B]">Went to sleep</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-[#52525B]">Woke up</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
