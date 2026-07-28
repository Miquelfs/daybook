export const dynamic = "force-dynamic";

import { DayView } from "@/components/DayView";
import { SyncOnLoad } from "@/components/SyncOnLoad";
import { format } from "date-fns";

export default async function TodayPage() {
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <SyncOnLoad />
      <DayView date={today} />
    </main>
  );
}
