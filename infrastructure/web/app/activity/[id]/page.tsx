import { api, fmtDuration, fmtDistance, fmtPace, activityIcon } from "@/lib/api";
import type { ActivityDetail, ActivityComputedMetrics } from "@/lib/api";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ActivityMap } from "@/components/ActivityMap";
import { ActivityCharts } from "@/components/ActivityCharts";
import { ActivityNotes } from "@/components/ActivityNotes";
import { TennisSessionPanel } from "@/components/TennisSessionPanel";
import { ActivitySplitsChart } from "@/components/ActivitySplitsChart";
import { SportCurveSection } from "@/components/training/SportCurveSection";
import { SPORT_COLORS, sportOf } from "@/lib/sport";

interface Props {
  params: Promise<{ id: string }>;
}

function StatBlock({ label, value }: { label: string; value: string | null }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#52525B] uppercase tracking-widest">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{children}</p>
  );
}

function decouplingColor(pct: number): string {
  if (pct < 5) return "text-emerald-400";
  if (pct < 8) return "text-amber-400";
  return "text-rose-400";
}

function decouplingLabel(pct: number): string {
  if (pct < 5) return "Durable";
  if (pct < 8) return "Borderline";
  return "High drift";
}

function ifColor(v: number): string {
  if (v < 0.75) return "text-blue-400";
  if (v <= 0.85) return "text-amber-400";
  return "text-rose-400";
}

function viColor(v: number): string {
  if (v < 1.05) return "text-emerald-400";
  if (v <= 1.15) return "text-amber-400";
  return "text-rose-400";
}

function PerformanceSection({ computed }: { computed: ActivityComputedMetrics }) {
  const hasDecoupling = computed.decoupling_pct !== null;
  const hasEF = computed.efficiency_factor !== null;
  const hasTE = computed.garmin_aerobic_te !== null;
  const hasPower = computed.normalized_power_w !== null;
  const hasIF = computed.intensity_factor !== null;
  const hasVI = computed.variability_index !== null;

  if (!hasDecoupling && !hasEF && !hasTE && !hasPower) return null;

  return (
    <section className="mb-8">
      <SectionLabel>Performance</SectionLabel>
      <div className="grid grid-cols-3 gap-4">
        {/* Aerobic decoupling */}
        {hasDecoupling && (() => {
          const pct = computed.decoupling_pct!;
          return (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[#52525B] uppercase tracking-widest">Decoupling</span>
              <span className={`text-xl font-semibold tabular-nums ${decouplingColor(pct)}`}>
                {pct.toFixed(1)}%
              </span>
              <span className={`text-xs ${decouplingColor(pct)}`}>{decouplingLabel(pct)}</span>
            </div>
          );
        })()}

        {/* Efficiency factor */}
        {hasEF && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">EF</span>
            <span className="text-xl font-semibold tabular-nums">
              {computed.efficiency_factor!.toFixed(3)}
            </span>
            <span className="text-xs text-[#52525B]">speed/HR</span>
          </div>
        )}

        {/* Garmin Training Effect */}
        {hasTE && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Training Effect</span>
            <span className="text-xl font-semibold tabular-nums">
              {computed.garmin_aerobic_te!.toFixed(1)}
            </span>
            <span className="text-xs text-[#52525B]">
              aerobic
              {computed.garmin_anaerobic_te !== null
                ? ` · ${computed.garmin_anaerobic_te.toFixed(1)} anaerobic`
                : ""}
            </span>
          </div>
        )}

        {/* Power metrics row — only if NP exists */}
        {hasPower && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Norm. Power</span>
            <span className="text-xl font-semibold tabular-nums">
              {Math.round(computed.normalized_power_w!)} W
            </span>
          </div>
        )}

        {hasIF && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Int. Factor</span>
            <span className={`text-xl font-semibold tabular-nums ${ifColor(computed.intensity_factor!)}`}>
              {computed.intensity_factor!.toFixed(2)}
            </span>
            <span className="text-xs text-[#52525B]">NP / FTP</span>
          </div>
        )}

        {hasVI && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Variability</span>
            <span className={`text-xl font-semibold tabular-nums ${viColor(computed.variability_index!)}`}>
              {computed.variability_index!.toFixed(2)}
            </span>
            <span className="text-xs text-[#52525B]">pacing smoothness</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default async function ActivityPage({ params }: Props) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);

  let activity: ActivityDetail;
  try {
    activity = await api.activity(decodedId);
  } catch {
    notFound();
  }

  const date = activity.date;
  const sport = sportOf(activity.activity_type);
  const sportColor = SPORT_COLORS[sport];
  const isTennis = (activity.activity_type ?? "").toLowerCase().includes("tennis");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      {/* Back link */}
      <div className="pt-6 mb-6">
        <Link
          href={`/day/${date}`}
          className="text-sm text-[#52525B] hover:text-white transition-colors"
        >
          ← {date}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-3xl">{activityIcon(activity.activity_type)}</span>
          <h1 className="text-2xl font-semibold">
            {activity.name ?? activity.activity_type ?? "Activity"}
          </h1>
        </div>
        <div className="flex gap-2 items-center mt-1">
          {activity.activity_type && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium capitalize"
              style={{ backgroundColor: `${sportColor}1A`, color: sportColor }}
            >
              {activity.activity_type.replace(/_/g, " ")}
            </span>
          )}
          <span className="text-xs text-[#52525B]">
            {activity.start_time
              ? new Date(activity.start_time).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </span>
          <span className="text-xs text-[#3F3F46]">·</span>
          <span className="text-xs text-[#52525B] capitalize">
            {activity.source}
          </span>
          {activity.strava_id && (
            <>
              <span className="text-xs text-[#3F3F46]">·</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FC4C02]/10 text-[#FC4C02] font-medium">
                Strava
              </span>
            </>
          )}
        </div>
      </div>

      {/* Map */}
      {activity.polyline && (
        <section className="mb-8">
          <SectionLabel>Route</SectionLabel>
          <ActivityMap polyline={activity.polyline} />
        </section>
      )}

      {/* Activity stream charts */}
      <ActivityCharts activityId={decodedId} activityType={activity.activity_type} />

      {/* Splits */}
      {activity.splits && activity.splits.length > 0 && (
        <section className="mb-8">
          <SectionLabel>Splits</SectionLabel>
          <ActivitySplitsChart splits={activity.splits} activityType={activity.activity_type} />
        </section>
      )}

      {/* Where this effort sits on your own curve (runs & rides) */}
      {(sport === "run" || sport === "ride") && (
        <SportCurveSection
          sport={sport}
          distanceM={activity.distance_meters ?? null}
          avgSpeedMps={activity.avg_speed_mps ?? null}
        />
      )}

      {/* Key stats */}
      <section className="mb-8">
        <SectionLabel>Stats</SectionLabel>
        <div className="grid grid-cols-3 gap-4">
          <StatBlock label="Duration" value={fmtDuration(activity.duration_seconds)} />
          <StatBlock label="Distance" value={fmtDistance(activity.distance_meters)} />
          <StatBlock label="Pace / Speed" value={fmtPace(activity.avg_speed_mps ?? null, activity.activity_type)} />
          <StatBlock label="Avg HR" value={activity.avg_heart_rate ? `${activity.avg_heart_rate} bpm` : null} />
          <StatBlock label="Max HR" value={activity.max_heart_rate ? `${activity.max_heart_rate} bpm` : null} />
          <StatBlock label="Elevation" value={activity.elevation_gain_meters ? `↑ ${Math.round(activity.elevation_gain_meters)} m` : null} />
          <StatBlock label="Calories" value={activity.calories ? `${activity.calories} kcal` : null} />
          <StatBlock label="TSS" value={activity.training_stress_score ? `${Math.round(activity.training_stress_score)}` : null} />
          <StatBlock label="Power" value={activity.avg_power_watts ? `${activity.avg_power_watts} W` : null} />
        </div>
      </section>

      {/* Performance metrics (EF, decoupling, NP/IF/VI) */}
      {activity.computed && <PerformanceSection computed={activity.computed} />}

      {/* Segment efforts */}
      {activity.segment_efforts.length > 0 && (
        <section className="mb-8">
          <SectionLabel>Segments</SectionLabel>
          <div className="flex flex-col gap-2">
            {activity.segment_efforts.map((effort) => (
              <div
                key={effort.id}
                className="flex items-center gap-3 bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{effort.segment_name}</p>
                    {effort.is_personal_record && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium shrink-0">
                        PR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {fmtDuration(effort.duration_seconds)}
                    {effort.segment_distance_meters
                      ? ` · ${fmtDistance(effort.segment_distance_meters)}`
                      : ""}
                    {effort.avg_heart_rate ? ` · ${effort.avg_heart_rate} bpm` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tennis match / training */}
      {isTennis && (
        <section className="mb-8">
          <SectionLabel>Tennis journal</SectionLabel>
          <TennisSessionPanel activityId={decodedId} initial={activity.tennis ?? null} />
        </section>
      )}

      {/* Notes & rating */}
      <section className="mb-8">
        <SectionLabel>How it felt</SectionLabel>
        <ActivityNotes
          activityId={decodedId}
          initialNotes={activity.user_notes ?? null}
          initialRating={activity.user_rating ?? null}
        />
      </section>
    </main>
  );
}
