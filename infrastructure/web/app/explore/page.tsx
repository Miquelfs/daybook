import Link from "next/link";
import { api } from "@/lib/api";
import { HeatMap } from "@/components/HeatMap";
import { YearSelect } from "@/components/YearSelect";
import type { TopPlace } from "@/lib/api";

interface Props {
  searchParams: Promise<{ year?: string }>;
}

const FLAG: Record<string, string> = {
  Spain: "🇪🇸", Norway: "🇳🇴", Denmark: "🇩🇰", Italy: "🇮🇹",
  France: "🇫🇷", Ireland: "🇮🇪", Germany: "🇩🇪",
  "United Kingdom": "🇬🇧", Portugal: "🇵🇹", Sweden: "🇸🇪",
  Austria: "🇦🇹", Belgium: "🇧🇪", Luxembourg: "🇱🇺",
  "Vatican City": "🇻🇦", Monaco: "🇲🇨", Morocco: "🇲🇦",
  Hungary: "🇭🇺", Bulgaria: "🇧🇬", Greece: "🇬🇷", Romania: "🇷🇴",
  "Czech Republic": "🇨🇿", Slovakia: "🇸🇰", Croatia: "🇭🇷",
  Slovenia: "🇸🇮", Switzerland: "🇨🇭", Netherlands: "🇳🇱",
  Poland: "🇵🇱", Turkey: "🇹🇷", Russia: "🇷🇺", Mexico: "🇲🇽",
  Japan: "🇯🇵", China: "🇨🇳", "United States": "🇺🇸",
};

export default async function ExplorePage({ searchParams }: Props) {
  const { year: yearStr } = await searchParams;
  const year = yearStr ? parseInt(yearStr) : undefined;

  const [data, topPlaces] = await Promise.all([
    api.heatmap(year).catch(() => ({
      points: [] as [number, number, number][],
      countries: [] as { country: string; days: number }[],
      cities: [] as { city: string; country: string; days: number }[],
      years: [] as string[],
    })),
    api.topPlaces(year).catch(() => [] as TopPlace[]),
  ]);

  const totalDays    = data.countries.reduce((s, c) => s + c.days, 0);
  const totalCountries = data.countries.length;

  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/timeline"
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
        >
          ← Timeline
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
        <div className="flex gap-3 mt-5">
          <span className="text-sm px-4 py-2 rounded-full bg-[#FAFAFA] text-[#18181B] font-medium">
            Travel
          </span>
          <Link
            href="/explore/movement"
            className="text-sm px-4 py-2 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors"
          >
            Movement
          </Link>
          <Link
            href="/explore/correlations"
            className="text-sm px-4 py-2 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors"
          >
            Correlations ✦
          </Link>
          <Link
            href="/explore/books"
            className="text-sm px-4 py-2 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors"
          >
            Books 📚
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
          <div className="flex flex-col gap-1">
            {data.countries.map((c) => {
              const pct = totalDays > 0 ? (c.days / totalDays) * 100 : 0;
              return (
                <div key={c.country} className="flex items-center gap-2">
                  <span className="text-base w-6 text-center shrink-0">
                    {FLAG[c.country] ?? "🌍"}
                  </span>
                  <span className="text-sm text-[#D4D4D8] flex-1 truncate">{c.country}</span>
                  <div className="w-20 h-1.5 rounded-full bg-[#27272A] shrink-0">
                    <div
                      className="h-full rounded-full bg-[#3B82F6]"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#52525B] tabular-nums w-8 text-right shrink-0">
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
          <div className="flex flex-col gap-1">
            {topPlaces.map((p, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">{p.place}</span>
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
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
