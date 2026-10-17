"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, Moon, Flame, AlertTriangle } from "lucide-react";
import { HealthOverview } from "@/components/health/HealthOverview";

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
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
              ← Today
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Recovery & wellness trends</p>
          </div>
          {/* Period selector */}
          <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-1">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  days === p.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* Sub-nav */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 w-full overflow-x-auto">
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Activity size={13} />Overview
          </span>
          <Link href="/health/sleep" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Moon size={13} />Sleep
          </Link>
          <Link href="/health/streaks" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Flame size={13} />Streaks
          </Link>
          <Link href="/health/injuries" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <AlertTriangle size={13} />Injuries
          </Link>
        </div>
      </div>

      <HealthOverview days={days} />
    </main>
  );
}
