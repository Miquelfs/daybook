import Link from "next/link";
import { api, type LifeEvent } from "@/lib/api";
import { OnThisDay } from "@/components/OnThisDay";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { LocationSection } from "@/components/LocationSection";
import { DayPlaces } from "@/components/explore/DayPlaces";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { DayDuty } from "@/components/day/DayDuty";
import { NowCard } from "@/components/day/NowCard";
import { DayLearning } from "@/components/learning/DayLearning";
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
import { AheadStrip } from "@/components/plan/AheadStrip";
import { Chapter, Fold } from "@/components/ui/kit";
import { format } from "date-fns";
import { cookies } from "next/headers";
import { todayIn } from "@/lib/dates";

/**
 * The full single-day view. Rendered identically by both the home ("today")
 * route and /day/[date] so the two can never drift apart — this is the single
 * source of truth for what a day looks like.
 */
export async function DayView({ date }: { date: string }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(new Date(Date.now() - 86400000), "yyyy-MM-dd");
  const isEditable = date === today || date === yesterday;
  // Your local date (device tz cookie) — the Pi's clock can be a day off abroad.
  const localToday = todayIn((await cookies()).get("tz")?.value);

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

      {/* One shape for every day: Now → Plan → Body → The day → Reflect. Sections hide when
          empty; long ones fold to a preview. */}
      <div className="flex flex-col gap-12 mt-10">
        {/* What now? — only on today, before everything else */}
        {date === localToday && <NowCard date={date} />}

        {/* The day's structure, lane by lane: tasks, the duty that frames it, training,
            learning. On a past day they become the record of what happened. */}
        <Chapter title={date === localToday ? "Plan" : "The plan"}>
          {/* Tasks first: adding one should be one tap from the top */}
          <AheadStrip date={date} isToday={date === localToday} />
          <DayDuty date={date} />
          <DayTraining initialPrescription={trainingDay} date={date} lead={<RecoveryCard date={date} />} />
          <DayLearning date={date} isToday={date === localToday} />
        </Chapter>

        {/* Body: how you slept and recovered, how the day loaded you, how much you moved */}
        <Chapter title="Body">
          <MorningBrief
            sleep={day.sleep}
            stats={day.daily_stats}
            hrv={day.hrv}
            loadIndex={day.load_index}
            brief={morningBriefData?.brief ?? null}
            aiAvailable={aiStatus?.ollama_available ?? false}
          />
          <StressEnergyTimeline date={date} />
          <MovementBlock
            date={date}
            activities={day.activities}
            stats={day.daily_stats}
            screenTimeSlot={<ScreenTimeBlock date={date} />}
          />
        </Chapter>

        {/* The day: where you were and what happened — compact, each opens fully */}
        <Chapter title="The day">
          <section>
            <SectionLabel>Where I was</SectionLabel>
            <LocationSection date={date} initialTracks={tracks} editable={isEditable} />
            <DayPlaces date={date} />
          </section>
          <section>
            <SectionLabel>Photo of the day</SectionLabel>
            <PhotoOfDay date={date} initialPhotoUrl={day.photo_url ?? null} initialCaption={day.subjective.photo_caption ?? null} />
          </section>
          <Fold max={260}><DayFood date={date} /></Fold>
          <Fold max={200}><DaySpendSummary date={date} /></Fold>
          <Fold max={200}><DayRestaurants date={date} /></Fold>
          <DayBooks date={date} />
          <DayPassengerFlights date={date} />
        </Chapter>

        {/* Reflect: the evening questions, then the same day in other years */}
        <Chapter title="Reflect">
          <Questionnaire date={date} initial={day.subjective} initialTags={day.tags ?? []} initialCompanions={day.companions ?? []} />
          <section>
            <SectionLabel>On this day</SectionLabel>
            <Fold max={240}><OnThisDay entries={yearEntries} todayDate={date} /></Fold>
            <div className="flex justify-end mt-2">
              <Link href="/journal" className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">Browse journal →</Link>
            </div>
          </section>
        </Chapter>
      </div>

      <DayAddFAB date={date} />
    </>
  );
}
