"use client";

import { useState } from "react";
import { fmtAmount, type MonthOverview } from "@/lib/money-api";

// Zone bands on the 0–200% scale. Status colors carry meaning here (on pace /
// drifting / over), and the numeric readout means identity is never color-alone.
const ZONES = [
  { to: 80, color: "#22C55E", label: "on pace" },
  { to: 100, color: "#EAB308", label: "watch" },
  { to: 120, color: "#F59E0B", label: "over pace" },
  { to: 200, color: "#EF4444", label: "way over" },
];

function zoneFor(pct: number) {
  return ZONES.find((z) => pct <= z.to) ?? ZONES[ZONES.length - 1];
}

// Map 0–200% onto a semicircle: 180° (left) → 0° (right).
function point(pct: number, r: number, cx: number, cy: number) {
  const angle = Math.PI * (1 - Math.min(pct, 200) / 200);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}

function arcPath(from: number, to: number, r: number, cx: number, cy: number) {
  const a = point(from, r, cx, cy);
  const b = point(to, r, cx, cy);
  const largeArc = to - from > 100 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function VelocityGauge({ overview }: { overview: MonthOverview }) {
  const [mode, setMode] = useState<"adjusted" | "raw">("adjusted");

  const velocity = mode === "adjusted" ? overview.adjusted_velocity : overview.velocity;
  const pct = velocity * 100;
  const zone = zoneFor(pct);

  const CX = 100, CY = 92, R = 80;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-[#52525B] uppercase tracking-widest">Budget velocity</p>
        <div className="flex rounded-full border border-[#27272A] overflow-hidden text-[10px]">
          {(["adjusted", "raw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 uppercase tracking-wider transition-colors ${
                mode === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 200 104" className="w-full max-w-xs mx-auto block">
        {/* Zone bands (dim) with 2-unit gaps between them */}
        {ZONES.map((z, i) => {
          const from = i === 0 ? 0 : ZONES[i - 1].to;
          return (
            <path
              key={z.to}
              d={arcPath(from + (i === 0 ? 0 : 1), z.to - (i === ZONES.length - 1 ? 0 : 1), R, CX, CY)}
              stroke={z.color}
              strokeOpacity={0.22}
              strokeWidth={10}
              strokeLinecap="butt"
              fill="none"
            />
          );
        })}
        {/* Progress arc in the active zone color */}
        {pct > 0 && (
          <path
            d={arcPath(0, Math.min(pct, 200), R, CX, CY)}
            stroke={zone.color}
            strokeWidth={10}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {/* 100% tick */}
        <line
          x1={point(100, R - 9, CX, CY).x} y1={point(100, R - 9, CX, CY).y}
          x2={point(100, R + 9, CX, CY).x} y2={point(100, R + 9, CX, CY).y}
          stroke="#3F3F46" strokeWidth={1.5}
        />
        <text x={CX} y={CY - 18} textAnchor="middle" fill="#FAFAFA" fontSize="26" fontWeight="600" className="tabular-nums">
          {pct.toFixed(0)}%
        </text>
        <text x={CX} y={CY - 2} textAnchor="middle" fill={zone.color} fontSize="9" letterSpacing="0.1em">
          {zone.label.toUpperCase()}
        </text>
      </svg>

      <p className="text-xs text-[#52525B] text-center mt-1">
        {mode === "adjusted" ? (
          <>
            discretionary {fmtAmount(overview.discretionary_spent)} of {fmtAmount(overview.discretionary_budget)}
            <span className="text-[#3F3F46]"> · fixed bills {fmtAmount(overview.fixed_spent)} amortised</span>
          </>
        ) : (
          <>
            {fmtAmount(overview.total_spent)} of {fmtAmount(overview.total_budget)} · day {overview.days_elapsed}/{overview.days_in_month}
          </>
        )}
      </p>
    </div>
  );
}
