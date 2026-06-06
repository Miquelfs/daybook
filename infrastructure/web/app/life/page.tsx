export const dynamic = "force-dynamic";

import { api } from "@/lib/api";
import { LifeGridClient } from "./LifeGridClient";
import { LifeOnboarding } from "@/components/life/LifeOnboarding";

export default async function LifePage() {
  const [gridResult, periodsResult, eventsResult] = await Promise.allSettled([
    api.lifeGrid(),
    api.lifePeriods(),
    api.lifeEvents(),
  ]);

  const grid    = gridResult.status === "fulfilled" ? gridResult.value : null;
  const periods = periodsResult.status === "fulfilled" ? periodsResult.value : [];
  const events  = eventsResult.status === "fulfilled" ? eventsResult.value : [];

  return (
    <main className="w-full px-4 pb-20 pt-6 flex flex-col items-center">
      <div className="w-full max-w-[720px]">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#FAFAFA]">Life in Weeks</h1>
          <p className="text-xs text-[#52525B] mt-0.5">90 years · 52 weeks each · one square per week</p>
        </div>

        {!grid ? (
          <LifeOnboarding />
        ) : (
          <LifeGridClient grid={grid} periods={periods} events={events} />
        )}
      </div>
    </main>
  );
}
