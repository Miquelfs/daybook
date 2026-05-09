import { api } from "@/lib/api";
import { DayHeader } from "@/components/DayHeader";
import { MorningBrief } from "@/components/MorningBrief";
import { MovementBlock } from "@/components/MovementBlock";
import { Questionnaire } from "@/components/Questionnaire";
import { SectionLabel } from "@/components/MorningBrief";
import { ApiOffline } from "@/components/ApiOffline";
import { format } from "date-fns";

export default async function TodayPage() {
  const day = await api.today().catch(() => null);
  const today = format(new Date(), "yyyy-MM-dd");

  if (!day) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-20">
        <DayHeader date={today} />
        <div className="mt-10">
          <ApiOffline />
        </div>
      </main>
    );
  }

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
