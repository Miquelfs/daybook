"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell,
} from "recharts";
import type { ActivitySplit } from "@/lib/api";

interface Props {
  splits: ActivitySplit[];
  activityType: string | null;
}

const MAX_HR = 195;
const HR_BOUNDS = [0.60, 0.70, 0.80, 0.90].map((p) => p * MAX_HR);
const ZONE_COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#7C3AED"];

function hrZoneColor(hr: number | null): string {
  if (!hr) return ZONE_COLORS[1];
  if (hr < HR_BOUNDS[0]) return ZONE_COLORS[0];
  if (hr < HR_BOUNDS[1]) return ZONE_COLORS[1];
  if (hr < HR_BOUNDS[2]) return ZONE_COLORS[2];
  if (hr < HR_BOUNDS[3]) return ZONE_COLORS[3];
  return ZONE_COLORS[4];
}

function splitLabel(split: ActivitySplit, index: number): string {
  if (split.type === "auto_km" || split.type === "auto_mile") {
    return `${split.split_index + 1} km`;
  }
  if (split.type === "manual_lap") {
    return `L${split.split_index + 1}`;
  }
  return `${index + 1}`;
}

function fmtPace(sPerKm: number): string {
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

function fmtDur(secs: number | null): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

export function ActivitySplitsChart({ splits, activityType }: Props) {
  const isCycling =
    (activityType ?? "").toLowerCase().includes("cycl") ||
    (activityType ?? "").toLowerCase().includes("ride");

  const data = splits.map((s, i) => {
    // Derive pace from time_s / distance_m if avg_pace_s_per_km missing
    let yValue: number | null = null;
    if (isCycling) {
      yValue = s.avg_power_w ?? null;
    } else {
      if (s.avg_pace_s_per_km) {
        yValue = s.avg_pace_s_per_km;
      } else if (s.time_s && s.distance_m && s.distance_m > 0) {
        yValue = s.time_s / (s.distance_m / 1000);
      }
    }
    return {
      label: splitLabel(s, i),
      value: yValue,
      hr: s.avg_hr,
      distKm: s.distance_m ? (s.distance_m / 1000).toFixed(2) : null,
      time: s.time_s,
      elevGain: s.elev_gain_m ? Math.round(s.elev_gain_m) : null,
      raw: s,
    };
  }).filter((d) => d.value !== null && d.value > 0);

  if (data.length === 0) return null;

  // For pace: Y-axis reversed so faster (lower s/km) is at top
  const isPace = !isCycling;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#18181B" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#52525B", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            reversed={isPace}
            tickFormatter={(v) =>
              isPace
                ? fmtPace(Number(v))
                : `${Math.round(Number(v))}W`
            }
            tick={{ fill: "#52525B", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={isPace ? 52 : 38}
            domain={isPace ? ["dataMin - 10", "dataMax + 10"] : ["auto", "auto"]}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value, _name, entry) => {
              const d = entry.payload;
              const lines: [string, string][] = [];
              if (isPace) lines.push([fmtPace(Number(value)), "Pace"]);
              else lines.push([`${Math.round(Number(value))} W`, "Power"]);
              if (d.hr) lines.push([`${d.hr} bpm`, "HR"]);
              if (d.distKm) lines.push([`${d.distKm} km`, "Distance"]);
              if (d.time) lines.push([fmtDur(d.time), "Time"]);
              if (d.elevGain) lines.push([`+${d.elevGain} m`, "Elevation"]);
              return lines[0];
            }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              const val = d.value;
              return (
                <div style={TOOLTIP_STYLE.contentStyle} className="p-2 space-y-0.5">
                  <p style={TOOLTIP_STYLE.labelStyle} className="text-xs mb-1">{label}</p>
                  {isPace && val && <p className="text-white text-xs">{fmtPace(val)} pace</p>}
                  {!isPace && val && <p className="text-white text-xs">{Math.round(val)} W</p>}
                  {d.hr && <p className="text-xs text-[#A1A1AA]">{d.hr} bpm</p>}
                  {d.distKm && <p className="text-xs text-[#A1A1AA]">{d.distKm} km</p>}
                  {d.time && <p className="text-xs text-[#A1A1AA]">{fmtDur(d.time)}</p>}
                  {d.elevGain && <p className="text-xs text-[#A1A1AA]">+{d.elevGain} m</p>}
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={28}>
            {data.map((entry, i) => (
              <Cell key={i} fill={hrZoneColor(entry.hr)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
