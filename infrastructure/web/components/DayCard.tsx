import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Luggage } from "lucide-react";
import { fmtDuration, fmtDistance, moodEmoji, activityIcon } from "@/lib/api";
import type { DaySummary } from "@/lib/api";

interface Props {
  day: DaySummary;
  onTrip?: boolean; // this date falls inside an auto-detected trip
}

// Mood sets the left accent — same red→amber→green ramp used in the Weeks
// review ring, so a glance down the list reads like a mood strip.
function moodAccent(mood: number | null): string {
  if (mood == null) return "#27272A";
  if (mood >= 8) return "#22C55E";
  if (mood >= 5) return "#F59E0B";
  return "#EF4444";
}

export function DayCard({ day, onTrip }: Props) {
  const d = parseISO(day.date);
  const isWeekend = [0, 6].includes(d.getDay());

  const preview: string[] = [];
  if (day.sleep_duration_seconds)
    preview.push(`Slept ${fmtDuration(day.sleep_duration_seconds)}`);
  if (day.steps) preview.push(`${day.steps.toLocaleString()} steps`);

  return (
    <Link
      href={`/day/${day.date}`}
      className={`group relative flex items-start gap-4 pl-4 pr-4 py-3.5 rounded-xl border transition-colors overflow-hidden ${
        onTrip
          ? "bg-sky-500/[0.04] border-sky-500/20 hover:border-sky-500/40"
          : "bg-[#0D0D0F] border-[#27272A] hover:border-[#3F3F46]"
      }`}
    >
      {/* Mood accent spine */}
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: moodAccent(day.mood) }} />

      {/* Date column */}
      <div className="w-16 shrink-0 text-right">
        <p className={`text-xs uppercase tracking-wider flex items-center justify-end gap-1 ${isWeekend ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
          {onTrip && <Luggage size={10} className="text-sky-400" />}
          {format(d, "EEE")}
        </p>
        <p className="text-sm font-semibold text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
          {format(d, "MMM d")}
        </p>
      </div>

      {/* Mood emoji */}
      <div className="mt-0.5 text-base w-5 shrink-0 text-center">
        {moodEmoji(day.mood)}
      </div>

      {/* Preview */}
      <div className="flex-1 min-w-0">
        {preview.length > 0 ? (
          <p className="text-sm text-[#A1A1AA] truncate">
            {preview.join(" · ")}
          </p>
        ) : (
          <p className="text-sm text-[#3F3F46]">No data logged</p>
        )}
        {(day.cities.length > 0 || day.duty_day || day.activity_count > 0 || day.flight_count > 0 || day.passenger_flight_count > 0) && (
          <p className="text-xs text-[#52525B] mt-1 flex items-center gap-2 flex-wrap">
            {day.cities.length > 0 && <span>📍 {day.cities[0]}</span>}
            {day.activity_count > 0 && (
              <span>{day.activity_count} activit{day.activity_count === 1 ? "y" : "ies"}</span>
            )}
            {day.flight_count > 0 && (
              <span className="text-sky-400">✈ {day.flight_count} sector{day.flight_count > 1 ? "s" : ""}</span>
            )}
            {day.passenger_flight_count > 0 && (
              <span className="text-cyan-300">🧳 {day.passenger_flight_count} flight{day.passenger_flight_count > 1 ? "s" : ""}</span>
            )}
            {day.duty_day && day.flight_count === 0 && <span className="text-[#F59E0B]">✈ Duty</span>}
          </p>
        )}
      </div>

      {/* Metrics */}
      {day.hrv_last_night && (
        <div className="shrink-0 text-right hidden sm:block">
          <p className="text-xs text-[#52525B]">HRV</p>
          <p className="text-sm tabular-nums text-[#A1A1AA]">
            {Math.round(day.hrv_last_night)}
          </p>
        </div>
      )}

      {/* Photo dot */}
      {day.photo_path && (
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-2" title="Photo logged" />
      )}
    </Link>
  );
}
