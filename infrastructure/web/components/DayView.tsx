import Link from "next/link";
import { api, moodEmoji, type LifeEvent } from "@/lib/api";
import { CUISINE_EMOJI } from "@/lib/cuisines";
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
import { format, parseISO } from "date-fns";

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

  const EVENT_TYPE_COLOR: Record<string, string> = {
    career: "#60a5fa", relationship: "#f472b6", travel: "#34d399",
    loss: "#a1a1aa", achievement: "#fbbf24", other: "#a78bfa",
  };

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
          <div className="flex flex-col gap-3">
            {/* Jump to any year with something logged */}
            {yearEntries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {yearEntries.map((y) => (
                  <Link
                    key={y.date}
                    href={`/day/${y.date}`}
                    className="inline-flex items-center gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-full pl-2.5 pr-3 py-1.5 text-xs font-medium text-[#A1A1AA] hover:border-[#F59E0B]/50 hover:text-[#F59E0B] hover:bg-[#F59E0B]/[0.06] transition-colors"
                  >
                    {y.mood != null && <span>{moodEmoji(y.mood)}</span>}
                    {y.trip_city && <span title={y.trip_city}>🧳</span>}
                    {y.events.length > 0 && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: EVENT_TYPE_COLOR[y.events[0].type] ?? "#FAFAFA" }}
                      />
                    )}
                    {y.date.slice(0, 4)}
                  </Link>
                ))}
              </div>
            )}

            {/* One card per year with content, most recent first */}
            {yearEntries.map((y) => {
              const yearsAgo = parseInt(date.slice(0, 4)) - parseInt(y.date.slice(0, 4));
              return (
                <div key={y.date} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3.5 hover:border-[#3F3F46] transition-colors">
                  <Link href={`/day/${y.date}`} className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-xs text-[#52525B] uppercase tracking-widest">
                      {format(parseISO(y.date), "d MMM yyyy")}
                      <span className="text-[#3F3F46]"> · {yearsAgo} year{yearsAgo !== 1 ? "s" : ""} ago</span>
                    </span>
                    {y.mood != null && (
                      <span className="text-sm font-semibold text-[#F59E0B] shrink-0">
                        {moodEmoji(y.mood)} {y.mood}/10
                      </span>
                    )}
                  </Link>

                  {y.trip_city && (
                    <p className="text-xs text-sky-400 mb-1.5">🧳 In {y.trip_city}</p>
                  )}

                  {(y.mood_note || y.notes) && (
                    <p className="text-sm text-[#A1A1AA] italic mb-1.5">
                      &ldquo;{y.mood_note || y.notes}&rdquo;
                    </p>
                  )}

                  {y.events.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-1.5">
                      {y.events.map((ev) => (
                        <div key={ev.id} className="flex gap-2 items-start">
                          <span
                            className="inline-block h-2 w-2 rounded-full mt-1 flex-shrink-0"
                            style={{ background: EVENT_TYPE_COLOR[ev.type] ?? "#FAFAFA" }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#FAFAFA]">{ev.label}</p>
                            {ev.notes && <p className="text-xs text-[#71717A] italic">&ldquo;{ev.notes}&rdquo;</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {y.restaurants.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1.5 border-t border-[#18181B]">
                      {y.restaurants.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-sm">{CUISINE_EMOJI[r.cuisine ?? ""] ?? "🍽"}</span>
                          <span className="text-xs text-[#A1A1AA] truncate">{r.name}</span>
                          {r.city && <span className="text-xs text-[#52525B] ml-auto shrink-0">{r.city}</span>}
                          {r.rating_mf != null && (
                            <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{r.rating_mf}/10</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {y.books.length > 0 && (
                    <div className="flex flex-col gap-1 pt-1.5 border-t border-[#18181B]">
                      {y.books.map((b, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-sm">📖</span>
                          <span className="text-xs text-[#A1A1AA] truncate">{b.title}</span>
                          {b.author && <span className="text-xs text-[#52525B] ml-auto shrink-0 max-w-[80px] truncate">{b.author}</span>}
                          {b.rating != null && (
                            <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{"⭐".repeat(b.rating)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {yearEntries.length === 0 && (
              <p className="text-xs text-[#3F3F46] text-center py-4">
                Nothing recorded on this date in previous years
              </p>
            )}
          </div>
        </section>
      </div>

      <DayAddFAB date={date} />
    </>
  );
}
