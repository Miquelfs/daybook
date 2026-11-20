"use client";

import { useState, useEffect, useCallback } from "react";
import { HealthTabs } from "@/components/health/HealthTabs";
import { Empty, PageHeader, Skeleton } from "@/components/ui/kit";
import { api, type SleepPeriod } from "@/lib/api";
import {
  CorrelationsBlock, NapsBlock, NightsBlock, PatternsBlock, SleepHero, StagesBlock, VitalsBlock,
} from "@/components/sleep/SleepSections";
import { SleepAnalysis } from "@/components/sleep/SleepAnalysis";
import { ManualSleepEntry } from "@/components/sleep/ManualSleepEntry";

const PERIODS = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

type Corr = { metric_a: string; metric_b: string; lag: number; r: number | null; n: number };

export default function SleepPage() {
  const [days, setDays] = useState(30);
  const [period, setPeriod] = useState<SleepPeriod | null>(null);
  const [corrs, setCorrs] = useState<Corr[]>([]);
  const [loading, setLoading] = useState(true);
  const corrDays = Math.max(90, days);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api.sleepPeriod(days).catch(() => null),
      api.sleepCorrelations(corrDays).catch(() => null),
    ]).then(([p, c]) => {
      setPeriod(p);
      setCorrs(c?.correlations ?? []);
      setLoading(false);
    });
  }, [days, corrDays]);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <div className="pt-8">
        <PageHeader back={{ href: "/health", label: "Health" }} title="Sleep"
                    subtitle="Every night, when you sleep, naps and what moves it"
                    right={
                      <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1">
                        {PERIODS.map((p) => (
                          <button key={p.days} onClick={() => setDays(p.days)}
                                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    days === p.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    }
                    tabs={<HealthTabs active="/health/sleep" />} />
      </div>

      <div className="mb-6">
        <ManualSleepEntry onSaved={load} />
      </div>

      {loading ? (
        <div className="space-y-8">
          <Skeleton h={150} />
          <Skeleton h={240} />
          <Skeleton h={200} />
        </div>
      ) : !period || !period.summary.nights ? (
        <Empty>No sleep recorded in this period.</Empty>
      ) : (
        <div className="space-y-8">
          <SleepHero p={period} />
          <NightsBlock p={period} />
          <StagesBlock p={period} />
          <VitalsBlock p={period} />
          <NapsBlock p={period} />
          <PatternsBlock p={period} />
          <CorrelationsBlock corrs={corrs} days={corrDays} />
          <SleepAnalysis />
        </div>
      )}
    </main>
  );
}
