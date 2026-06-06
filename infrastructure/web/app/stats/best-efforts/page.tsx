"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type PR = {
  target_label: string;
  distance_meters: number;
  duration_seconds: number;
  activity_id: string;
  date: string;
  activity_name: string | null;
};

function fmtTime(s: number) {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtPaceLabel(s: number, distM: number) {
  const secPerKm = s / (distM / 1000);
  const m = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${m}:${String(sec).padStart(2, "0")} /km`;
}

export default function BestEffortsPage() {
  const [year, setYear] = useState<number | null>(null);

  const { data: prs = [] } = useQuery<PR[]>({
    queryKey: ["best-efforts", year],
    queryFn: () =>
      fetch(`${BASE}/stats/best-efforts${year ? `?year=${year}` : ""}`).then((r) => r.json()),
  });

  const years = useMemo(() => {
    const ys = [...new Set(prs.map((p) => parseInt(p.date.slice(0, 4))))].sort((a, b) => b - a);
    return ys;
  }, [prs]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Best Efforts</h1>
        <p className="text-sm text-[#71717A] mt-0.5">All-time fastest times across standard distances</p>
      </div>

      {/* Year filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setYear(null)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            year === null
              ? "bg-[#F59E0B] text-black border-[#F59E0B] font-medium"
              : "bg-transparent text-[#71717A] border-[#27272A] hover:border-[#3F3F46]"
          }`}
        >
          All time
        </button>
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              year === y
                ? "bg-[#F59E0B] text-black border-[#F59E0B] font-medium"
                : "bg-transparent text-[#71717A] border-[#27272A] hover:border-[#3F3F46]"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {prs.length === 0 ? (
        <div className="text-center py-16 text-[#52525B] text-sm">
          No PRs yet — run a synced activity with GPS streams to compute best efforts.
        </div>
      ) : (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
          {prs.map((pr) => (
            <div key={pr.target_label} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA]">{pr.target_label}</p>
                <p className="text-xs text-[#52525B] mt-0.5">
                  {format(new Date(pr.date), "d MMM yyyy")}
                  {pr.activity_name ? ` · ${pr.activity_name}` : ""}
                </p>
              </div>
              <div className="text-right ml-4 shrink-0">
                <p className="text-sm font-semibold tabular-nums text-[#F59E0B]">{fmtTime(pr.duration_seconds)}</p>
                <p className="text-xs text-[#52525B] tabular-nums">{fmtPaceLabel(pr.duration_seconds, pr.distance_meters)}</p>
              </div>
              <Link
                href={`/activity/${encodeURIComponent(pr.activity_id)}`}
                className="ml-3 text-[#52525B] hover:text-[#A1A1AA] text-xs shrink-0"
              >
                →
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
