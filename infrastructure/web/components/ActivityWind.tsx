"use client";

import { useQuery } from "@tanstack/react-query";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Wind {
  wind_kmh: number;
  gust_max_kmh: number | null;
  wind_from_deg: number | null;
  avg_headwind_kmh: number;
  pct: { head: number; tail: number; cross: number };
  worst_head: { km: number; from_km: number; to_km: number; avg_kmh: number } | null;
  profile_km: number[];
  source: "streams" | "polyline";
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

function verdict(w: Wind): string {
  const h = w.avg_headwind_kmh;
  if (w.wind_kmh < 8) return "Calm day — the wind barely mattered";
  if (h > 4) return "Net headwind — this ride was harder than the numbers look";
  if (h < -4) return "Net tailwind — the wind helped, pace flatters you a bit";
  return "Mostly balanced — out into it, back with it";
}

// themed tokens (globals.css): headwind on the intensity ramp, tailwind green, cross neutral
const HEAD = "var(--viz-i4)", HEAD_STRONG = "var(--viz-i6)", TAIL = "var(--viz-cad)", CROSS = "var(--viz-alt)";

function barColor(h: number): string {
  if (h > 15) return HEAD_STRONG;
  if (h > 5) return HEAD;
  if (h < -5) return TAIL;
  return CROSS;
}

export function ActivityWind({ activityId, isOutdoor }: { activityId: string; isOutdoor: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["activity-wind", activityId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/activities/${encodeURIComponent(activityId)}/wind`);
      if (!r.ok) throw new Error(`wind ${r.status}`);
      return (await r.json()).wind as Wind | null;
    },
    enabled: isOutdoor,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!isOutdoor || isLoading || !data) return null;
  const w = data;
  const maxAbs = Math.max(10, ...w.profile_km.map((v) => Math.abs(v)));

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Wind</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold tabular-nums">
            {w.wind_kmh} km/h
            {w.wind_from_deg != null && (
              <span className="text-sm text-[#A1A1AA] font-normal"> from {compass(w.wind_from_deg)}</span>
            )}
          </span>
          {w.gust_max_kmh != null && (
            <span className="text-xs text-[#71717A] tabular-nums">gusts {Math.round(w.gust_max_kmh)} km/h</span>
          )}
        </div>
        <p className="text-sm text-[#A1A1AA] mb-4">{verdict(w)}</p>

        <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px] mb-2">
          <div style={{ width: `${w.pct.head}%`, background: HEAD }} />
          <div style={{ width: `${w.pct.cross}%`, background: CROSS }} />
          <div style={{ width: `${w.pct.tail}%`, background: TAIL }} />
        </div>
        <div className="flex justify-between text-xs text-[#71717A] tabular-nums mb-4">
          <span><span className="text-amber-400">Headwind</span> {w.pct.head}%</span>
          <span>Cross {w.pct.cross}%</span>
          <span><span className="text-emerald-400">Tailwind</span> {w.pct.tail}%</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Avg into the wind</p>
            <p className="text-lg font-semibold tabular-nums">
              {w.avg_headwind_kmh > 0 ? "+" : ""}{w.avg_headwind_kmh} km/h
            </p>
          </div>
          {w.worst_head && (
            <div>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Longest headwind</p>
              <p className="text-lg font-semibold tabular-nums">{w.worst_head.km} km</p>
              <p className="text-xs text-[#71717A] tabular-nums">
                km {w.worst_head.from_km}–{w.worst_head.to_km} · ~{w.worst_head.avg_kmh} km/h
              </p>
            </div>
          )}
        </div>

        {w.profile_km.length > 2 && (
          <>
            <div className="flex items-center h-16 gap-px" aria-label="Headwind per km">
              {w.profile_km.map((h, i) => (
                <div key={i} className="flex-1 h-full flex flex-col justify-center">
                  <div
                    style={{
                      height: `${(Math.abs(h) / maxAbs) * 50}%`,
                      background: barColor(h),
                      alignSelf: "stretch",
                      transform: h < 0 ? "translateY(50%)" : "translateY(-50%)",
                    }}
                    title={`km ${i + 1}: ${h > 0 ? "+" : ""}${h} km/h`}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-[#52525B] mt-1">
              <span>km 0</span>
              <span>▲ into the wind · ▼ with it</span>
              <span>km {w.profile_km.length}</span>
            </div>
          </>
        )}
        <p className="text-[10px] text-[#3F3F46] mt-3">
          Open-Meteo hourly 10 m wind along the route{w.source === "polyline" ? " (route timing estimated)" : ""}.
        </p>
      </div>
    </section>
  );
}
