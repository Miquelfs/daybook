export const dynamic = "force-dynamic";

import Link from "next/link";
import { Globe, PersonStanding, Database } from "lucide-react";
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
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block">
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Movement</h1>
        <p className="text-sm text-[#71717A] mt-0.5">How you got around — on foot, by bike, by road and in the air</p>
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <Link href="/explore" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Globe size={13} />Travel
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <PersonStanding size={13} />Movement
          </span>
          <Link href="/explore/databases" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Database size={13} />Databases
          </Link>
        </div>

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
