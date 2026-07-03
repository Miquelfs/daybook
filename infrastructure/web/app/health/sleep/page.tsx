"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Activity, Moon, Dumbbell, Flame, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { SleepOverview } from "@/components/sleep/SleepOverview";
import { SleepPatterns } from "@/components/sleep/SleepPatterns";
import { SleepAnalysis } from "@/components/sleep/SleepAnalysis";

const PERIODS = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

export default function SleepPage() {
  const [selectedDays, setSelectedDays] = useState(30);
  const [summary, setSummary] = useState<Record<string, number | null> | null>(null);
  const [stages, setStages] = useState<Record<string, number | null>[]>([]);
  const [correlations, setCorrelations] = useState<{ correlations: { metric_a: string; metric_b: string; lag: number; r: number | null; n: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.sleepSummary(selectedDays).catch(() => null),
      api.sleepStages(selectedDays * 2).catch(() => []),
      api.sleepCorrelations(selectedDays * 3).catch(() => null),
    ]).then(([s, st, c]) => {
      setSummary(s);
      setStages(st ?? []);
      setCorrelations(c);
      setLoading(false);
    });
  }, [selectedDays]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      {/* Header */}
      <div className="pt-8 pb-6">
        <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Health
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sleep</h1>
            <p className="text-sm text-[#71717A] mt-1">Stage analysis, debt tracking and patterns</p>
          </div>
          {/* Period selector */}
          <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-1">
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setSelectedDays(p.days)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${selectedDays === p.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-nav */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <Link href="/health" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Activity size={13} />Overview
          </Link>
          <Link href="/training" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Dumbbell size={13} />Training
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Moon size={13} />Sleep
          </span>
          <Link href="/health/streaks" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Flame size={13} />Streaks
          </Link>
          <Link href="/health/injuries" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <AlertTriangle size={13} />Injuries
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-[#111113] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          <SleepOverview summary={summary} stages={stages} />
          <SleepPatterns summary={summary} correlations={correlations} stages={stages} />
          <SleepAnalysis />
        </div>
      )}
    </main>
  );
}
