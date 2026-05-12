import Link from "next/link";
import { api } from "@/lib/api";
import { HeatMap } from "@/components/HeatMap";

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

  const data = await api.heatmap(year).catch(() => ({
    points: [],
    countries: [],
    cities: [],
    years: [],
  }));

  const totalDays    = data.countries.reduce((s, c) => s + c.days, 0);
  const totalCountries = data.countries.length;

  return (
    <main className="max-w-3xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <Link
            href="/timeline"
            className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block"
          >
            ← Timeline
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          <p className="text-sm text-[#71717A] mt-0.5">
            {year ? `${year} — ` : "All time — "}
            {totalCountries} {totalCountries === 1 ? "country" : "countries"} · {totalDays.toLocaleString()} days recorded
          </p>
        </div>

        {/* Year filter pills */}
        <div className="flex gap-1.5 flex-wrap justify-end">
          <a
            href="/explore"
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              !year
                ? "bg-white text-[#18181B] border-white font-medium"
                : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            All
          </a>
          {data.years.map((y) => (
            <a
              key={y}
              href={`/explore?year=${y}`}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                yearStr === y
                  ? "bg-white text-[#18181B] border-white font-medium"
                  : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              {y}
            </a>
          ))}
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
    </main>
  );
}
