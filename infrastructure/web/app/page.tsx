import { api } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { format } from "date-fns";

export default async function TodayPage() {
  const day = await api.today().catch(() => null);

  if (!day) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-[#52525B]">
          Cannot reach the Daybook API. Is it running?{" "}
          <code className="text-xs bg-[#18181B] px-2 py-0.5 rounded">
            bash infrastructure/api/run.sh
          </code>
        </p>
      </main>
    );
  }

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <DayHeader date={today} />

      <div className="flex flex-col gap-12 mt-10">
        <MorningBrief
          sleep={day.sleep}
          stats={day.daily_stats}
          hrv={day.hrv}
        />

        <MovementBlock activities={day.activities} stats={day.daily_stats} />

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
