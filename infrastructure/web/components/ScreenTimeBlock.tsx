"use client";

import { useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type AppUsage = {
  bundle_id: string;
  app_name: string | null;
  minutes: number;
};

type ScreenTimeData = {
  date: string;
  total_minutes: number | null;
  unlocks: number | null;
  top_app: string | null;
  top_app_name: string | null;
  top_app_minutes: number | null;
  app_usage: AppUsage[];
};

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  if (h === 0) return `${min}m`;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

function ScreenTimeEntry({
  date,
  initialHours = "",
  initialMins = "",
  onSaved,
}: {
  date: string;
  initialHours?: string;
  initialMins?: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(initialHours);
  const [mins, setMins] = useState(initialMins);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const total = (parseFloat(hours) || 0) * 60 + (parseFloat(mins) || 0);
    if (total <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/screen-time/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, total_minutes: total, app_usage: [] }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(`HTTP ${res.status}${text ? ": " + text.slice(0, 100) : ""}`);
        return;
      }
      // Optimistically update cache so display flips immediately
      qc.setQueryData<ScreenTimeData>(["screen-time", date], (old) => ({
        date,
        total_minutes: total,
        unlocks: old?.unlocks ?? null,
        top_app: old?.top_app ?? null,
        top_app_name: old?.top_app_name ?? null,
        top_app_minutes: old?.top_app_minutes ?? null,
        app_usage: old?.app_usage ?? [],
      }));
      // Then refetch in the background to sync real DB state
      qc.invalidateQueries({ queryKey: ["screen-time", date] });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-dashed border-[#27272A] rounded-xl p-3 flex flex-col gap-2.5">
      <p className="text-[10px] text-[#52525B] uppercase tracking-wide">Log screen time</p>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          max="23"
          placeholder="0"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-12 bg-[#18181B] border border-[#27272A] rounded-md px-1 py-2 text-base
                     text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none
                     focus:border-[#F59E0B] transition-colors tabular-nums text-center"
        />
        <span className="text-xs text-[#52525B]">h</span>
        <input
          type="number"
          min="0"
          max="59"
          placeholder="0"
          value={mins}
          onChange={(e) => setMins(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-12 bg-[#18181B] border border-[#27272A] rounded-md px-1 py-2 text-base
                     text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none
                     focus:border-[#F59E0B] transition-colors tabular-nums text-center"
        />
        <span className="text-xs text-[#52525B]">m</span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ml-auto flex items-center justify-center w-7 h-7 rounded-md bg-[#F59E0B]/10
                     border border-[#F59E0B]/40 text-[#F59E0B] hover:bg-[#F59E0B]/20
                     transition-colors disabled:opacity-40 shrink-0"
        >
          <Check size={13} />
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-1.5 text-red-400">
          <AlertCircle size={11} className="shrink-0 mt-0.5" />
          <p className="text-[10px] leading-tight">{error}</p>
        </div>
      )}
    </div>
  );
}

export function ScreenTimeBlock({ date }: { date: string }) {
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery<ScreenTimeData>({
    queryKey: ["screen-time", date],
    queryFn: () =>
      fetch(`${BASE}/screen-time/${date}`).then((r) => r.json()),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return <div className="h-16 rounded-xl bg-[#0D0D0F] border border-[#27272A] animate-pulse" />;
  }

  const totalMinutes = data?.total_minutes ?? null;

  if (!totalMinutes || editing) {
    const ih = totalMinutes ? String(Math.floor(totalMinutes / 60)) : "";
    const im = totalMinutes ? String(Math.round(totalMinutes % 60)) : "";
    return (
      <ScreenTimeEntry
        date={date}
        initialHours={ih}
        initialMins={im}
        onSaved={() => setEditing(false)}
      />
    );
  }

  const topApps = data?.app_usage.slice(0, 3) ?? [];
  const maxMinutes = topApps[0]?.minutes ?? 1;

  return (
    <div
      className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 space-y-2.5 cursor-pointer hover:border-[#3F3F46] transition-colors"
      onClick={() => setEditing(true)}
      title="Tap to edit"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xl font-semibold text-[#FAFAFA] tabular-nums leading-none">
          {fmtMinutes(totalMinutes)}
        </span>
        {data?.unlocks != null && (
          <span className="text-[10px] text-[#52525B] tabular-nums">
            {data.unlocks} unlocks
          </span>
        )}
      </div>

      {topApps.length > 0 && (
        <div className="space-y-1.5">
          {topApps.map((app) => (
            <div key={app.bundle_id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-[#71717A] truncate">
                  {app.app_name ?? app.bundle_id.split(".").pop()}
                </span>
                <span className="text-[10px] text-[#52525B] tabular-nums shrink-0">
                  {fmtMinutes(app.minutes)}
                </span>
              </div>
              <div className="h-1 bg-[#18181B] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#F59E0B]/60 rounded-full"
                  style={{ width: `${Math.min(100, (app.minutes / maxMinutes) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
