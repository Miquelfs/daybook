export const dynamic = "force-dynamic";

import { DayView } from "@/components/DayView";
import { SyncOnLoad } from "@/components/SyncOnLoad";
import { SystemHealthBanner } from "@/components/system/SystemStatus";
import { cookies } from "next/headers";
import { todayIn } from "@/lib/dates";

export default async function TodayPage() {
  // Your local date (tz cookie from the device), not the Pi's Spanish clock
  const today = todayIn((await cookies()).get("tz")?.value);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <SyncOnLoad />
      {/* Silent unless a sync is failing / data is stale / backups or disk need attention */}
      <SystemHealthBanner />
      <DayView date={today} />
    </main>
  );
}
