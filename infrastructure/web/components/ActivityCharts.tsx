"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea,
} from "recharts";
import type { ActivityStreams } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

const AXIS = { tick: { fill: "#52525B", fontSize: 11 }, axisLine: false, tickLine: false };

const HR_ZONE_COLORS = ["#1E3A5F", "#1A4731", "#713F12", "#7C2D12", "#450A0A"];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2 mb-4">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{title}</p>
      {children}
    </div>
  );
}

function fmtKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtPaceFromMs(ms: number, isCycling: boolean) {
  if (isCycling) return `${(ms * 3.6).toFixed(1)} km/h`;
  const secPerKm = 1000 / ms;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")} /km`;
}

interface Props {
  activityId: string;
  activityType: string | null;
}

export function ActivityCharts({ activityId, activityType }: Props) {
  const { data, isLoading } = useQuery<ActivityStreams>({
    queryKey: ["activity-streams", activityId],
    queryFn: () =>
      fetch(`${BASE}/activities/${activityId}/streams`).then((r) => r.json()),
    staleTime: Infinity,
  });

  if (isLoading || !data || data.available.length === 0) return null;

  const isCycling = (activityType ?? "").toLowerCase().includes("cycl") ||
    (activityType ?? "").toLowerCase().includes("ride");

  const dist = data.distance;
  const n = dist.length;
  if (n === 0) return null;

  // Build per-point chart data indexed by distance (km)
  const points = Array.from({ length: n }, (_, i) => ({
    d: dist[i],
    alt: data.altitude?.[i] ?? undefined,
    hr: data.heartrate?.[i] ?? undefined,
    vel: data.velocity?.[i] ?? undefined,
  }));

  // Downsample to max 500 points for performance
  const step = Math.max(1, Math.floor(n / 500));
  const sampled = points.filter((_, i) => i % step === 0);

  const maxHR = 195;
  const hrBounds = [0.60, 0.70, 0.80, 0.90].map((p) => p * maxHR);

  const hasAlt = data.available.includes("altitude");
  const hasHR = data.altitude !== null ? data.available.includes("heartrate") || data.available.includes("heart_rate") : false;
  const hasHRData = data.heartrate !== null && (data.heartrate?.length ?? 0) > 0;
  const hasVel = data.velocity !== null && (data.velocity?.length ?? 0) > 0;
  const hasZones = data.hr_zones !== null;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Charts</p>

      {/* Elevation */}
      {hasAlt && (
        <ChartCard title="Elevation">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={sampled} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <XAxis dataKey="d" tickFormatter={(v) => fmtKm(v)} {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip
                {...TOOLTIP}
                formatter={(v) => [`${Math.round(Number(v))} m`, "Altitude"]}
                labelFormatter={(v) => fmtKm(Number(v))}
              />
              <Area
                type="monotone"
                dataKey="alt"
                stroke="#3B82F6"
                fill="#3B82F6"
                fillOpacity={0.15}
                dot={false}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Heart rate */}
      {hasHRData && (
        <ChartCard title="Heart Rate">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={sampled} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <XAxis dataKey="d" tickFormatter={(v) => fmtKm(v)} {...AXIS} />
              <YAxis domain={["dataMin - 10", "dataMax + 5"]} {...AXIS} />
              <Tooltip
                {...TOOLTIP}
                formatter={(v) => [`${Math.round(Number(v))} bpm`, "HR"]}
                labelFormatter={(v) => fmtKm(Number(v))}
              />
              {hrBounds.map((bound, i) => (
                <ReferenceArea
                  key={i}
                  y1={bound}
                  y2={hrBounds[i + 1] ?? maxHR * 1.05}
                  fill={HR_ZONE_COLORS[i + 1]}
                  fillOpacity={0.25}
                />
              ))}
              <Area
                type="monotone"
                dataKey="hr"
                stroke="#EF4444"
                fill="#EF4444"
                fillOpacity={0.1}
                dot={false}
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Pace / Speed */}
      {hasVel && (
        <ChartCard title={isCycling ? "Speed" : "Pace"}>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={sampled} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <XAxis dataKey="d" tickFormatter={(v) => fmtKm(v)} {...AXIS} />
              <YAxis
                tickFormatter={(v) =>
                  isCycling ? `${(Number(v) * 3.6).toFixed(0)}` : (() => {
                    const spk = 1000 / Number(v);
                    return `${Math.floor(spk / 60)}:${Math.round(spk % 60).toString().padStart(2, "0")}`;
                  })()
                }
                {...AXIS}
              />
              <Tooltip
                {...TOOLTIP}
                formatter={(v) => [fmtPaceFromMs(Number(v), isCycling), isCycling ? "Speed" : "Pace"]}
                labelFormatter={(v) => fmtKm(Number(v))}
              />
              <Line
                type="monotone"
                dataKey="vel"
                stroke="#F59E0B"
                dot={false}
                strokeWidth={1.5}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* HR Zones breakdown */}
      {hasZones && data.hr_zones && (() => {
        const zoneKeys = ["z1", "z2", "z3", "z4", "z5"] as const;
        const zoneColors = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#7C3AED"];
        const labels = ["Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 Max"];
        const total = Object.values(data.hr_zones!).reduce((a, b) => a + b, 0);
        return (
          <ChartCard title="HR Zones">
            {/* Proportional stacked bar */}
            <div className="flex h-3 rounded-full overflow-hidden mb-4">
              {zoneKeys.map((z, i) => {
                const pct = total > 0 ? (data.hr_zones![z] / total) * 100 : 0;
                const mins = Math.round(data.hr_zones![z] / 60);
                return pct > 0 ? (
                  <div
                    key={z}
                    style={{ width: `${pct}%`, background: zoneColors[i] }}
                    title={`${labels[i]}: ${mins}m (${Math.round(pct)}%)`}
                  />
                ) : null;
              })}
            </div>
            {/* Legend rows */}
            <div className="space-y-2">
              {zoneKeys.map((z, i) => {
                const secs = data.hr_zones![z];
                const pct = total > 0 ? Math.round((secs / total) * 100) : 0;
                const mins = Math.round(secs / 60);
                return (
                  <div key={z} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: zoneColors[i] }} />
                    <span className="text-xs text-[#71717A] w-24 shrink-0">{labels[i]}</span>
                    <div className="flex-1 h-1.5 bg-[#18181B] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: zoneColors[i] }} />
                    </div>
                    <span className="text-xs text-[#A1A1AA] tabular-nums w-16 text-right">
                      {mins}m · {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </ChartCard>
        );
      })()}
    </section>
  );
}
