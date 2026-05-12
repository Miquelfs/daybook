import { api } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { ApiOffline } from "@/components/ApiOffline";
import { LocationMap } from "@/components/LocationMap";
import { SyncOnLoad } from "@/components/SyncOnLoad";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { format } from "date-fns";

export default async function TodayPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [day, tracks] = await Promise.all([
    api.today().catch((e) => { console.error("[TodayPage] api.today() failed:", e?.message ?? e); return null; }),
    api.tracks(today).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
  ]);

  if (!day) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-20">
        <SyncOnLoad />
        <DayHeader date={today} />
        <div className="mt-10">
          <ApiOffline />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <SyncOnLoad />
      <DayHeader date={today} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
        />

        <MovementBlock activities={day.activities} stats={day.daily_stats} />

        <DaySpendSummary date={today} />

        <section>
          <SectionLabel>Where I was</SectionLabel>
          {day.visits.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {day.visits.map((v, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-1 rounded-full bg-[#18181B] border border-[#27272A] text-[#A1A1AA]"
                >
                  {v.place_name ?? v.city ?? "Unknown"}
                  {v.city && v.place_name && v.place_name !== v.city ? ` · ${v.city}` : ""}
                </span>
              ))}
            </div>
          )}
          <LocationMap geojson={tracks} />
        </section>

        <Questionnaire date={today} initial={day.subjective} />

        {/* On this day — Phase 2 */}
        <section>
          <SectionLabel>On this day</SectionLabel>
          <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center">
            <p className="text-sm text-[#52525B]">Coming in Phase 2</p>
            <p className="text-xs text-[#3F3F46] mt-1">
              What you were doing on this date in past years
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
