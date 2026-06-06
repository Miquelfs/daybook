"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { BarChart, Bar, ResponsiveContainer, Tooltip } from "recharts";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

type YearStats = {
  year: number;
  totals: { hours: number; km: number; activities: number; personal_records: number };
  weeks: { week: string; week_start: string; km: number }[];
  months: {
    month: number;
    month_name: string;
    hours: number;
    activities: number;
    daily_values: { date: string; km: number }[];
  }[];
};

export default function YearPage() {
  const params = useParams();
  const router = useRouter();
  const year = parseInt(String(params.year));
  const currentYear = new Date().getFullYear();

  const { data } = useQuery<YearStats>({
    queryKey: ["year-stats-full", year],
    queryFn: () => fetch(`${BASE}/stats/year/${year}`).then((r) => r.json()),
    enabled: !isNaN(year),
  });

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header + year nav */}
      <div className="mb-8">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <div className="flex items-center gap-4 mt-1">
          <button
            onClick={() => router.push(`/stats/year/${year - 1}`)}
            className="text-[#52525B] hover:text-[#A1A1AA] text-xl"
          >
            ←
          </button>
          <h1 className="text-2xl font-semibold tracking-tight">{year}</h1>
          {year < currentYear && (
            <button
              onClick={() => router.push(`/stats/year/${year + 1}`)}
              className="text-[#52525B] hover:text-[#A1A1AA] text-xl"
            >
              →
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {[
          { label: "Distance", value: `${data?.totals?.km ?? "—"} km` },
          { label: "Time", value: `${data?.totals?.hours ?? "—"}h` },
          { label: "Activities", value: `${data?.totals?.activities ?? "—"}` },
          { label: "Personal Records", value: `${data?.totals?.personal_records ?? "—"}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* 52-week sparkline */}
      {(data?.weeks?.length ?? 0) > 0 && (
        <div className="mb-8">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Weekly distance</p>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-3 pb-1">
            <ResponsiveContainer width="100%" height={72}>
              <BarChart data={data!.weeks} margin={{ top: 0, right: 0, bottom: 0, left: -32 }}>
                <Tooltip
                  {...TOOLTIP}
                  formatter={(v) => [`${Number(v).toFixed(1)} km`, "Distance"]}
                  labelFormatter={(l) => l}
                />
                <Bar
                  dataKey="km"
                  radius={[1, 1, 0, 0]}
                  maxBarSize={12}
                  fill="#27272A"
                  // highlight current week
                  label={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Monthly grid */}
      {(data?.months?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Monthly breakdown</p>
          <div className="grid grid-cols-3 gap-3">
            {data!.months.map((m) => (
              <div key={m.month} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3">
                <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{m.month_name}</p>
                <p className="text-sm font-semibold tabular-nums">{m.hours}h</p>
                <p className="text-xs text-[#52525B]">{m.activities} activities</p>
                {m.daily_values.length > 0 && (
                  <div className="mt-2">
                    <ResponsiveContainer width="100%" height={32}>
                      <BarChart data={m.daily_values} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <Bar dataKey="km" fill="#F59E0B" radius={[1, 1, 0, 0]} maxBarSize={6} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
