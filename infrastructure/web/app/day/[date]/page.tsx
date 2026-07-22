export const dynamic = "force-dynamic";

import { api, moodEmoji } from "@/lib/api";
import { booksApi } from "@/lib/books-api";
import { showsApi } from "@/lib/shows-api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { DayFlights } from "@/components/DayFlights";
import { DayRosterBadge } from "@/components/DayRosterBadge";
import { SectionLabel } from "@/components/MorningBrief";
import { LocationSection } from "@/components/LocationSection";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { DayRestaurants } from "@/components/DayRestaurants";
import { DayShows } from "@/components/DayShows";
import { DayBooks } from "@/components/DayBooks";
import { PhotoOfDay } from "@/components/PhotoOfDay";
import { ScreenTimeBlock } from "@/components/ScreenTimeBlock";
import { ApiOffline } from "@/components/ApiOffline";
import { DayAddFAB } from "@/components/DayAddFAB";
import { DayTraining } from "@/components/DayTraining";
import { notFound } from "next/navigation";
import { format, subYears, parseISO } from "date-fns";

const TYPE_EMOJI: Record<string, string> = { movie: "🎬", show: "📺", documentary: "🎞" };

interface Props {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: Props) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const isEditable = date === today || date === yesterday;

  const oneYearAgo = format(subYears(parseISO(date), 1), "yyyy-MM-dd");
  const mmdd = date.slice(5); // MM-DD for cross-year lookups

  const API_BASE =
    process.env.API_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";

  const [day, tracks, pastDay, lifeEvents,
    pastRestaurants, pastBooks, pastShows, morningBriefData, trainingDay] = await Promise.all([
    api.day(date).catch(() => null),
    api.tracks(date).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.day(oneYearAgo).catch(() => null),
    api.lifeEventsOnThisDay(date).catch(() => []),
    // Past year data for "On this day"
    api.restaurants({ date: oneYearAgo }).catch(() => []),
    booksApi.list({ date: oneYearAgo }).catch(() => []),
    showsApi.list({ date: oneYearAgo }).catch(() => []),
    api.morningBrief(date).catch(() => null),
    fetch(`${API_BASE}/race-plans/day/${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  if (!day) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-20">
        <DayHeader date={date} />
        <div className="mt-10">
          <ApiOffline />
        </div>
        <DayAddFAB date={date} />
      </main>
    );
  }

  const hasPastMemories = pastDay?.subjective.mood || pastRestaurants.length > 0 || pastBooks.length > 0 || pastShows.length > 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <DayHeader date={date} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
          loadIndex={day.load_index}
          brief={morningBriefData?.brief ?? null}
        />

        <DayTraining initialPrescription={trainingDay} date={date} />

        <MovementBlock
          activities={day.activities}
          stats={day.daily_stats}
          screenTimeSlot={<ScreenTimeBlock date={date} />}
        />

        <DayRosterBadge date={date} />

        <DayFlights date={date} />

        <DaySpendSummary date={date} />

<DayRestaurants date={date} />
        <DayShows date={date} />
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

        <section>
          <SectionLabel>On this day</SectionLabel>
          <div className="flex flex-col gap-3">
            {/* Life events */}
            {lifeEvents.map((ev) => {
              const evYear = ev.event_date.slice(0, 4);
              const yearsAgo = parseInt(date.slice(0, 4)) - parseInt(evYear);
              const typeColor: Record<string, string> = {
                career: "#60a5fa", relationship: "#f472b6", travel: "#34d399",
                loss: "#a1a1aa", achievement: "#fbbf24", other: "#a78bfa",
              };
              return (
                <div key={ev.id} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3.5 flex gap-3 items-start">
                  <span
                    className="inline-block h-2 w-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: typeColor[ev.type] ?? "#FAFAFA" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#FAFAFA]">{ev.label}</p>
                    <p className="text-xs text-[#52525B] mt-0.5">
                      {ev.event_date}
                      {yearsAgo > 0 && <span className="text-[#3F3F46]"> · {yearsAgo} year{yearsAgo !== 1 ? "s" : ""} ago</span>}
                      <span className="text-[#27272A]"> · {ev.type}</span>
                    </p>
                    {ev.notes && (
                      <p className="text-xs text-[#71717A] mt-1 italic">&ldquo;{ev.notes}&rdquo;</p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* One year ago card */}
            {hasPastMemories && (
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 space-y-3">
                <p className="text-xs text-[#52525B] uppercase tracking-widest">
                  {format(parseISO(oneYearAgo), "d MMM yyyy")} · one year ago
                </p>

                {pastDay?.subjective.mood && (
                  <div className="space-y-0.5">
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
                )}

                {pastRestaurants.length > 0 && (
                  <div className="flex flex-col gap-1 pt-1 border-t border-[#18181B]">
                    {pastRestaurants.map((r) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <span className="text-sm">🍽</span>
                        <span className="text-xs text-[#A1A1AA] truncate">{r.name}</span>
                        {r.city && <span className="text-xs text-[#52525B] ml-auto shrink-0">{r.city}</span>}
                        {r.rating_mf != null && (
                          <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{r.rating_mf}/10</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {pastShows.length > 0 && (
                  <div className="flex flex-col gap-1 pt-1 border-t border-[#18181B]">
                    {pastShows.map((s) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-sm">{TYPE_EMOJI[s.type ?? ""] ?? "🎬"}</span>
                        <span className="text-xs text-[#A1A1AA] truncate">{s.title}</span>
                        {s.platform && <span className="text-xs text-[#52525B] ml-auto shrink-0">{s.platform}</span>}
                        {s.rating_mf != null && (
                          <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{s.rating_mf}/10</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {pastBooks.length > 0 && (
                  <div className="flex flex-col gap-1 pt-1 border-t border-[#18181B]">
                    {pastBooks.map((b) => (
                      <div key={b.id} className="flex items-center gap-2">
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
            )}

            {/* Empty state — only when truly nothing */}
            {lifeEvents.length === 0 && !hasPastMemories && (
              <p className="text-xs text-[#3F3F46] text-center py-4">
                Nothing recorded on this date in previous years
              </p>
            )}
          </div>
        </section>
      </div>

      <DayAddFAB date={date} />
    </main>
  );
}
