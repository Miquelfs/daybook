export const dynamic = "force-dynamic";

import Link from "next/link";
import { ExploreTabs } from "@/components/explore/ExploreTabs";
import { PageHeader } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { MovementModes } from "@/components/explore/MovementModes";

interface Props {
  searchParams: Promise<{ year?: string }>;
}

export default async function MovementPage({ searchParams }: Props) {
  const { year: yearStr } = await searchParams;
  const year = yearStr ? parseInt(yearStr) : undefined;

  const stats = await api.movementStats(year).catch(() => ({
    yearly: [],
    monthly: [],
    weekly: [],
    top_days: [],
    summary: {},
  }));

  const availableYears = stats.yearly.map((y) => y.year);

  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <PageHeader title="Movement" subtitle="How you got around — on foot, by bike, by road and in the air"
                    tabs={<ExploreTabs active="/explore/movement" />} />

        {/* Year pills */}
        <div className="flex gap-1.5 mt-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ y: null as string | null, label: "All time" }, ...availableYears.map((y) => ({ y, label: y }))].map(({ y, label }) => {
            const on = (y ?? undefined) === yearStr;
            return (
              <Link key={label} href={y ? `/explore/movement?year=${y}` : "/explore/movement"}
                    className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-colors tabular-nums ${on
                      ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      <MovementModes year={year} />
    </main>
  );
}
