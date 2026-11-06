import { ActivityList } from "@/components/activities/ActivityList";

export const metadata = { title: "Activities · Daybook" };

export default function ActivitiesPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <ActivityList />
    </main>
  );
}
