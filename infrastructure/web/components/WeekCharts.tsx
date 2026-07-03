"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type DayChartData = {
  date: string;
  mood: number | null;
  energy: number | null;
  stress: number | null;
  sleep_hours: number | null;
  awake_minutes: number | null;
  sleep_score: number | null;
  hrv: number | null;
  resting_hr: number | null;
  steps: number | null;
  body_battery: number | null;
  duty_type: string | null;
  duty_hours: number | null;    // wall-clock duty span (flights: first off → last on)
  block_hours: number | null;   // actual block time sum (flights only)
  sector_count: number;
  spend: number | null;
};

type MoneyDay = {
  date: string;
  total_spend: number;
  by_category: Record<string, number>;
};

type BarDatum = {
  date: string;
  value: number | null;
  label?: string;
  color?: string;
  outline?: boolean;   // render as outline/ghost bar (standby)
  dot?: boolean;       // render as just a dot row (day off)
};

// ── MiniBarChart ──────────────────────────────────────────────────────────────

const BAR_MAX_H = 56;

function avg(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type MiniBarChartProps = {
  title: string;
  unit?: string;
  data: BarDatum[];
  maxValue: number;
  formatValue?: (v: number) => string;
  barColor?: string;
  showAvg?: boolean;
};

function MiniBarChart({
  title,
  unit,
  data,
  maxValue,
  formatValue = (v) => String(Math.round(v)),
  barColor = "#F59E0B",
  showAvg = true,
}: MiniBarChartProps) {
  const avgVal = avg(data.map((d) => (d.outline || d.dot ? null : d.value)));
  const avgPct = avgVal !== null ? Math.min(1, Math.max(0, avgVal / maxValue)) : null;
  const avgH = avgPct !== null ? Math.round(avgPct * BAR_MAX_H) : null;

  return (
    <div className="mb-6">
      {/* Title row */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-medium text-[#A1A1AA]">{title}</span>
          {unit && <span className="text-[10px] text-[#3F3F46]">{unit}</span>}
        </div>
        {showAvg && avgVal !== null && (
          <span className="text-[10px] text-[#52525B] tabular-nums">
            avg {formatValue(avgVal)}
          </span>
        )}
      </div>

      {/* Chart area */}
      <div className="relative">
        {/* Average dashed line */}
        {showAvg && avgH !== null && (
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ bottom: `${28 + avgH}px` }} // 28px = value + day labels below bars
          >
            <div
              className="w-full border-t border-dashed"
              style={{ borderColor: "rgba(161,161,170,0.25)" }}
            />
          </div>
        )}

        {/* Bars row */}
        <div className="flex items-end gap-[3px]">
          {data.map((d) => {
            const hasValue = d.value !== null;
            const pct = hasValue ? Math.min(1, Math.max(0.03, d.value! / maxValue)) : 0;
            const barH = hasValue ? Math.max(4, Math.round(pct * BAR_MAX_H)) : 4;
            const color = d.color ?? (hasValue ? barColor : "#1C1C1F");
            const valueLabel = d.label ?? (hasValue ? formatValue(d.value!) : "—");
            const dayChar = format(parseISO(d.date), "EEEEE"); // single char M T W T F S S

            if (d.dot) {
              // Day-off: just day label, no bar
              return (
                <div key={d.date} className="flex flex-col items-center" style={{ flex: 1 }}>
                  <div style={{ height: `${BAR_MAX_H}px` }} className="flex items-end justify-center">
                    <div className="w-1 h-1 rounded-full bg-[#27272A]" />
                  </div>
                  <span className="text-[9px] text-[#27272A] tabular-nums mt-1 leading-none">—</span>
                  <span className="text-[9px] text-[#3F3F46] mt-0.5 leading-none">{dayChar}</span>
                </div>
              );
            }

            if (d.outline) {
              // Standby: ghost outline bar — present but low impact
              return (
                <div key={d.date} className="flex flex-col items-center" style={{ flex: 1 }}>
                  <div style={{ height: `${BAR_MAX_H}px` }} className="flex items-end w-full">
                    <div
                      style={{
                        height: `${barH}px`,
                        width: "100%",
                        borderRadius: "3px 3px 0 0",
                        border: "1px solid #FACC15",
                        opacity: 0.4,
                        backgroundColor: "transparent",
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-[#52525B] tabular-nums mt-1 leading-none">SBY</span>
                  <span className="text-[9px] text-[#3F3F46] mt-0.5 leading-none">{dayChar}</span>
                </div>
              );
            }

            return (
              <div key={d.date} className="flex flex-col items-center" style={{ flex: 1 }}>
                <div style={{ height: `${BAR_MAX_H}px` }} className="flex items-end w-full">
                  <div
                    style={{
                      height: `${barH}px`,
                      backgroundColor: color,
                      width: "100%",
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                </div>
                <span
                  className="text-[9px] tabular-nums mt-1 leading-none"
                  style={{ color: hasValue ? "#71717A" : "#3F3F46" }}
                >
                  {valueLabel}
                </span>
                <span className="text-[9px] text-[#3F3F46] mt-0.5 leading-none">{dayChar}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function moodColor(v: number | null): string {
  if (!v) return "#1C1C1F";
  if (v >= 8) return "#22C55E";
  if (v >= 6) return "#F59E0B";
  return "#EF4444";
}

function sleepColor(h: number | null): string {
  if (!h) return "#1C1C1F";
  if (h >= 7.5) return "#6366F1";
  if (h >= 6) return "#818CF8";
  return "#EF4444";
}

function hrvColor(v: number | null): string {
  if (!v) return "#1C1C1F";
  if (v >= 60) return "#22C55E";
  if (v >= 45) return "#F59E0B";
  return "#EF4444";
}

function stepsColor(v: number | null): string {
  if (!v) return "#1C1C1F";
  if (v >= 10000) return "#22C55E";
  if (v >= 7000) return "#F59E0B";
  return "#52525B";
}

// ── Category definitions ──────────────────────────────────────────────────────

type Category = "mood" | "sleep" | "health" | "work" | "money";

const CATEGORY_LABELS: Record<Category, string> = {
  mood: "Mood",
  sleep: "Sleep",
  health: "Health",
  work: "Work",
  money: "Money",
};

// ── WeekCharts ────────────────────────────────────────────────────────────────

export function WeekCharts({ start, end }: { start: string; end: string }) {
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);

  const { data: chartData = [], isLoading } = useQuery<DayChartData[]>({
    queryKey: ["week-charts", start, end],
    queryFn: async () => {
      const r = await fetch(`/api/health/week-charts?start=${start}&end=${end}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const { data: moneyData = [] } = useQuery<MoneyDay[]>({
    queryKey: ["week-money", start, end],
    queryFn: async () => {
      const r = await fetch(`/api/money/daily-totals?start=${start}&end=${end}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-4 py-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-[#1C1C1F] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const byDate = Object.fromEntries(chartData.map((d) => [d.date, d]));
  const moneyByDate = Object.fromEntries(moneyData.map((d) => [d.date, d]));
  const dates = chartData.map((d) => d.date);

  if (!dates.length) {
    return <p className="text-sm text-[#52525B] text-center py-8">No data for this period.</p>;
  }

  function bars(fn: (d: DayChartData) => Omit<BarDatum, "date">): BarDatum[] {
    return dates.map((dt) => {
      const d = byDate[dt] ?? ({} as DayChartData);
      return { date: dt, ...fn(d) };
    });
  }

  // ── Availability flags ────────────────────────────────────────────────────
  const hasMood = dates.some((dt) => byDate[dt]?.mood || byDate[dt]?.energy);
  const hasSleep = dates.some((dt) => byDate[dt]?.sleep_hours);
  const hasHealth = dates.some((dt) => byDate[dt]?.hrv || byDate[dt]?.steps);
  const hasWork = dates.some((dt) => byDate[dt]?.duty_type);
  const hasMoney = moneyData.some((d) => d.total_spend > 0);

  const available: Category[] = (
    [
      hasMood && "mood",
      hasSleep && "sleep",
      hasHealth && "health",
      hasWork && "work",
      hasMoney && "money",
    ] as (Category | false)[]
  ).filter(Boolean) as Category[];

  const current: Category = activeCategory ?? available[0] ?? "mood";

  // ── Maxima ────────────────────────────────────────────────────────────────
  const maxSteps = Math.max(...dates.map((dt) => byDate[dt]?.steps ?? 0), 10000);
  const maxSpend = Math.max(...moneyData.map((d) => d.total_spend), 50);
  const maxAwake = Math.max(...dates.map((dt) => byDate[dt]?.awake_minutes ?? 0), 60);
  const maxHrv = Math.max(...dates.map((dt) => byDate[dt]?.hrv ?? 0), 80);
  const maxRhr = Math.max(...dates.map((dt) => byDate[dt]?.resting_hr ?? 0), 80);

  return (
    <div className="px-4 pt-3 pb-2">

      {/* ── Category pill tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap mb-5">
        {available.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 text-[11px] rounded-full border transition-colors ${
              current === cat
                ? "bg-[#FAFAFA] text-[#09090B] border-[#FAFAFA] font-medium"
                : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA] hover:border-[#3F3F46]"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* ── Mood & Energy ──────────────────────────────────────────────────── */}
      {current === "mood" && (
        <>
          <MiniBarChart
            title="Mood"
            unit="/ 10"
            maxValue={10}
            data={bars((d) => ({ value: d.mood, color: moodColor(d.mood) }))}
            formatValue={(v) => String(Math.round(v))}
          />
          <MiniBarChart
            title="Energy"
            unit="/ 10"
            maxValue={10}
            barColor="#38BDF8"
            data={bars((d) => ({ value: d.energy }))}
            formatValue={(v) => String(Math.round(v))}
          />
          <MiniBarChart
            title="Stress"
            unit="/ 10"
            maxValue={10}
            data={bars((d) => ({
              value: d.stress,
              color: d.stress
                ? d.stress >= 7 ? "#EF4444" : d.stress >= 5 ? "#F59E0B" : "#22C55E"
                : undefined,
            }))}
            formatValue={(v) => String(Math.round(v))}
          />
        </>
      )}

      {/* ── Sleep ──────────────────────────────────────────────────────────── */}
      {current === "sleep" && (
        <>
          <MiniBarChart
            title="Time asleep"
            unit="hours"
            maxValue={10}
            data={bars((d) => ({ value: d.sleep_hours, color: sleepColor(d.sleep_hours) }))}
            formatValue={(v) => v.toFixed(1)}
          />
          {maxAwake > 0 && (
            <MiniBarChart
              title="Awake time"
              unit="min"
              maxValue={Math.max(maxAwake, 30)}
              barColor="#EF4444"
              data={bars((d) => ({ value: d.awake_minutes }))}
              formatValue={(v) => String(Math.round(v))}
            />
          )}
          <MiniBarChart
            title="Sleep score"
            maxValue={100}
            barColor="#818CF8"
            data={bars((d) => ({ value: d.sleep_score }))}
            formatValue={(v) => String(Math.round(v))}
          />
        </>
      )}

      {/* ── Health ─────────────────────────────────────────────────────────── */}
      {current === "health" && (
        <>
          <MiniBarChart
            title="HRV"
            unit="ms"
            maxValue={maxHrv}
            data={bars((d) => ({ value: d.hrv, color: hrvColor(d.hrv) }))}
            formatValue={(v) => String(Math.round(v))}
          />
          <MiniBarChart
            title="Resting HR"
            unit="bpm"
            maxValue={maxRhr}
            barColor="#F97316"
            data={bars((d) => ({ value: d.resting_hr }))}
            formatValue={(v) => String(Math.round(v))}
          />
          <MiniBarChart
            title="Steps"
            maxValue={maxSteps}
            data={bars((d) => ({ value: d.steps, color: stepsColor(d.steps) }))}
            formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
          />
          <MiniBarChart
            title="Body battery"
            maxValue={100}
            barColor="#A78BFA"
            data={bars((d) => ({ value: d.body_battery }))}
            formatValue={(v) => String(Math.round(v))}
          />
        </>
      )}

      {/* ── Work ───────────────────────────────────────────────────────────── */}
      {current === "work" && (
        <>
          {/* Legend */}
          <div className="flex gap-3 mb-4 flex-wrap">
            {[
              { color: "#38BDF8", label: "Flying" },
              { color: "#A78BFA", label: "Ground" },
              { color: "#FACC15", label: "Standby", outline: true },
            ].map(({ color, label, outline }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{
                    backgroundColor: outline ? "transparent" : color,
                    border: outline ? `1px solid ${color}` : "none",
                    opacity: outline ? 0.6 : 1,
                  }}
                />
                <span className="text-[10px] text-[#52525B]">{label}</span>
              </div>
            ))}
          </div>

          {/* Duty span chart — wall clock first off-block to last on-block */}
          <MiniBarChart
            title="Duty span"
            unit="h (off-block → on-block)"
            maxValue={14}
            showAvg={false}
            data={dates.map((dt) => {
              const d = byDate[dt];
              const type = d?.duty_type ?? null;
              const hours = d?.duty_hours ?? null;
              if (!type || type === "day_off") return { date: dt, value: null, dot: true };
              if (type === "standby") return { date: dt, value: hours ?? 12, outline: true };
              return {
                date: dt,
                value: hours,
                color: type === "flying_duty" ? "#38BDF8" : "#A78BFA",
                label: hours ? `${hours}h` : "—",
              };
            })}
            formatValue={(v) => `${v}h`}
          />

          {/* Block time chart — actual flying time (sum of sector block_seconds) */}
          {dates.some((dt) => byDate[dt]?.block_hours) && (
            <MiniBarChart
              title="Block time"
              unit="h (actual flying)"
              maxValue={Math.max(...dates.map((dt) => byDate[dt]?.block_hours ?? 0), 8)}
              barColor="#0EA5E9"
              showAvg
              data={dates.map((dt) => {
                const d = byDate[dt];
                if (!d?.block_hours) return { date: dt, value: null, dot: !d?.duty_type || d.duty_type === "day_off" };
                return {
                  date: dt,
                  value: d.block_hours,
                  label: d.sector_count > 1
                    ? `${d.block_hours}h·${d.sector_count}`   // e.g. "4.2h·3"
                    : `${d.block_hours}h`,
                };
              })}
              formatValue={(v) => `${v.toFixed(1)}h`}
            />
          )}

          {/* Weekly summary pills */}
          <div className="flex gap-3 flex-wrap mt-2 pt-2 border-t border-[#1C1C1F]">
            {(() => {
              const flyingDays = dates.filter((dt) => byDate[dt]?.duty_type === "flying_duty");
              const totalBlock = flyingDays.reduce((s, dt) => s + (byDate[dt]?.block_hours ?? 0), 0);
              const totalSectors = flyingDays.reduce((s, dt) => s + (byDate[dt]?.sector_count ?? 0), 0);
              const sbDays = dates.filter((dt) => byDate[dt]?.duty_type === "standby").length;
              const gndDays = dates.filter((dt) => byDate[dt]?.duty_type === "ground_duty").length;
              return (
                <>
                  {flyingDays.length > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#38BDF8]" />
                      <span className="text-[10px] text-[#71717A]">
                        {flyingDays.length}× flying
                        {totalBlock > 0 && ` · ${totalBlock.toFixed(1)}h block`}
                        {totalSectors > 0 && ` · ${totalSectors} sector${totalSectors > 1 ? "s" : ""}`}
                      </span>
                    </div>
                  )}
                  {sbDays > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#FACC15]" />
                      <span className="text-[10px] text-[#71717A]">{sbDays}× standby</span>
                    </div>
                  )}
                  {gndDays > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" />
                      <span className="text-[10px] text-[#71717A]">{gndDays}× ground</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ── Money ──────────────────────────────────────────────────────────── */}
      {current === "money" && (
        <>
          <MiniBarChart
            title="Daily spend"
            unit="€"
            maxValue={maxSpend}
            barColor="#F59E0B"
            data={dates.map((dt) => {
              const m = moneyByDate[dt];
              return {
                date: dt,
                value: m?.total_spend || null,
                label: m?.total_spend ? `${Math.round(m.total_spend)}` : "—",
              };
            })}
            formatValue={(v) => `${Math.round(v)}`}
          />

          {/* Category breakdown for the week */}
          {(() => {
            const catTotals: Record<string, number> = {};
            moneyData.forEach((d) => {
              Object.entries(d.by_category).forEach(([cat, amt]) => {
                catTotals[cat] = (catTotals[cat] ?? 0) + amt;
              });
            });
            const sorted = Object.entries(catTotals)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5);
            const total = sorted.reduce((s, [, v]) => s + v, 0);
            if (!sorted.length) return null;
            return (
              <div className="mt-2 space-y-1.5">
                {sorted.map(([cat, amt]) => (
                  <div key={cat} className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-[#1C1C1F] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#F59E0B] rounded-full"
                        style={{ width: `${Math.round((amt / total) * 100)}%`, opacity: 0.7 }}
                      />
                    </div>
                    <span className="text-[10px] text-[#71717A] w-24 truncate">{cat}</span>
                    <span className="text-[10px] text-[#A1A1AA] tabular-nums w-10 text-right">
                      €{Math.round(amt)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
