"use client";

import { Stat } from "@/components/ui/kit";
import type { PlanCourse, ProfileMarker } from "@/lib/api";

// Grade bands, as on a stage sheet: downhill · flat · 1–3 · 3–6 · 6–10 · 10 %+
const BANDS = [
  { label: "downhill", max: -1, color: "var(--viz-g0)" },
  { label: "flat", max: 1, color: "var(--viz-g1)" },
  { label: "1–3%", max: 3, color: "var(--viz-g2)" },
  { label: "3–6%", max: 6, color: "var(--viz-g3)" },
  { label: "6–10%", max: 10, color: "var(--viz-g4)" },
  { label: "10%+", max: Infinity, color: "var(--viz-g5)" },
];
const band = (pct: number) => BANDS.find((b) => pct < b.max)!.color;

export const hmLong = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}`;
/** Touring load from the course's TSS — same cut-offs as the trip's stage sheets. */
export const loadLabel = (tss: number) => (tss >= 220 ? "Hard" : tss >= 180 ? "Moderate" : "Easy");

function niceMax(v: number) {
  const step = v > 400 ? 200 : v > 100 ? 100 : 20;
  return Math.max(step, Math.ceil((v * 1.08) / step) * step);
}

/** Labels placed left to right in up to `n` rows so they don't overlap (≈1.1 % of the width per character,
 *  right-aligned near the end); -1 = no room, it's still drawn as a line and listed below. */
function lanes(items: { pct: number; text: string }[], n: number): { lane: number; right: boolean }[] {
  const ends = Array<number>(n).fill(-Infinity);
  return items.map(({ pct, text }) => {
    const w = text.length * 1.1 + 2;
    const right = pct + w > 100;
    const [a, b] = right ? [pct - w, pct] : [pct, pct + w];
    const lane = ends.findIndex((e) => e < a);
    if (lane >= 0) ends[lane] = b;
    return { lane, right };
  });
}

function eleAt(profile: [number, number][], km: number) {
  const i = profile.findIndex((p) => p[0] >= km);
  if (i <= 0) return profile[Math.max(0, i)][1];
  const [k0, m0] = profile[i - 1], [k1, m1] = profile[i];
  return m0 + ((m1 - m0) * (km - k0)) / (k1 - k0 || 1);
}

/** Elevation along the route, each 500 m coloured by its gradient. `compact` = a strip for lists.
 *  `markers` (a ride that happened): cols and climbs labelled above, villages below the km axis. */
export function GradeProfile({ profile, compact = false, height, markers = [] }: {
  profile: [number, number][];
  compact?: boolean;
  height?: number;
  markers?: ProfileMarker[];
}) {
  if (profile.length < 2) return null;
  const W = 1000, H = height ?? (compact ? 36 : 150);
  const maxKm = profile[profile.length - 1][0] || 1;
  const top = niceMax(Math.max(...profile.map((p) => p[1])));
  const bottom = Math.min(0, ...profile.map((p) => p[1]));
  const x = (km: number) => (km / maxKm) * W;
  const y = (m: number) => H - ((m - bottom) / (top - bottom || 1)) * H;
  const line = profile.map(([km, m], i) => `${i ? "L" : "M"}${x(km).toFixed(1)},${y(m).toFixed(1)}`).join("");
  const kmStep = maxKm > 80 ? 20 : maxKm > 30 ? 10 : 5;
  const mStep = top > 400 ? 200 : top > 100 ? 100 : 20;

  const svg = (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
      {!compact && Array.from({ length: Math.floor(top / mStep) }, (_, i) => (i + 1) * mStep).map((m) => (
        <line key={m} x1={0} x2={W} y1={y(m)} y2={y(m)} stroke="var(--viz-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {profile.slice(1).map(([km, m], i) => {
        const [k0, m0] = profile[i];
        const pct = km > k0 ? ((m - m0) / ((km - k0) * 1000)) * 100 : 0;
        return (
          <path key={i} fill={band(pct)}
                d={`M${x(k0)},${H}L${x(k0)},${y(m0)}L${x(km)},${y(m)}L${x(km)},${H}Z`} stroke={band(pct)} strokeWidth={0.6} />
        );
      })}
      <path d={line} fill="none" stroke="var(--viz-alt)" strokeWidth={compact ? 1 : 1.5} vectorEffect="non-scaling-stroke" />
      {!compact && markers.map((m, i) => {
        const yy = y(eleAt(profile, m.km));
        return m.kind === "village" ? (
          <line key={i} x1={x(m.km)} x2={x(m.km)} y1={yy} y2={H} stroke="var(--viz-axis)" strokeWidth={1}
                strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ) : (
          <g key={i}>
            {m.from_km != null && (
              <line x1={x(m.from_km)} x2={x(m.km)} y1={1.5} y2={1.5} stroke="var(--viz-axis)" strokeWidth={2}
                    vectorEffect="non-scaling-stroke" />
            )}
            <line x1={x(m.km)} x2={x(m.km)} y1={0} y2={yy} stroke="var(--viz-axis)" strokeWidth={1}
                  strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
  if (compact) return svg;

  const label = (m: ProfileMarker) => m.kind === "village" ? m.name : `▲ ${m.name}${m.ele ? ` ${Math.round(m.ele)} m` : ""}`;
  const tops = markers.filter((m) => m.kind !== "village");
  const villages = markers.filter((m) => m.kind === "village");
  const place = (list: ProfileMarker[]) => lanes(list.map((m) => ({ pct: (m.km / maxKm) * 100, text: label(m) })), 2);
  const tLanes = place(tops), vLanes = place(villages);
  const laneRows = (l: { lane: number }[]) => Math.max(0, ...l.map((x) => x.lane + 1));
  const labels = (list: ProfileMarker[], ls: { lane: number; right: boolean }[], rows: number, below: boolean) => (
    <div className="relative text-[10px] leading-[14px]" style={{ height: rows * 14 }}>
      {list.map((m, i) => ls[i].lane < 0 ? null : (
        <span key={i} className={`absolute whitespace-nowrap ${m.first ? "text-[#F59E0B]" : "text-[#A1A1AA]"}`}
              style={{ left: `${(m.km / maxKm) * 100}%`, [below ? "top" : "bottom"]: ls[i].lane * 14,
                       transform: ls[i].right ? "translateX(-100%)" : undefined }}>
          {label(m)}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        {BANDS.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1 text-[10px] text-[#71717A]">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />{b.label}
          </span>
        ))}
      </div>
      <div className="flex">
        <div className="relative w-8 shrink-0 text-[10px] text-[var(--viz-axis)] tabular-nums" style={{ height: H }}>
          {[0, ...Array.from({ length: Math.floor(top / mStep) }, (_, i) => (i + 1) * mStep)].map((m) => (
            <span key={m} className="absolute right-1.5 -translate-y-1/2" style={{ top: y(m) }}>{m}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          {tops.length > 0 && labels(tops, tLanes, laneRows(tLanes), false)}
          {svg}
          <div className="relative h-4 text-[10px] text-[var(--viz-axis)] tabular-nums">
            {Array.from({ length: Math.floor(maxKm / kmStep) + 1 }, (_, i) => i * kmStep).map((km) => (
              <span key={km} className="absolute -translate-x-1/2 top-0.5" style={{ left: `${(km / maxKm) * 100}%` }}>{km}</span>
            ))}
          </div>
          {villages.length > 0 && labels(villages, vLanes, laneRows(vLanes), true)}
        </div>
      </div>
      {!markers.length && <p className="text-[10px] text-[#52525B] text-center">km</p>}
    </div>
  );
}

/** The six numbers of a stage sheet. */
export function StageStats({ course }: { course: PlanCourse }) {
  const down = course.descent_m ?? null;
  const perKm = course.km ? Math.round(course.climb_m / course.km) : 0;
  const light = course.daylight;
  const lightMin = light ? (() => {
    const [a, b] = [light.sunrise, light.sunset].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    return b - a;
  })() : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <Stat label="Distance" value={`${course.km} km`}
            sub={course.stage ? `${course.stage.share_pct}% of the ${course.stage.of} stages` : undefined} />
      <Stat label="Climbing" value={`+${course.climb_m.toLocaleString("en-GB")} m`}
            sub={down != null ? `−${down.toLocaleString("en-GB")} m down` : undefined} />
      <Stat label="High point" value={course.high_m != null ? `${course.high_m} m` : "—"} sub={`${perKm} m climbed per km`} />
      <Stat label="Riding time" value={hmLong(course.minutes)}
            sub={course.avg_kmh ? `${course.avg_kmh} km/h, no stops` : "no stops"} />
      <Stat label="Daylight" value={light ? `${light.sunrise}–${light.sunset}` : "—"}
            sub={lightMin != null ? `${hmLong(lightMin)} of light for ${hmLong(course.minutes)} riding` : undefined} />
      <Stat label="Load" value={loadLabel(course.tss)} sub={`~${course.tss} TSS`} />
    </div>
  );
}

/** A routed day as a compact row for lists: name, numbers, the coloured strip. */
export function StageStrip({ course }: { course: PlanCourse }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
        <span className="truncate text-[#D4D4D8]">
          {course.stage ? <span className="text-[#71717A]">Stage {course.stage.n} · </span> : null}{course.name}
        </span>
        <span className="shrink-0 text-[#71717A]">
          {course.km} km · +{course.climb_m.toLocaleString("en-GB")} m · {hmLong(course.minutes)} · {loadLabel(course.tss)}
        </span>
      </div>
      {course.profile && course.profile.length > 2 && (
        <div className="mt-1 rounded-md overflow-hidden"><GradeProfile profile={course.profile} compact /></div>
      )}
    </div>
  );
}
