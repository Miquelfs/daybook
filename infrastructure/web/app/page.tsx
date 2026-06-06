export const dynamic = "force-dynamic";

import Link from "next/link";
import { api, moodEmoji } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { ApiOffline } from "@/components/ApiOffline";
import { LocationSection } from "@/components/LocationSection";
import { SyncOnLoad } from "@/components/SyncOnLoad";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { PhotoOfDay } from "@/components/PhotoOfDay";
import { ScreenTimeBlock } from "@/components/ScreenTimeBlock";
import { format, subYears, parseISO } from "date-fns";

export default async function TodayPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const oneYearAgo = format(subYears(new Date(), 1), "yyyy-MM-dd");

  const [day, tracks, pastDay] = await Promise.all([
    api.today().catch((e) => { console.error("[TodayPage] api.today() failed:", e?.message ?? e); return null; }),
    api.tracks(today).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.day(oneYearAgo).catch(() => null),
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

        <MovementBlock
          activities={day.activities}
          stats={day.daily_stats}
          screenTimeSlot={<ScreenTimeBlock date={today} />}
        />

        <DaySpendSummary date={today} />

        <section>
          <SectionLabel>Photo of the day</SectionLabel>
          <PhotoOfDay date={today} initialPhotoUrl={day.photo_url ?? null} />
        </section>

        <section>
          <SectionLabel>Where I was</SectionLabel>
          <LocationSection date={today} initialTracks={tracks} editable={true} />
        </section>

        <Questionnaire date={today} initial={day.subjective} initialTags={day.tags ?? []} initialCompanions={day.companions ?? []} />

        <div className="flex justify-end">
          <Link href="/journal" className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">
            Browse journal →
          </Link>
        </div>

        <section>
          <SectionLabel>On this day</SectionLabel>
          {pastDay?.subjective.mood ? (
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 space-y-1">
              <p className="text-xs text-[#52525B] uppercase tracking-widest">
                {format(parseISO(oneYearAgo), "d MMM yyyy")}
              </p>
              <p className="text-2xl font-semibold text-[#F59E0B]">
                {moodEmoji(pastDay.subjective.mood)}{" "}
                <span className="text-lg">{pastDay.subjective.mood}/10</span>
              </p>
              {pastDay.subjective.mood_note && (
                <p className="text-sm text-[#A1A1AA] italic">
                  &ldquo;{pastDay.subjective.mood_note}&rdquo;
                </p>
              )}
              {pastDay.subjective.notes && (
                <p className="text-xs text-[#52525B] truncate">{pastDay.subjective.notes}</p>
              )}
            </div>
          ) : (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center">
              <p className="text-sm text-[#52525B]">No data for this day last year</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
