import { api } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: Props) {
  const { date } = await params;

  // Basic format guard before hitting API
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const day = await api.day(date).catch(() => null);
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

        <Questionnaire date={date} initial={day.subjective} />

        {/* Location strip */}
        {day.visits.length > 0 && (
          <section>
            <SectionLabel>Locations</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {day.visits.map((v, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="text-[#52525B] text-xs w-5 text-right">{i + 1}</span>
                  <span className="text-[#A1A1AA]">
                    {v.place_name ?? v.city ?? "Unknown place"}
                  </span>
                  {v.city && v.place_name !== v.city && (
                    <span className="text-[#52525B] text-xs">{v.city}</span>
                  )}
                  {v.semantic_type && (
                    <span className="ml-auto text-xs text-[#3F3F46]">{v.semantic_type}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
