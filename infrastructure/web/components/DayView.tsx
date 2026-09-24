import Link from "next/link";
import { api, type LifeEvent } from "@/lib/api";
import { OnThisDay } from "@/components/OnThisDay";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { LocationSection } from "@/components/LocationSection";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { DayRosterBadge } from "@/components/DayRosterBadge";
import { DayFlights } from "@/components/DayFlights";
import { DayPassengerFlights } from "@/components/DayPassengerFlights";
import { DayRestaurants } from "@/components/DayRestaurants";
import { DayBooks } from "@/components/DayBooks";
import { DayFood } from "@/components/DayFood";
import { RecoveryCard } from "@/components/RecoveryCard";
import { StressEnergyTimeline } from "@/components/StressEnergyTimeline";
import { PhotoOfDay } from "@/components/PhotoOfDay";
import { ScreenTimeBlock } from "@/components/ScreenTimeBlock";
import { ApiOffline } from "@/components/ApiOffline";
import { DayAddFAB } from "@/components/DayAddFAB";
import { DayTraining } from "@/components/DayTraining";
import { format } from "date-fns";

/**
 * The full single-day view. Rendered identically by both the home ("today")
 * route and /day/[date] so the two can never drift apart — this is the single
 * source of truth for what a day looks like.
 */
export async function DayView({ date }: { date: string }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(new Date(Date.now() - 86400000), "yyyy-MM-dd");
  const isEditable = date === today || date === yesterday;

  const API_BASE =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";

  const [day, tracks, lifeEvents, onThisDay,
    morningBriefData, trainingDay, aiStatus] = await Promise.all([
    api.day(date).catch(() => null),
    api.tracks(date).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.lifeEventsOnThisDay(date).catch(() => []),
    api.onThisDay(date).catch(() => null),
    api.morningBrief(date).catch(() => null),
    fetch(`${API_BASE}/race-plans/day/${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    api.aiStatus().catch(() => null),
  ]);

  if (!day) {
    return (
      <>
        <DayHeader date={date} />
        <div className="mt-10">
          <ApiOffline />
        </div>
        <DayAddFAB date={date} />
      </>
    );
  }

  // Merge "on this day" (mood/restaurants/books/trip, one row per year that
  // has anything) with life events (their own separate table) into a single
  // chronological list — a year with only a life event still gets a row.
  const eventsByDate = new Map<string, LifeEvent[]>();
  for (const ev of lifeEvents) {
    if (!eventsByDate.has(ev.event_date)) eventsByDate.set(ev.event_date, []);
    eventsByDate.get(ev.event_date)!.push(ev);
  }
  const onThisDayDates = new Set((onThisDay?.years ?? []).map((y) => y.date));
  const eventOnlyDates = [...eventsByDate.keys()].filter((d) => !onThisDayDates.has(d));

  const yearEntries = [
    ...(onThisDay?.years ?? []).map((y) => ({ ...y, events: eventsByDate.get(y.date) ?? [] })),
    ...eventOnlyDates.map((d) => ({
      date: d, mood: null, mood_note: null, notes: null, trip_city: null,
      restaurants: [], books: [], events: eventsByDate.get(d)!,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <DayHeader date={date} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
          loadIndex={day.load_index}
          brief={morningBriefData?.brief ?? null}
          aiAvailable={aiStatus?.ollama_available ?? false}
        />

        {/* Recovery cue sits tight above Training — it's a lead-in to it, not
            a standalone section, so keep the gap small (gap-4, not gap-12). */}
        <div className="flex flex-col gap-4">
          <RecoveryCard date={date} />
          <DayTraining initialPrescription={trainingDay} date={date} />
        </div>

        <MovementBlock
          date={date}
          activities={day.activities}
          stats={day.daily_stats}
          screenTimeSlot={<ScreenTimeBlock date={date} />}
        />

        <StressEnergyTimeline date={date} />

        <DayRosterBadge date={date} />

        <DayFlights date={date} />

        <DayPassengerFlights date={date} />

        <DaySpendSummary date={date} />

        <DayFood date={date} />

        <DayRestaurants date={date} />
        <DayBooks date={date} />

        <section>
          <SectionLabel>Photo of the day</SectionLabel>
          <PhotoOfDay date={date} initialPhotoUrl={day.photo_url ?? null} initialCaption={day.subjective.photo_caption ?? null} />
        </section>

        <section>
          <SectionLabel>Where I was</SectionLabel>
          <LocationSection date={date} initialTracks={tracks} editable={isEditable} />
        </section>

        <Questionnaire date={date} initial={day.subjective} initialTags={day.tags ?? []} initialCompanions={day.companions ?? []} />

        <div className="flex justify-end">
          <Link href="/journal" className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">
            Browse journal →
          </Link>
        </div>

        <section>
          <SectionLabel>On this day</SectionLabel>
          <OnThisDay entries={yearEntries} todayDate={date} />
        </section>
      </div>

      <DayAddFAB date={date} />
    </>
  );
}
