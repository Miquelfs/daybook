"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type LoadRow = {
  date: string;
  sport: string;
  daily_tss: number;
  ctl: number;
  atl: number;
  tsb: number;
  ramp_rate: number;
  warning: string | null;
  activities?: { id: string; activity_type: string; name: string; start_time: string; training_stress_score: number }[];
};

const RANGES = [
  { label: "6W", days: 42 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: 1825 },
];

const SPORTS = ["combined", "run", "ride", "swim"];

function formatDate(d: string) {
  try { return format(parseISO(d), "d MMM"); } catch { return d; }
}

export default function FitnessFreshnessChart() {
  const [range, setRange] = useState(90);
  const [sport, setSport] = useState("combined");
  const [data, setData] = useState<LoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusDay, setFocusDay] = useState<LoadRow | null>(null);
  const [showDefs, setShowDefs] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/training/load?sport=${sport}&range=${range}`)
      .then((r) => r.json())
      .then((rows) => { setData(rows); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range, sport]);

  const hasHighRamp = data.some((d) => d.warning === "high_ramp_rate");

  const tsbData = data.map((row) => ({
    ...row,
    tsb_pos: row.tsb >= 0 ? row.tsb : 0,
    tsb_neg: row.tsb < 0 ? row.tsb : 0,
  }));

  async function handleDayClick(payload: any) {
    if (!payload?.activePayload?.[0]) return;
    const row: LoadRow = payload.activePayload[0].payload;
    // Fetch contributing activities for this day
    const res = await fetch(`${API}/training/load/${row.date}/activities`);
    const acts = await res.json();
    setFocusDay({ ...row, activities: acts });
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.days)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === r.days
                  ? "bg-blue-500 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                sport === s
                  ? "bg-zinc-600 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Ramp rate warning */}
      {hasHighRamp && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
          <span>⚠</span>
          <span>Weekly CTL ramp &gt; 7 pts — injury risk zone. Consider a recovery week.</span>
        </div>
      )}

      {/* Legend + definitions toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-5 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-500 inline-block rounded" />Fitness (CTL)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-rose-400 inline-block rounded" style={{ backgroundImage: "repeating-linear-gradient(90deg,#FB7185 0,#FB7185 4px,transparent 4px,transparent 6px)" }} />Fatigue (ATL)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />Form (TSB)</span>
        </div>
        <button
          onClick={() => setShowDefs((v) => !v)}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {showDefs ? "Hide guide ↑" : "How to read this ↓"}
        </button>
      </div>

      {/* Definitions panel — numbers pulled from latest data point */}
      {showDefs && (() => {
        const latest = data.length > 0 ? data[data.length - 1] : null;
        const ctl = latest?.ctl?.toFixed(1) ?? "—";
        const atl = latest?.atl?.toFixed(1) ?? "—";
        const tsb = latest?.tsb?.toFixed(1) ?? "—";
        const tsbNum = latest?.tsb ?? 0;
        const tsbState = tsbNum > 5 ? "fresh — good time to push hard"
          : tsbNum >= -5 ? "balanced — can handle quality sessions"
          : tsbNum >= -20 ? "building fatigue — manage intensity"
          : "high fatigue — recovery week recommended";
        return (
          <div className="rounded-lg bg-[#0D0D0F] border border-[#27272A] p-4 text-xs space-y-3 text-zinc-400">
            <div>
              <span className="text-blue-400 font-semibold">CTL {ctl} — Fitness (blue line)</span>
              <p className="mt-0.5">42-day exponential average of daily TSS. Builds slowly with consistent training, drops slowly with rest. Your CTL of {ctl} is base-level — target 60+ for a half-Ironman, 80+ for Ironman. You&apos;re early in the build.</p>
            </div>
            <div>
              <span className="text-rose-400 font-semibold">ATL {atl} — Fatigue (dashed pink line)</span>
              <p className="mt-0.5">7-day exponential average of daily TSS. Spikes quickly after a hard week, drops quickly during recovery. Your ATL of {atl} is close to CTL, meaning recent training matches your fitness base.</p>
            </div>
            <div>
              <span className="text-emerald-400 font-semibold">TSB {tsb} — Form = CTL − ATL (green line)</span>
              <p className="mt-0.5">Your readiness number right now. At {tsb} you&apos;re <span className="text-zinc-200">{tsbState}</span>. Sweet spot for racing: +5 to +15. Good for hard training: −5 to −20. Goes red/shaded when negative.</p>
            </div>
            <div>
              <span className="text-zinc-300 font-semibold">TSS — Training Stress Score</span>
              <p className="mt-0.5">Each activity earns a score based on intensity × duration vs. your threshold. A 1-hour run at threshold pace = 100 TSS. An easy 30-min jog ≈ 30 TSS. A long ride ≈ 150–250 TSS.</p>
            </div>
          </div>
        );
      })()}

      {/* Chart */}
      {loading ? (
        <div className="h-[280px] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={tsbData} onClick={handleDayClick} style={{ cursor: "pointer" }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fill: "#71717A", fontSize: 11 }}
              tickLine={false}
              interval={Math.floor(data.length / 8)}
            />
            <YAxis
              tick={{ fill: "#71717A", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 6 }}
              labelStyle={{ color: "#A1A1AA", fontSize: 11 }}
              labelFormatter={(l) => formatDate(l)}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as typeof tsbData[0];
                return (
                  <div style={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
                    <p style={{ color: "#A1A1AA", marginBottom: 6 }}>{formatDate(String(label))}</p>
                    <p style={{ color: "#F43F5E" }}>Fatigue (ATL) : {row.atl?.toFixed(1)}</p>
                    <p style={{ color: "#3B82F6" }}>Fitness (CTL) : {row.ctl?.toFixed(1)}</p>
                    <p style={{ color: row.tsb >= 0 ? "#10B981" : "#F43F5E" }}>Form (TSB) : {row.tsb?.toFixed(1)}</p>
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#52525B" strokeDasharray="3 3" />

            {/* TSB shaded area — green above 0, rose below */}
            <Area dataKey="tsb_pos" fill="#059669" fillOpacity={0.15} stroke="none" legendType="none" tooltipType="none" />
            <Area dataKey="tsb_neg" fill="#F43F5E" fillOpacity={0.15} stroke="none" legendType="none" tooltipType="none" />

            {/* ATL — dashed rose */}
            <Line dataKey="atl" stroke="#FB7185" dot={false} strokeWidth={1.5} strokeDasharray="4 2" legendType="none" tooltipType="none" />
            {/* CTL — solid blue */}
            <Line dataKey="ctl" stroke="#3B82F6" dot={false} strokeWidth={2} legendType="none" tooltipType="none" />
            {/* TSB — single emerald line */}
            <Line dataKey="tsb" stroke="#10B981" dot={false} strokeWidth={1.5} legendType="none" tooltipType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {/* Guidance interpretation */}
      {data.length > 0 && (() => {
        const latest = data[data.length - 1];
        const tsb = latest.tsb ?? 0;
        const ctl = latest.ctl ?? 0;
        const ctlWeekAgo = data.length >= 7 ? (data[data.length - 7].ctl ?? 0) : null;
        const ctlTrend = ctlWeekAgo !== null ? ctl - ctlWeekAgo : null;

        let tsbMsg = "";
        let tsbColor = "text-zinc-400";
        if (tsb > 15) { tsbMsg = `Form +${tsb.toFixed(0)} — very fresh, ideal for a race or hard block`; tsbColor = "text-emerald-400"; }
        else if (tsb > 5) { tsbMsg = `Form +${tsb.toFixed(0)} — fresh, good time to train hard`; tsbColor = "text-emerald-400"; }
        else if (tsb >= -5) { tsbMsg = `Form ${tsb.toFixed(0)} — balanced, can push quality sessions`; tsbColor = "text-zinc-300"; }
        else if (tsb >= -20) { tsbMsg = `Form ${tsb.toFixed(0)} — building fatigue, manage intensity`; tsbColor = "text-amber-400"; }
        else { tsbMsg = `Form ${tsb.toFixed(0)} — high fatigue, recovery week recommended`; tsbColor = "text-rose-400"; }

        let ctlMsg = "";
        if (ctlTrend !== null) {
          if (ctlTrend > 5) ctlMsg = `CTL rising fast (+${ctlTrend.toFixed(1)} this week) — watch injury risk`;
          else if (ctlTrend > 1) ctlMsg = `CTL growing (+${ctlTrend.toFixed(1)} this week) — fitness building`;
          else if (ctlTrend >= -1) ctlMsg = "CTL stable — maintaining fitness";
          else ctlMsg = `CTL declining (${ctlTrend.toFixed(1)} this week) — load more or taper ending`;
        }

        let ironmanCtlMsg = "";
        if (ctl < 40) ironmanCtlMsg = `CTL ${ctl.toFixed(0)} — base phase. Target 60+ for half-Ironman, 80+ for Ironman.`;
        else if (ctl < 70) ironmanCtlMsg = `CTL ${ctl.toFixed(0)} — solid base. Ironman peak target is 80–100 CTL.`;
        else ironmanCtlMsg = `CTL ${ctl.toFixed(0)} — high fitness. Maintain through Ironman build phase.`;

        return (
          <div className="rounded-lg bg-[#0D0D0F] border border-[#27272A] p-3 space-y-1.5 text-xs">
            <p className={`font-medium ${tsbColor}`}>{tsbMsg}</p>
            {ctlMsg && <p className="text-zinc-400">{ctlMsg}</p>}
            <p className="text-zinc-500">{ironmanCtlMsg}</p>
          </div>
        );
      })()}

      {/* Day focus panel */}
      {focusDay && (
        <div className="rounded-lg border border-[#27272A] bg-[#18181B] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white">{formatDate(focusDay.date)}</span>
            <button onClick={() => setFocusDay(null)} className="text-zinc-500 hover:text-white text-xs">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div><span className="text-zinc-500">CTL</span><div className="text-blue-400 font-semibold">{focusDay.ctl?.toFixed(1)}</div></div>
            <div><span className="text-zinc-500">ATL</span><div className="text-rose-400 font-semibold">{focusDay.atl?.toFixed(1)}</div></div>
            <div><span className="text-zinc-500">TSB</span><div className={`font-semibold ${(focusDay.tsb ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{focusDay.tsb?.toFixed(1)}</div></div>
          </div>
          {focusDay.activities && focusDay.activities.length > 0 && (
            <div className="pt-1 border-t border-[#27272A]">
              <p className="text-xs text-zinc-500 mb-1.5">Activities</p>
              <div className="space-y-1">
                {focusDay.activities.map((a) => (
                  <a key={a.id} href={`/activity/${a.id}`} className="flex items-center justify-between text-xs hover:text-white transition-colors">
                    <span className="text-zinc-300 capitalize">{a.activity_type} — {a.name}</span>
                    <span className="text-zinc-500">{a.training_stress_score ? `${Math.round(a.training_stress_score)} TSS` : ""}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {focusDay.ramp_rate && Math.abs(focusDay.ramp_rate) > 7 && (
            <div className="text-xs text-amber-400">⚠ Ramp rate {focusDay.ramp_rate?.toFixed(1)} pts this week</div>
          )}
        </div>
      )}
    </div>
  );
}
