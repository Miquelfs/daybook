"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { Clock } from "lucide-react";
import { api, type FlightPunctuality } from "@/lib/api";

// Status/severity ramp (reserved status colours, ordered by delay size)
const GOOD = "#10B981";   // on time
const LATE = "#EF4444";   // lates
const SEV: Record<string, string> = {
  on_time: "#10B981",
  "16_30": "#F59E0B",
  "31_60": "#F97316",
  over_60: "#EF4444",
};
const SEV_LABEL: Record<string, string> = {
  on_time: "On time (≤15m)",
  "16_30": "16–30m",
  "31_60": "31–60m",
  over_60: "60m+",
};

function StatTile({ label, value, unit, tone }: {
  label: string; value: string | number; unit?: string; tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-3">
      <span className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</span>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: tone ?? "#FAFAFA" }}>
        {value}
        {unit && <span className="text-sm font-normal text-[#71717A] ml-1">{unit}</span>}
      </span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HourTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-[#71717A] mb-1">{String(d.hour).padStart(2, "0")}:00 UTC · {d.flights} flights</p>
      <p className="text-[#FAFAFA] font-semibold">{d.avg_delay_min}m avg delay</p>
      <p className="text-[#52525B]">{d.on_time_pct}% on time</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MonthTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-[#71717A] mb-1">{d.month} · {d.flights} flights</p>
      <p className="text-[#FAFAFA] font-semibold">{d.avg_delay_min}m avg delay</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{children}</h2>;
}

export function PunctualityTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["flight-punctuality"],
    queryFn: () => api.flightPunctuality(),
  });

  if (isLoading) {
    return <div className="h-64 bg-[#18181B] rounded-xl animate-pulse" />;
  }
  if (!data || !data.available) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-12 text-center">
        <p className="text-sm text-[#52525B]">
          No delay data yet — punctuality needs flights with recorded delay codes.
        </p>
      </div>
    );
  }

  const p = data as Required<FlightPunctuality>;
  const el = p.earlies_vs_lates;
  const dist = p.distribution;
  const distTotal = dist.on_time + dist["16_30"] + dist["31_60"] + dist.over_60;
  const distSegs = (["on_time", "16_30", "31_60", "over_60"] as const)
    .map((k) => ({ k, count: dist[k], pct: distTotal ? (dist[k] / distTotal) * 100 : 0 }))
    .filter((s) => s.count > 0);
  const maxRoute = Math.max(1, ...p.worst_routes.map((r) => r.avg_delay_min));

  return (
    <div className="flex flex-col gap-10">
      {/* Headline stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="On time (≤15m)" value={p.on_time_pct} unit="%"
          tone={p.on_time_pct >= 70 ? GOOD : p.on_time_pct >= 50 ? "#F59E0B" : LATE} />
        <StatTile label="Avg delay" value={p.avg_delay_min} unit="m" />
        <StatTile label="Median delay" value={p.median_delay_min} unit="m" />
        <StatTile label="Flights" value={p.total_flights} />
      </div>

      {/* Earlies vs lates — the headline insight */}
      <section>
        <SectionLabel>Earlies vs lates (off-block before / after {el.split_hour_utc}:00 UTC)</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          {([["Earlies", el.earlies, GOOD], ["Lates", el.lates, LATE]] as const).map(
            ([name, g, color]) => (
              <div key={name} className="rounded-xl border border-[#27272A] bg-[#18181B] px-4 py-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-sm text-[#A1A1AA]">{name}</span>
                  <span className="text-xs text-[#52525B] ml-auto">{g.flights} flights</span>
                </div>
                <div className="text-3xl font-semibold tabular-nums" style={{ color }}>
                  {g.on_time_pct ?? "—"}<span className="text-base font-normal text-[#71717A] ml-1">% on time</span>
                </div>
                <div className="text-xs text-[#71717A] mt-1">{g.avg_delay_min ?? "—"}m average delay</div>
              </div>
            )
          )}
        </div>
        {el.earlies.avg_delay_min != null && el.lates.avg_delay_min != null && (
          <p className="flex items-center gap-1.5 text-xs text-[#71717A] mt-2">
            <Clock size={12} />
            Later departures inherit the day&apos;s accumulated delay —
            <span className="text-[#A1A1AA]">
              {" "}lates average {(el.lates.avg_delay_min - el.earlies.avg_delay_min).toFixed(0)}m more delay
            </span>.
          </p>
        )}
      </section>

      {/* Delay by departure hour — money chart, coloured by early/late */}
      <section>
        <SectionLabel>Average delay by departure hour (UTC)</SectionLabel>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={p.by_departure_hour} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
            <XAxis dataKey="hour" tickFormatter={(v) => `${String(v).padStart(2, "0")}`}
              tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => `${v}m`} tick={{ fill: "#52525B", fontSize: 10 }}
              tickLine={false} axisLine={false} width={34} />
            <Tooltip content={<HourTooltip />} cursor={{ fill: "#27272A" }} />
            <ReferenceLine y={p.avg_delay_min} stroke="#71717A" strokeDasharray="4 2" strokeWidth={1} />
            <Bar dataKey="avg_delay_min" radius={[2, 2, 0, 0]}>
              {p.by_departure_hour.map((d) => (
                <Cell key={d.hour} fill={d.hour < el.split_hour_utc ? GOOD : LATE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-1 text-xs text-[#71717A]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GOOD }} />Earlies</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: LATE }} />Lates</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-[#71717A]" />overall {p.avg_delay_min}m
          </span>
        </div>
      </section>

      {/* Delay-size distribution — 100% stacked bar */}
      <section>
        <SectionLabel>Delay distribution</SectionLabel>
        <div className="flex w-full h-7 rounded-lg overflow-hidden gap-[2px]">
          {distSegs.map((s) => (
            <div key={s.k} className="h-full flex items-center justify-center" title={`${SEV_LABEL[s.k]}: ${s.count}`}
              style={{ width: `${s.pct}%`, background: SEV[s.k], minWidth: s.pct > 0 ? 3 : 0 }}>
              {s.pct >= 9 && <span className="text-[10px] font-medium text-black/70 tabular-nums">{Math.round(s.pct)}%</span>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#71717A]">
          {(["on_time", "16_30", "31_60", "over_60"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SEV[k] }} />
              {SEV_LABEL[k]} <span className="text-[#52525B] tabular-nums">{dist[k]}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Worst routes */}
      {p.worst_routes.length > 0 && (
        <section>
          <SectionLabel>Least punctual routes (≥3 flights)</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {p.worst_routes.map((r) => (
              <div key={r.route} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-[#A1A1AA] tabular-nums">{r.route}</span>
                <div className="flex-1 h-4 bg-[#18181B] rounded-sm overflow-hidden">
                  <div className="h-full rounded-sm" style={{ width: `${(r.avg_delay_min / maxRoute) * 100}%`, background: "#F97316" }} />
                </div>
                <span className="w-14 shrink-0 text-right text-[#FAFAFA] tabular-nums">{r.avg_delay_min}m</span>
                <span className="w-10 shrink-0 text-right text-[#52525B] tabular-nums">{r.flights}✈</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* By month */}
      {p.by_month.length > 1 && (
        <section>
          <SectionLabel>Average delay by month</SectionLabel>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={p.by_month} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
              <XAxis dataKey="month" tickFormatter={(v) => v.slice(2)} tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false} axisLine={false} interval={Math.floor(p.by_month.length / 12)} />
              <YAxis tickFormatter={(v) => `${v}m`} tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false} axisLine={false} width={34} />
              <Tooltip content={<MonthTooltip />} cursor={{ fill: "#27272A" }} />
              <Bar dataKey="avg_delay_min" fill="#F59E0B" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}
    </div>
  );
}
