import { RaceCockpit } from "@/components/race/RaceCockpit";

export const metadata = { title: "Mallorca 312 · Daybook" };

// The race cockpit: everything about the A-race on one screen — countdown and
// phase map, today's session, this week, the AI coach, engine and milestones.
export default function RacePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      <RaceCockpit />
    </main>
  );
}
