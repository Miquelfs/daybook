import Link from "next/link";
import { passengerFlightsApi } from "@/lib/passenger-flights-api";
import { PassengerFlightsClient } from "./PassengerFlightsClient";

export const dynamic = "force-dynamic";

export default async function PassengerFlightsPage() {
  const [stats, flights] = await Promise.all([
    passengerFlightsApi.stats().catch(() => null),
    passengerFlightsApi.list().catch(() => []),
  ]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <Link
        href="/explore/databases"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Databases
      </Link>
      <PassengerFlightsClient initialFlights={flights} initialStats={stats} />
    </main>
  );
}
