import Link from "next/link";
import { format, parseISO } from "date-fns";
import { fmtDuration, fmtDistance, moodEmoji, activityIcon } from "@/lib/api";
import type { DaySummary } from "@/lib/api";

interface Props {
  day: DaySummary;
}

export function DayCard({ day }: Props) {
  const d = parseISO(day.date);
  const isWeekend = [0, 6].includes(d.getDay());

  const preview: string[] = [];
  if (day.sleep_duration_seconds)
    preview.push(`Slept ${fmtDuration(day.sleep_duration_seconds)}`);
  if (day.steps) preview.push(`${day.steps.toLocaleString()} steps`);

  return (
    <Link
      href={`/day/${day.date}`}
      className="group flex items-start gap-4 px-4 py-3 rounded-lg hover:bg-[#18181B] transition-colors"
    >
      {/* Date column */}
      <div className="w-16 shrink-0 text-right">
        <p className={`text-xs uppercase tracking-wider ${isWeekend ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
          {format(d, "EEE")}
        </p>
        <p className="text-sm font-semibold text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
          {format(d, "MMM d")}
        </p>
      </div>

      {/* Mood dot */}
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
          <p className="text-sm text-[#52525B]">No data logged</p>
        )}
        {(day.cities.length > 0 || day.duty_day || day.activity_count > 0 || day.flight_count > 0) && (
          <p className="text-xs text-[#52525B] mt-0.5 flex items-center gap-2 flex-wrap">
            {day.cities.length > 0 && <span>📍 {day.cities[0]}</span>}
            {day.activity_count > 0 && (
              <span>{day.activity_count} activit{day.activity_count === 1 ? "y" : "ies"}</span>
            )}
            {day.flight_count > 0 && (
              <span className="text-sky-400">✈ {day.flight_count} sector{day.flight_count > 1 ? "s" : ""}</span>
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
