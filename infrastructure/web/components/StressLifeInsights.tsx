"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Plane, MapPin } from "lucide-react";
import {
  wellnessApi, type StressContexts, type FlightPhysioRollup, type StressByCity,
} from "@/lib/wellness-api";

const CTX_EMOJI: Record<string, string> = {
  "in-flight": "✈️", exercise: "🏃", airport: "🛫", home: "🏠", elsewhere: "📍",
};
const CTX_LABEL: Record<string, string> = {
  "in-flight": "In flight", exercise: "Exercise", airport: "Airport", home: "Home", elsewhere: "Elsewhere",
};

// Stress reads 0-100; colour the bar by intensity.
function stressColor(v: number): string {
  if (v >= 60) return "#F97316";
  if (v >= 40) return "#FB923C";
  if (v >= 25) return "#FBBF24";
  return "#34D399";
}
function deltaColor(v: number): string {
  if (v >= 15) return "#F87171";
  if (v <= -5) return "#34D399";
  return "#A1A1AA";
}

const fmtDur = (min: number) => (min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`);

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-[#E4E4E7]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function WhatStressesYou() {
  const { data } = useQuery<StressContexts>({
    queryKey: ["stress-contexts", 90],
    queryFn: () => wellnessApi.stressContexts(90),
    staleTime: 300_000,
  });
  const rows = data?.contexts ?? [];
  const max = Math.max(60, ...rows.map((r) => r.avg_stress));

  return (
    <Card title="What stresses you" icon={<Activity size={15} className="text-[#F97316]" />}>
      <p className="text-[11px] text-[#52525B] mb-3">Average stress by what you were doing · last 90 days</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No context data yet — it fills in as the CIRQA syncs.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.context}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#D4D4D8]">{CTX_EMOJI[r.context] ?? "•"} {CTX_LABEL[r.context] ?? r.context}</span>
                <span className="tabular-nums text-[#71717A]">
                  <span className="font-semibold text-[#E4E4E7]">{r.avg_stress}</span> · {fmtDur(r.minutes)} · {r.days}d
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.avg_stress / max) * 100}%`, background: stressColor(r.avg_stress) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function StressfulPlaces() {
  const { data } = useQuery<StressByCity>({
    queryKey: ["stress-by-city", 180],
    queryFn: () => wellnessApi.stressByCity(180),
    staleTime: 300_000,
  });
  const rows = data?.cities ?? [];
  const max = Math.max(8, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <Card title="Stressful places" icon={<MapPin size={15} className="text-[#F97316]" />}>
      <p className="text-[11px] text-[#52525B] mb-3">
        Stress vs your baseline{data?.baseline != null ? ` (${data.baseline})` : ""}, by city · last 180 days · home excluded
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No away-from-home place data yet — builds from your GPS visits as the CIRQA syncs.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, 12).map((r) => (
            <div key={r.city}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#D4D4D8] truncate">
                  📍 {r.city}
                  {r.country && r.country !== "España" && <span className="text-[#52525B]"> · {r.country}</span>}
                </span>
                <span className="tabular-nums text-[#71717A]">
                  <span className="font-semibold" style={{ color: deltaColor(r.delta) }}>
                    {r.delta > 0 ? "+" : ""}{r.delta}
                  </span> · {fmtDur(r.minutes)} · {r.days}d
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.delta) / max) * 100}%`, background: deltaColor(r.delta) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const BY_OPTIONS: { key: "airport" | "phase" | "captain"; label: string }[] = [
  { key: "airport", label: "Airport" },
  { key: "phase", label: "Phase" },
  { key: "captain", label: "Captain" },
];

function FlightLoadRollup() {
  const [by, setBy] = useState<"airport" | "phase" | "captain">("airport");
  const { data } = useQuery<FlightPhysioRollup>({
    queryKey: ["flight-physio-rollup", by],
    queryFn: () => wellnessApi.flightPhysioRollup(by),
    staleTime: 300_000,
  });
  const rows = data?.buckets ?? [];
  const max = Math.max(20, ...rows.map((r) => Math.abs(r.avg_stress_delta)));

  return (
    <Card title="Flight load" icon={<Plane size={15} className="text-[#60A5FA]" />}>
      <div className="flex gap-1 mb-3">
        {BY_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setBy(o.key)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
              by === o.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[#52525B] mb-3">
        {by === "airport" ? "Approach stress spike by arrival airport"
          : by === "phase" ? "Takeoff vs landing, on average"
          : "Your landing stress spike by pilot flying"} · Δ vs day baseline
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[#52525B]">No flight physio yet — snapshots build as you fly with the CIRQA.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#D4D4D8] font-medium">{r.key}</span>
                <span className="tabular-nums" style={{ color: deltaColor(r.avg_stress_delta) }}>
                  {r.avg_stress_delta >= 0 ? "+" : ""}{r.avg_stress_delta}
                  <span className="text-[#52525B] ml-1.5">· {r.n}×</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.avg_stress_delta) / max) * 100}%`, background: deltaColor(r.avg_stress_delta) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Life-wide stress insights for the Correlations page: what stresses you across
// all of life + the flight-physio rollups (airport / phase / captain).
export function StressLifeInsights() {
  return (
    <div className="space-y-6">
      <WhatStressesYou />
      <StressfulPlaces />
      <FlightLoadRollup />
    </div>
  );
}
