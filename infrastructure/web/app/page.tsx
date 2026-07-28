export const dynamic = "force-dynamic";

import Link from "next/link";
import { api, moodEmoji } from "@/lib/api";
import { booksApi } from "@/lib/books-api";
import { showsApi } from "@/lib/shows-api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { ApiOffline } from "@/components/ApiOffline";
import { LocationSection } from "@/components/LocationSection";
import { SyncOnLoad } from "@/components/SyncOnLoad";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { DayRosterBadge } from "@/components/DayRosterBadge";
import { DayFlights } from "@/components/DayFlights";
import { DayRestaurants } from "@/components/DayRestaurants";
import { DayShows } from "@/components/DayShows";
import { DayBooks } from "@/components/DayBooks";
import { DayAddFAB } from "@/components/DayAddFAB";
import { PhotoOfDay } from "@/components/PhotoOfDay";
import { ScreenTimeBlock } from "@/components/ScreenTimeBlock";
import { DayTraining } from "@/components/DayTraining";
import { format, subYears, parseISO } from "date-fns";

const TYPE_EMOJI: Record<string, string> = { movie: "🎬", show: "📺", documentary: "🎞" };

export default async function TodayPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const oneYearAgo = format(subYears(new Date(), 1), "yyyy-MM-dd");

  const [day, tracks, pastDay, morningBriefData, aiStatus,
    lifeEvents, pastRestaurants, pastBooks, pastShows] = await Promise.all([
    api.today().catch((e) => { console.error("[TodayPage] api.today() failed:", e?.message ?? e); return null; }),
    api.tracks(today).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.day(oneYearAgo).catch(() => null),
    api.morningBrief(today).catch(() => null),
    api.aiStatus().catch(() => null),
    // "On this day" — life events (any year) + last-year restaurants/books/shows
    api.lifeEventsOnThisDay(today).catch(() => []),
    api.restaurants({ date: oneYearAgo }).catch(() => []),
    booksApi.list({ date: oneYearAgo }).catch(() => []),
    showsApi.list({ date: oneYearAgo }).catch(() => []),
  ]);

  const hasPastMemories = pastDay?.subjective.mood || pastRestaurants.length > 0 || pastBooks.length > 0 || pastShows.length > 0;

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
          loadIndex={day.load_index}
          brief={morningBriefData?.brief ?? null}
          aiAvailable={aiStatus?.ollama_available ?? false}
        />

        <DayTraining initialPrescription={null} date={today} />

        <MovementBlock
          activities={day.activities}
          stats={day.daily_stats}
          screenTimeSlot={<ScreenTimeBlock date={today} />}
        />

        <DayRosterBadge date={today} />

        <DayFlights date={today} />

        <DaySpendSummary date={today} />

        <DayRestaurants date={today} />
        <DayShows date={today} />
        <DayBooks date={today} />

        <section>
          <SectionLabel>Photo of the day</SectionLabel>
          <PhotoOfDay date={today} initialPhotoUrl={day.photo_url ?? null} initialCaption={day.subjective.photo_caption ?? null} />
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
          <div className="flex flex-col gap-3">
            {/* Life events (any year) */}
            {lifeEvents.map((ev) => {
              const evYear = ev.event_date.slice(0, 4);
              const yearsAgo = parseInt(today.slice(0, 4)) - parseInt(evYear);
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

            {lifeEvents.length === 0 && !hasPastMemories && (
              <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center">
                <p className="text-sm text-[#52525B]">No data for this day last year</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <DayAddFAB date={today} />
    </main>
  );
}
