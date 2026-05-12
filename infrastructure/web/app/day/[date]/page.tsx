import { api } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { LocationMap } from "@/components/LocationMap";
import { DaySpendSummary } from "@/components/money/DaySpendSummary";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: Props) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const [day, tracks] = await Promise.all([
    api.day(date).catch(() => null),
    api.tracks(date).catch(() => ({ type: "FeatureCollection" as const, features: [] })),
  ]);
  if (!day) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <DayHeader date={date} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
        />

        <MovementBlock activities={day.activities} stats={day.daily_stats} />

        <DaySpendSummary date={date} />

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
                  {v.semantic_type ? ` (${v.semantic_type})` : ""}
                </span>
              ))}
            </div>
          )}
          <LocationMap geojson={tracks} />
        </section>

        <Questionnaire date={date} initial={day.subjective} />
      </div>
    </main>
  );
}
