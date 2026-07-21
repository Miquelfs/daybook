"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { fmtDuration } from "@/lib/api";
import type { SleepData, DailyStats, HRVData, LoadIndexData } from "@/lib/api";

interface Props {
  sleep: SleepData | null;
  stats: DailyStats | null;
  hrv: HRVData | null;
  loadIndex?: LoadIndexData | null;
  brief?: string | null;
  aiAvailable?: boolean;
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#52525B] uppercase tracking-widest">
        {label}
      </span>
      <span
        className={`text-2xl font-semibold tabular-nums ${accent ? "text-[#F59E0B]" : "text-[#FAFAFA]"}`}
      >
        {value ?? "—"}
        {value && unit ? (
          <span className="text-sm font-normal text-[#A1A1AA] ml-1">{unit}</span>
        ) : null}
      </span>
    </div>
  );
}

const RECOVERY_COLOR: Record<string, string> = {
  recovering:  "text-emerald-400 border-emerald-900",
  balanced:    "text-[#A1A1AA] border-[#27272A]",
  accumulating:"text-rose-400 border-rose-900",
};

export function MorningBrief({ sleep, stats, hrv, loadIndex, brief, aiAvailable }: Props) {
  const sleepDuration = fmtDuration(sleep?.duration_seconds ?? null);
  const deepPct = sleep?.duration_seconds && sleep.deep_seconds
    ? Math.round((sleep.deep_seconds / sleep.duration_seconds) * 100)
    : null;

  const fatigue = loadIndex?.fatigue_score != null ? Math.round(loadIndex.fatigue_score) : null;
  const recoveryStatus = loadIndex?.recovery_status ?? null;
  const recoveryColor = recoveryStatus ? (RECOVERY_COLOR[recoveryStatus] ?? RECOVERY_COLOR.balanced) : null;

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("morning-brief-collapsed") === "1") {
      setCollapsed(true);
    }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("morning-brief-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  return (
    <section>
      <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">Morning brief</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
        <Stat label="Sleep" value={sleepDuration} accent />
        <Stat
          label="HRV"
          value={hrv?.last_night_avg ? Math.round(hrv.last_night_avg) : null}
          unit="ms"
        />
        <Stat
          label="Body battery"
          value={
            stats?.body_battery_high != null
              ? `${stats.body_battery_low}–${stats.body_battery_high}`
              : null
          }
        />
        <Stat
          label="Resting HR"
          value={stats?.resting_hr ?? null}
          unit="bpm"
        />
      </div>

      {(sleep?.score || deepPct || sleep?.avg_spo2 || stats?.stress_avg || fatigue != null) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {sleep?.score && <Pill label="Sleep score" value={`${sleep.score}`} />}
          {deepPct && <Pill label="Deep" value={`${deepPct}%`} />}
          {sleep?.avg_spo2 && <Pill label="SpO₂" value={`${sleep.avg_spo2}%`} />}
          {stats?.stress_avg && <Pill label="Stress avg" value={`${stats.stress_avg}/100`} />}
          {fatigue != null && recoveryColor && (
            <span className={`inline-flex items-center gap-2 text-xs bg-[#18181B] border rounded-full px-3 py-1 ${recoveryColor}`}>
              <span className="opacity-60">Load</span>
              <span>{fatigue}/100 · {recoveryStatus}</span>
            </span>
          )}
        </div>
      )}

      {brief ? (
        collapsed ? (
          <button
            onClick={toggle}
            className="mt-4 flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
          >
            Show insight
            <ChevronDown size={14} />
          </button>
        ) : (
          <div className="mt-5">
            <p className="text-sm text-[#A1A1AA] leading-relaxed text-justify border-l-2 border-[#F59E0B]/30 pl-3">
              {brief}
            </p>
            <button
              onClick={toggle}
              className="mt-2 ml-auto flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
            >
              Hide insight
              <ChevronDown size={14} className="rotate-180" />
            </button>
          </div>
        )
      ) : aiAvailable === false ? (
        <p className="mt-5 text-xs text-[#52525B] leading-relaxed border-l-2 border-[#27272A] pl-3">
          Narrative offline — AI node unreachable.
        </p>
      ) : null}
    </section>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs bg-[#18181B] border border-[#27272A] rounded-full px-3 py-1">
      <span className="text-[#52525B]">{label}</span>
      <span className="text-[#A1A1AA]">{value}</span>
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">
      {children}
    </p>
  );
}
