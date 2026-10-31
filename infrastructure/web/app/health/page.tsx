"use client";

import { useState } from "react";
import Link from "next/link";
import { HealthTabs } from "@/components/health/HealthTabs";
import { PageHeader } from "@/components/ui/kit";
import { HealthOverview } from "@/components/health/HealthOverview";
import { AreaPlan } from "@/components/plan/AreaPlan";

const PERIODS = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

export default function HealthPage() {
  const [days, setDays] = useState(30);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <PageHeader title="Health" subtitle="Recovery & wellness trends"
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
                  tabs={<HealthTabs active="/health" />} />

      <AreaPlan area="health" className="mb-6" />

      <HealthOverview days={days} />
    </main>
  );
}
