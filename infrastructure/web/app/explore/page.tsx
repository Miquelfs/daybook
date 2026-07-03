import Link from "next/link";
import { ChevronRight, Globe, PersonStanding, Database } from "lucide-react";
import { api } from "@/lib/api";
import { HeatMap } from "@/components/HeatMap";
import { YearSelect } from "@/components/YearSelect";
import type { TopPlace, CityStay } from "@/lib/api";

interface Props {
  searchParams: Promise<{ year?: string }>;
}

const FLAG: Record<string, string> = {
  // Europe
  Spain: "🇪🇸", France: "🇫🇷", Germany: "🇩🇪", Italy: "🇮🇹",
  Portugal: "🇵🇹", Netherlands: "🇳🇱", Belgium: "🇧🇪", Luxembourg: "🇱🇺",
  Switzerland: "🇨🇭", Austria: "🇦🇹", Ireland: "🇮🇪", "United Kingdom": "🇬🇧",
  Norway: "🇳🇴", Sweden: "🇸🇪", Denmark: "🇩🇰", Finland: "🇫🇮",
  Iceland: "🇮🇸", Poland: "🇵🇱", "Czech Republic": "🇨🇿", Slovakia: "🇸🇰",
  Hungary: "🇭🇺", Romania: "🇷🇴", Bulgaria: "🇧🇬", Croatia: "🇭🇷",
  Slovenia: "🇸🇮", Serbia: "🇷🇸", Greece: "🇬🇷", Turkey: "🇹🇷",
  Monaco: "🇲🇨", "Vatican City": "🇻🇦", "San Marino": "🇸🇲",
  Malta: "🇲🇹", Cyprus: "🇨🇾", Estonia: "🇪🇪", Latvia: "🇱🇻",
  Lithuania: "🇱🇹", Ukraine: "🇺🇦", Belarus: "🇧🇾", Russia: "🇷🇺",
  Moldova: "🇲🇩", Albania: "🇦🇱", "North Macedonia": "🇲🇰",
  "Bosnia and Herzegovina": "🇧🇦", Montenegro: "🇲🇪", Kosovo: "🇽🇰",
  // Africa & Middle East
  Morocco: "🇲🇦", Tunisia: "🇹🇳", Egypt: "🇪🇬", "South Africa": "🇿🇦",
  "United Arab Emirates": "🇦🇪", Israel: "🇮🇱", Jordan: "🇯🇴",
  Lebanon: "🇱🇧", Qatar: "🇶🇦", Kuwait: "🇰🇼", Bahrain: "🇧🇭",
  // Americas
  "United States": "🇺🇸", Canada: "🇨🇦", Mexico: "🇲🇽",
  Brazil: "🇧🇷", Argentina: "🇦🇷", Colombia: "🇨🇴", Chile: "🇨🇱",
  Peru: "🇵🇪", Cuba: "🇨🇺", "Dominican Republic": "🇩🇴",
  // Asia & Pacific
  Japan: "🇯🇵", China: "🇨🇳", "South Korea": "🇰🇷", India: "🇮🇳",
  Thailand: "🇹🇭", Vietnam: "🇻🇳", Singapore: "🇸🇬", Indonesia: "🇮🇩",
  Malaysia: "🇲🇾", Philippines: "🇵🇭", Australia: "🇦🇺", "New Zealand": "🇳🇿",
};

export default async function ExplorePage({ searchParams }: Props) {
  const { year: yearStr } = await searchParams;
  const year = yearStr ? parseInt(yearStr) : undefined;

  const [data, topPlaces, cityTimeline] = await Promise.all([
    api.heatmap(year).catch(() => ({
      points: [] as [number, number, number][],
      countries: [] as { country: string; days: number }[],
      cities: [] as { city: string; country: string; days: number }[],
      years: [] as string[],
    })),
    api.topPlaces(year).catch(() => [] as TopPlace[]),
    api.cityTimeline(year).catch(() => [] as CityStay[]),
  ]);

  const totalDays      = data.countries.reduce((s, c) => s + c.days, 0);
  const totalCountries = data.countries.length;
  const mostVisited    = data.countries.length > 0 ? data.countries[0] : null;

  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-8 relative z-20">
        <Link
          href="/"
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
        >
          ← Today
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
            <p className="text-sm text-[#71717A] mt-1">
              {year ? `${year}` : "All time"} — {totalCountries} {totalCountries === 1 ? "country" : "countries"} · {totalDays.toLocaleString()} days
            </p>
          </div>

          {/* Year dropdown */}
          <div className="shrink-0 mt-1">
            <YearSelect years={data.years} current={yearStr} />
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Globe size={13} />Travel
          </span>
          <Link href="/explore/movement" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <PersonStanding size={13} />Movement
          </Link>
          <Link href="/explore/databases" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Database size={13} />Databases
          </Link>
        </div>
      </div>

      {/* Heatmap */}
      <section className="mb-8">
        <HeatMap data={data} />
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Countries */}
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Countries</h2>

          {/* KPI stats */}
          {(totalDays > 0 || mostVisited) && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-[#18181B] rounded-lg p-3">
                <p className="text-xs text-[#52525B] uppercase tracking-wider mb-1">Days abroad</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: "#F59E0B" }}>{totalDays.toLocaleString()}</p>
              </div>
              {mostVisited && (
                <div className="bg-[#18181B] rounded-lg p-3">
                  <p className="text-xs text-[#52525B] uppercase tracking-wider mb-1">Most visited</p>
                  <p className="text-lg font-semibold truncate" style={{ color: "#F59E0B" }}>
                    {FLAG[mostVisited.country] ?? "🌍"} {mostVisited.country}
                  </p>
                  <p className="text-xs text-[#52525B] tabular-nums">{mostVisited.days}d</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            {data.countries.map((c, idx) => {
              const pct = totalDays > 0 ? (c.days / totalDays) * 100 : 0;
              const isTop3 = idx < 3;
              return (
                <div key={c.country} className="flex items-center gap-2">
                  <span className="text-base w-6 text-center shrink-0">
                    {FLAG[c.country] ?? "🌍"}
                  </span>
                  <span className="text-sm text-[#D4D4D8] flex-1 truncate">{c.country}</span>
                  <div className="w-20 h-1.5 rounded-full bg-[#27272A] shrink-0">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(pct, 2)}%`, background: "#F59E0B" }}
                    />
                  </div>
                  <span
                    className="text-xs tabular-nums w-8 text-right shrink-0"
                    style={{ color: isTop3 ? "#F59E0B" : "#52525B" }}
                  >
                    {c.days}d
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top cities */}
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Cities</h2>
          <div className="flex flex-col gap-1">
            {data.cities.slice(0, 20).map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">{c.city}</span>
                <span className="text-xs text-[#52525B] truncate max-w-[80px]">
                  {FLAG[c.country] ?? ""} {c.country}
                </span>
                <span className="text-xs text-[#52525B] tabular-nums w-8 text-right shrink-0">
                  {c.days}d
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Most visited places */}
      {topPlaces.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Most visited places</h2>
          <div className="flex flex-col">
            {topPlaces.map((p, i) => (
              <Link
                key={i}
                href={`/explore/place/${encodeURIComponent(p.place)}`}
                className="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-[#18181B] transition-colors group"
              >
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate group-hover:text-[#FAFAFA] transition-colors">{p.place}</span>
                {p.city && (
                  <span className="text-xs text-[#52525B] truncate max-w-[100px]">
                    {p.city}
                  </span>
                )}
                <span className="text-xs text-[#3F3F46] tabular-nums shrink-0">
                  {p.total_hours > 0 ? `${p.total_hours}h` : ""}
                </span>
                <span className="text-xs text-[#52525B] tabular-nums w-8 text-right shrink-0">
                  {p.days}d
                </span>
                <ChevronRight size={12} className="text-[#3F3F46] group-hover:text-[#71717A] transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* City timeline */}
      {cityTimeline.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Travel log</h2>
          <div className="flex flex-col gap-1.5">
            {cityTimeline.slice(0, 40).map((stay, i) => {
              const sameDay = stay.first_date === stay.last_date;
              const dateLabel = sameDay
                ? new Date(stay.first_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : `${new Date(stay.first_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(stay.last_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#18181B] transition-colors">
                  <span className="text-base w-6 text-center shrink-0">{FLAG[stay.country] ?? "🌍"}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-[#D4D4D8] font-medium">{stay.city}</span>
                    <span className="text-xs text-[#52525B] ml-2">{stay.country}</span>
                  </div>
                  <span className="text-xs text-[#52525B] tabular-nums shrink-0">{dateLabel}</span>
                  <span className="text-xs text-[#F59E0B] tabular-nums w-8 text-right shrink-0">{stay.days}d</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
