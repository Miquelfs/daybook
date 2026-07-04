import Link from "next/link";
import { ChevronRight, Globe, PersonStanding, Database } from "lucide-react";
import { api } from "@/lib/api";
import { HeatMap } from "@/components/HeatMap";
import { YearSelect } from "@/components/YearSelect";
import type { TopPlace, CityStay, WorldCoverage, FunFactCard, Trip } from "@/lib/api";

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

  const [data, topPlaces, cityTimeline, coverage, funFacts, tripsData] = await Promise.all([
    api.heatmap(year).catch(() => ({
      points: [] as [number, number, number][],
      countries: [] as { country: string; days: number }[],
      cities: [] as { city: string; country: string; days: number }[],
      years: [] as string[],
      distinct_days: 0,
    })),
    api.topPlaces(year).catch(() => [] as TopPlace[]),
    api.cityTimeline(year).catch(() => [] as CityStay[]),
    api.worldCoverage(year).catch(() => null as WorldCoverage | null),
    api.funFacts(year).catch(() => null as { cards: FunFactCard[] } | null),
    api.trips(100, year).catch(() => null as { trips: Trip[]; total: number } | null),
  ]);

  // Distinct days with location data — per-country counts overlap, so summing
  // them double-counts multi-country days.
  const totalDays      = data.distinct_days ?? 0;
  const totalCountries = data.countries.length;
  const mostVisited    = data.countries.length > 0 ? data.countries[0] : null;

  // Trips grouped by year for the gallery (newest year first)
  const tripsByYear = new Map<string, Trip[]>();
  for (const t of tripsData?.trips ?? []) {
    const y = t.start_date.slice(0, 4);
    if (!tripsByYear.has(y)) tripsByYear.set(y, []);
    tripsByYear.get(y)!.push(t);
  }

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

      {/* World coverage */}
      {coverage && coverage.countries_visited > 0 && (
        <section className="mb-8">
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest">World coverage</p>
              <p className="text-sm tabular-nums">
                <span className="text-[#F59E0B] font-semibold">{coverage.countries_visited}</span>
                <span className="text-[#52525B]"> of {coverage.countries_total} countries · </span>
                <span className="text-[#FAFAFA] font-semibold">{coverage.pct_world}%</span>
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-[#18181B] mb-4">
              <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.max(coverage.pct_world, 1)}%` }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {Object.entries(coverage.continents)
                .filter(([cont]) => cont !== "Unknown")
                .map(([cont, c]) => (
                  <div key={cont} className="flex items-center justify-between gap-2" title={c.visited.join(", ") || "none yet"}>
                    <span className="text-xs text-[#71717A] truncate">{cont}</span>
                    <span className="text-xs tabular-nums shrink-0" style={{ color: c.visited_count > 0 ? "#A1A1AA" : "#3F3F46" }}>
                      {c.visited_count}/{c.total}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </section>
      )}

      {/* Fun facts strip */}
      {funFacts && funFacts.cards.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Fun facts</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {funFacts.cards.map((c) => (
              <div
                key={c.label}
                className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 min-w-[170px] shrink-0"
                title={c.subtitle}
              >
                <p className="text-lg leading-none mb-1.5">{c.icon}</p>
                <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums truncate max-w-[180px]">
                  {c.value}{c.unit ? <span className="text-xs text-[#52525B] font-normal"> {c.unit}</span> : null}
                </p>
                <p className="text-[10px] text-[#71717A] uppercase tracking-wider mt-0.5">{c.label}</p>
                <p className="text-[10px] text-[#3F3F46] mt-0.5 truncate max-w-[180px]">{c.subtitle}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trips — nights away from home, grouped by year, tap → first day */}
      {tripsData && tripsData.trips.length > 0 && (
        <section className="mb-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest">
              Trips{year ? ` in ${year}` : ""}
            </h2>
            <span className="text-xs text-[#3F3F46] tabular-nums">
              {tripsData.total} · nights not slept at home
            </span>
          </div>
          <div className="flex flex-col gap-4">
            {[...tripsByYear.entries()].map(([y, trips]) => (
              <div key={y}>
                {!year && (
                  <p className="text-xs text-[#71717A] tabular-nums mb-2">
                    {y} <span className="text-[#3F3F46]">· {trips.length} trips · {trips.reduce((s, t) => s + t.n_nights, 0)} nights away</span>
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {trips.map((t) => (
                    <Link
                      key={t.id}
                      href={`/day/${t.start_date}`}
                      className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-[#3F3F46] transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-[#D4D4D8] group-hover:text-[#FAFAFA] font-medium truncate transition-colors">
                          {FLAG[t.primary_country ?? ""] ?? "🌍"} {t.name}
                        </p>
                        {t.max_distance_from_home_km != null && (
                          <span className="text-[10px] text-[#3F3F46] tabular-nums shrink-0">
                            {Math.round(t.max_distance_from_home_km)} km out
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#52525B] mt-0.5">
                        {new Date(t.start_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        {" – "}
                        {new Date(t.end_date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {t.cities.length > 0 && (
                          <span className="text-[#3F3F46]"> · {t.cities.slice(0, 3).join(", ")}</span>
                        )}
                        {t.home_at_start && (
                          <span className="text-[#3F3F46]"> · from {t.home_at_start}</span>
                        )}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Countries */}
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Countries</h2>

          {/* KPI stats */}
          {(totalDays > 0 || mostVisited) && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-[#18181B] rounded-lg p-3">
                <p className="text-xs text-[#52525B] uppercase tracking-wider mb-1">Days tracked</p>
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
