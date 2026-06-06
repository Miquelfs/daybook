export const dynamic = "force-dynamic";

import { api, moodEmoji, type FlightSummary } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { LocationSection } from "@/components/LocationSection";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { PhotoOfDay } from "@/components/PhotoOfDay";
import { ScreenTimeBlock } from "@/components/ScreenTimeBlock";
import { ApiOffline } from "@/components/ApiOffline";
import { notFound } from "next/navigation";
import { format, subYears, parseISO } from "date-fns";

function flightOpColor(f: FlightSummary): { dot: string; badge: string } {
  if (f.is_sim) return { dot: "#A78BFA", badge: "bg-violet-900/40 text-violet-300" };
  const op = (f.operator || "").toLowerCase();
  if (op.includes("norwegian") || f.source === "norwegian")
    return { dot: "#EF4444", badge: "bg-red-900/40 text-red-300" };
  if (op.includes("ryanair") || f.source === "full_csv")
    return { dot: "#3B82F6", badge: "bg-blue-900/40 text-blue-300" };
  return { dot: "#71717A", badge: "bg-[#27272A] text-[#71717A]" };
}

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
  const [day, tracks, pastDay, lifeEvents, dayFlights] = await Promise.all([
    api.day(date).catch(() => null),
    api.tracks(date).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
    api.day(oneYearAgo).catch(() => null),
    api.lifeEventsOnThisDay(date).catch(() => []),
    api.flights({ start: date, end: date }).catch(() => []),
  ]);
  if (!day) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-20">
        <DayHeader date={date} />
        <div className="mt-10">
          <ApiOffline />
        </div>
      </main>
    );
  }

  const realFlights = dayFlights.filter(f => !f.is_sim);
  const totalBlockSec = realFlights.reduce((s, f) => s + (f.block_seconds ?? 0), 0);
  const totalH = Math.floor(totalBlockSec / 3600);
  const totalM = Math.floor((totalBlockSec % 3600) / 60);
  const blockLabel = totalBlockSec > 0 ? (totalM > 0 ? `${totalH}h ${totalM}m` : `${totalH}h`) : null;
  const firstFlight = realFlights[0] ?? dayFlights[0];
  const accentColor = firstFlight ? flightOpColor(firstFlight).dot : "#71717A";

  const dayFlightsSection = dayFlights.length > 0 ? (
    <section>
      <div
        className="rounded-xl px-4 py-3 mb-3 flex items-center gap-3"
        style={{ background: `${accentColor}12`, borderLeft: `3px solid ${accentColor}` }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: accentColor }}>
            {realFlights.length > 0 ? "Flight duty" : "Simulator session"}
          </p>
          {blockLabel && (
            <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums leading-tight">
              {blockLabel} <span className="text-sm font-normal text-[#52525B]">block</span>
            </p>
          )}
        </div>
        {realFlights.length > 1 && (
          <p className="text-xs text-[#71717A] shrink-0">{realFlights.length} sectors</p>
        )}
      </div>
      <div className="space-y-2">
        {dayFlights.map(f => {
          const blockSec = f.block_seconds ?? 0;
          const bH = Math.floor(blockSec / 3600);
          const bM = Math.floor((blockSec % 3600) / 60);
          const blockStr = blockSec > 0 ? (bH > 0 ? `${bH}h ${bM}m` : `${bM}m`) : "—";
          const role = f.crew_role === "pic" ? "PIC" : f.crew_role === "first_officer" ? "SIC" : f.crew_role || "—";
          const depLabel = f.is_sim ? (f.aircraft_type || "SIM") : (f.dep_icao || f.dep_iata || "?");
          const arrLabel = f.is_sim ? null : (f.arr_icao || f.arr_iata || "?");
          const depTime = f.off_block_utc ? f.off_block_utc.slice(11, 16) : "";
          const arrTime = f.on_block_utc ? f.on_block_utc.slice(11, 16) : "";
          const { dot, badge } = flightOpColor(f);
          return (
            <a key={f.id} href={`/aviation/${f.id}`}
              className="block bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-sky-900/60 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                {f.is_sim ? (
                  <span className="text-violet-300 text-sm font-mono font-semibold">{depLabel}</span>
                ) : (
                  <span className="text-sky-400 text-sm font-mono font-semibold truncate">
                    {depLabel} → {arrLabel}
                  </span>
                )}
                {f.flight_number && <span className="text-[#3F3F46] text-xs shrink-0">{f.flight_number}</span>}
                <span className={`ml-auto text-xs px-1.5 py-0.5 rounded font-mono shrink-0 ${badge}`}>{role}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[#52525B]">
                {depTime && <span className="tabular-nums">{depTime} UTC</span>}
                {arrTime && <span className="tabular-nums">→ {arrTime}</span>}
                <span className="ml-auto text-[#71717A] tabular-nums">{blockStr}</span>
              </div>
              {f.aircraft_type && (
                <p className="text-xs text-[#3F3F46] mt-0.5">
                  {f.aircraft_type}{f.aircraft_reg ? ` · ${f.aircraft_reg}` : ""}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </section>
  ) : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <DayHeader date={date} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
        />

        <MovementBlock
          activities={day.activities}
          stats={day.daily_stats}
          screenTimeSlot={<ScreenTimeBlock date={date} />}
        />

        {dayFlightsSection}

        <DaySpendSummary date={date} />

        <section>
          <SectionLabel>Photo of the day</SectionLabel>
          <PhotoOfDay date={date} initialPhotoUrl={day.photo_url ?? null} />
        </section>

        <section>
          <SectionLabel>Where I was</SectionLabel>
          <LocationSection date={date} initialTracks={tracks} editable={isEditable} />
        </section>

        <Questionnaire date={date} initial={day.subjective} initialTags={day.tags ?? []} initialCompanions={day.companions ?? []} />

        <section>
          <SectionLabel>On this day</SectionLabel>
          <div className="flex flex-col gap-3">
            {/* Life events that happened on this calendar date in past years */}
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

            {/* Mood/notes from one year ago */}
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
            ) : lifeEvents.length === 0 ? (
              <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center">
                <p className="text-sm text-[#52525B]">No data for this day in previous years</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
