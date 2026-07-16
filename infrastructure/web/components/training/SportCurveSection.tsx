"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SPORT_COLORS } from "@/lib/sport";

function fmtPaceMinKm(sPerKm: number): string {
  const m = Math.floor(sPerKm / 60);
  const s = Math.round(sPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtBucket(m: number): string {
  if (m >= 1000) return `${m % 1000 === 0 ? m / 1000 : (m / 1000).toFixed(1)}k`;
  return `${m}m`;
}

function fmtPace100m(sPerKm: number): string {
  // curve values are s/km; a swim 100m pace is s/km ÷ 10
  const per100 = sPerKm / 10;
  const m = Math.floor(per100 / 60);
  const s = Math.round(per100 % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  sport: "run" | "ride" | "swim";
  distanceM: number | null;
  avgSpeedMps: number | null;
};

// Places this activity on the athlete's own best-pace/speed curve:
// all-time best + last-90-days best per distance bucket, log-x.
export function SportCurveSection({ sport, distanceM, avgSpeedMps }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["training-curve", sport],
    queryFn: () => api.trainingCurve(sport),
  });

  if (isLoading) return <div className="h-40 bg-[#0D0D0F] rounded-xl animate-pulse mb-8" />;
  const buckets = (data ?? []).filter((b) => b.all_time_best != null);
  if (buckets.length < 3) return null;

  const color = SPORT_COLORS[sport];
  const isRide = sport === "ride";
  // Rides read better as speed (km/h); runs as pace (min/km, faster = up).
  const toY = (sPerKm: number) => (isRide ? 3600 / sPerKm : sPerKm);

  const W = 560, H = 180, PAD_L = 44, PAD_R = 16, PAD_T = 14, PAD_B = 26;
  const xs = buckets.map((b) => Math.log(b.bucket));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yVals = buckets.flatMap((b) =>
    [b.all_time_best!, b.last_90d_best].filter((v): v is number => v != null)
  ).map(toY);

  const actPace = avgSpeedMps && avgSpeedMps > 0 ? 1000 / avgSpeedMps : null;
  const actX = distanceM && distanceM > 0 ? Math.log(distanceM) : null;
  if (actPace != null) yVals.push(toY(actPace));

  let yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const yPadding = (yMax - yMin) * 0.1 || 1;
  yMin -= yPadding; yMax += yPadding;

  const px = (lx: number) => PAD_L + ((lx - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  // Pace: lower s/km = faster = plotted higher. Speed: higher = higher.
  const py = (v: number) => {
    const t = (v - yMin) / (yMax - yMin || 1);
    return isRide ? H - PAD_B - t * (H - PAD_T - PAD_B) : PAD_T + t * (H - PAD_T - PAD_B);
  };

  const line = (key: "all_time_best" | "last_90d_best") =>
    buckets
      .filter((b) => b[key] != null)
      .map((b, i) => `${i === 0 ? "M" : "L"} ${px(Math.log(b.bucket)).toFixed(1)} ${py(toY(b[key]!)).toFixed(1)}`)
      .join(" ");

  const isSwim = sport === "swim";
  const fmtY = (v: number) =>
    isRide ? `${v.toFixed(0)} km/h` : isSwim ? `${fmtPace100m(v)} /100m` : `${fmtPaceMinKm(v)} /km`;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
        {isRide ? "Speed curve" : isSwim ? "Swim pace curve" : "Pace curve"}
      </p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* Recessive x labels at a few buckets */}
          {buckets
            .filter((_, i) => i % Math.ceil(buckets.length / 6) === 0)
            .map((b) => (
              <text key={b.bucket} x={px(Math.log(b.bucket))} y={H - 8}
                    textAnchor="middle" fill="#3F3F46" fontSize="9">
                {fmtBucket(b.bucket)}
              </text>
            ))}
          {/* Y extremes */}
          <text x={4} y={PAD_T + 8} fill="#3F3F46" fontSize="9">
            {fmtY(isRide ? yMax : yMin)}
          </text>
          <text x={4} y={H - PAD_B} fill="#3F3F46" fontSize="9">
            {fmtY(isRide ? yMin : yMax)}
          </text>

          {/* 90-day best (dashed, dimmer) then all-time (solid) */}
          <path d={line("last_90d_best")} stroke={color} strokeOpacity={0.45}
                strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
          <path d={line("all_time_best")} stroke={color} strokeWidth={2} fill="none" />

          {/* Hover targets with tooltips */}
          {buckets.map((b) => (
            <circle key={b.bucket} cx={px(Math.log(b.bucket))} cy={py(toY(b.all_time_best!))}
                    r={7} fill="transparent">
              <title>
                {`${fmtBucket(b.bucket)} — best ${fmtY(toY(b.all_time_best!))}`}
                {b.last_90d_best != null ? ` · 90d ${fmtY(toY(b.last_90d_best))}` : ""}
              </title>
            </circle>
          ))}

          {/* This activity, ringed to pop against the lines */}
          {actX != null && actPace != null && actX >= xMin && actX <= xMax && (
            <g>
              <circle cx={px(actX)} cy={py(toY(actPace))} r={5} fill={color} stroke="#0D0D0F" strokeWidth={2} />
              <text x={px(actX)} y={py(toY(actPace)) - 9} textAnchor="middle" fill="#FAFAFA" fontSize="9">
                this one · {fmtY(toY(actPace))}
              </text>
            </g>
          )}
        </svg>
        <div className="flex items-center gap-4 px-1 mt-1">
          <span className="flex items-center gap-1.5 text-[10px] text-[#71717A]">
            <span className="inline-block w-4 h-0.5" style={{ backgroundColor: color }} /> all-time best
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-[#71717A]">
            <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: color }} /> last 90 days
          </span>
        </div>
      </div>
    </section>
  );
}
