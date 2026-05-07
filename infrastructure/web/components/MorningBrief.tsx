import { fmtDuration } from "@/lib/api";
import type { SleepData, DailyStats, HRVData } from "@/lib/api";

interface Props {
  sleep: SleepData | null;
  stats: DailyStats | null;
  hrv: HRVData | null;
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

export function MorningBrief({ sleep, stats, hrv }: Props) {
  const sleepDuration = fmtDuration(sleep?.duration_seconds ?? null);
  const deepPct = sleep?.duration_seconds && sleep.deep_seconds
    ? Math.round((sleep.deep_seconds / sleep.duration_seconds) * 100)
    : null;

  return (
    <section>
      <SectionLabel>Morning brief</SectionLabel>
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

      {/* Secondary row */}
      {(sleep?.score || deepPct || sleep?.avg_hrv) && (
        <div className="mt-4 flex flex-wrap gap-4">
          {sleep?.score && (
            <Pill label="Sleep score" value={`${sleep.score}`} />
          )}
          {deepPct && <Pill label="Deep" value={`${deepPct}%`} />}
          {sleep?.avg_spo2 && (
            <Pill label="SpO₂" value={`${sleep.avg_spo2}%`} />
          )}
          {stats?.stress_avg && (
            <Pill label="Stress avg" value={`${stats.stress_avg}/100`} />
          )}
        </div>
      )}
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
