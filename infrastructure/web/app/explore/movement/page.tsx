export const dynamic = "force-dynamic";

import Link from "next/link";
import { api } from "@/lib/api";
import { MovementCharts } from "@/components/MovementCharts";

interface Props {
  searchParams: Promise<{ year?: string }>;
}

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  return `${Math.round(km)} km`;
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

  const summary = "total_km" in stats.summary ? stats.summary : null;
  const currentYear = new Date().getFullYear().toString();
  const availableYears = stats.yearly.map((y) => y.year);

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
          <h1 className="text-2xl font-semibold tracking-tight">Movement</h1>
          <p className="text-sm text-[#71717A] mt-0.5">
            {year ? `${year} — ` : "All time — "}
            {summary ? `${fmtKm(summary.total_km)} tracked across ${summary.days_tracked} days` : "No data yet"}
          </p>
          <div className="flex gap-2 mt-3">
            <Link
              href="/explore"
              className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors"
            >
              Travel
            </Link>
            <span className="text-xs px-3 py-1.5 rounded-full bg-white text-[#18181B] font-medium">
              Movement
            </span>
            <Link
              href="/explore/correlations"
              className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors"
            >
              Correlations ✦
            </Link>
          </div>
        </div>

        {/* Year filter pills */}
        <div className="flex gap-1.5 flex-wrap justify-end">
          <a
            href="/explore/movement"
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              !year ? "bg-white text-[#18181B] border-white font-medium" : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            All
          </a>
          {availableYears.map((y) => (
            <a
              key={y}
              href={`/explore/movement?year=${y}`}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                yearStr === y ? "bg-white text-[#18181B] border-white font-medium" : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              {y}
            </a>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Total</p>
            <p className="text-xl font-semibold tabular-nums">{fmtKm(summary.total_km)}</p>
          </div>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Daily avg</p>
            <p className="text-xl font-semibold tabular-nums">{fmtKm(summary.avg_km_per_day)}</p>
          </div>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Best day</p>
            <p className="text-xl font-semibold tabular-nums">{fmtKm(summary.max_km)}</p>
          </div>
        </div>
      )}

      {/* Charts — client component */}
      <MovementCharts stats={stats} year={year} />

      {/* Yearly breakdown (all-time view) */}
      {!year && stats.yearly.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">By year</h2>
          <div className="flex flex-col gap-2">
            {stats.yearly.map((y) => {
              const maxKm = Math.max(...stats.yearly.map((r) => r.total_km));
              const pct = maxKm > 0 ? (y.total_km / maxKm) * 100 : 0;
              return (
                <div key={y.year} className="flex items-center gap-3">
                  <a
                    href={`/explore/movement?year=${y.year}`}
                    className="text-xs text-[#71717A] hover:text-[#A1A1AA] tabular-nums w-10 shrink-0 transition-colors"
                  >
                    {y.year}
                  </a>
                  <div className="flex-1 h-2 rounded-full bg-[#27272A]">
                    <div
                      className="h-full rounded-full bg-[#3B82F6] transition-all"
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium tabular-nums w-20 text-right shrink-0">
                    {fmtKm(y.total_km)}
                  </span>
                  <span className="text-xs text-[#52525B] tabular-nums w-16 text-right shrink-0">
                    {y.days_with_data}d tracked
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top distance days */}
      {stats.top_days.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Top days</h2>
          <div className="flex flex-col gap-1.5">
            {stats.top_days.map((d, i) => (
              <Link
                key={d.date}
                href={`/day/${d.date}`}
                className="flex items-center gap-3 py-1 hover:opacity-80 transition-opacity"
              >
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="text-xs text-[#52525B] tabular-nums shrink-0 w-20">
                  {new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">
                  {d.top_place ?? d.top_place_city ?? "—"}
                </span>
                <span className="text-sm font-semibold tabular-nums text-[#3B82F6] shrink-0 w-16 text-right">
                  {fmtKm(d.km)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
