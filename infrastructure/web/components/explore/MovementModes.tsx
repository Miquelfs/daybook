"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bike, Car, Footprints, Plane, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ink } from "@/lib/duty";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Mode = "foot" | "run" | "bike" | "vehicle" | "flight";
type Row = { days: number } & Record<Mode, number>;
type Modes = {
  days: number; totals: Record<Mode, number>; ground_km: number; self_powered_km: number; active_days: number;
  monthly: (Row & { month: string })[]; yearly: (Row & { year: string })[];
  records: Partial<Record<Mode, { date: string; km: number }>>;
  top_ground_days: { date: string; foot: number; run: number; bike: number; vehicle: number }[];
};

const META: Record<Mode, { label: string; color: string; Icon: typeof Bike }> = {
  foot:    { label: "On foot",  color: "#10B981", Icon: Footprints },
  run:     { label: "Running",  color: "#FB923C", Icon: Zap },
  bike:    { label: "Cycling",  color: "#3B82F6", Icon: Bike },
  vehicle: { label: "Road & rail", color: "#A1A1AA", Icon: Car },
  flight:  { label: "Flying",   color: "#8B5CF6", Icon: Plane },
};
const SELF: Mode[] = ["foot", "run", "bike"];
const EARTH_KM = 40075;

const km = (v: number) => v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MonthTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Row & { month: string };
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
      <p className="text-[#A1A1AA] mb-1">{new Date(`${r.month}-15T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
      {(Object.keys(META) as Mode[]).filter((m) => r[m] > 0).map((m) => (
        <p key={m} className="flex justify-between gap-4"><span style={{ color: ink(META[m].color) }}>{META[m].label}</span>
          <span className="tabular-nums text-[#FAFAFA]">{Math.round(r[m]).toLocaleString("en-GB")} km</span></p>
      ))}
    </div>
  );
}

/** Movement by how you moved — your own power first; road, rail and flights kept apart so they don't drown it. */
export function MovementModes({ year }: { year?: number }) {
  const { data } = useQuery<Modes>({
    queryKey: ["movement-modes", year ?? "all"],
    queryFn: () => fetch(`${BASE}/locations/movement/modes${year ? `?year=${year}` : ""}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const [withVehicle, setWithVehicle] = useState(false);
  if (!data) return <div className="h-64 rounded-3xl border border-[#27272A] bg-[#0D0D0F] animate-pulse" />;
  if (!data.days) {
    return <p className="text-sm text-[#52525B] border border-dashed border-[#27272A] rounded-2xl px-4 py-10 text-center">No movement data yet.</p>;
  }
  const t = data.totals;
  const chartModes: Mode[] = withVehicle ? [...SELF, "vehicle"] : SELF;
  const months = year ? data.monthly : data.monthly.slice(-24);

  return (
    <div className="space-y-8">
      {/* Hero — your own power */}
      <section className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] p-5 sm:p-6">
        <p className="text-[10px] text-[#71717A] uppercase tracking-widest">Under your own power{year ? ` · ${year}` : " · all time"}</p>
        <p className="mt-1 leading-none">
          <span className="text-5xl font-semibold tabular-nums" style={{ color: ink("#10B981") }}>
            {Math.round(data.self_powered_km).toLocaleString("en-GB")}
          </span>
          <span className="text-base text-[#71717A] ml-1.5">km</span>
        </p>
        <p className="text-sm text-[#A1A1AA] mt-2">
          {data.active_days} active days (5 km+ on foot or bike) of {data.days} tracked
        </p>
        {/* share bar of the self-powered modes */}
        <div className="flex h-2.5 rounded-full overflow-hidden mt-4 gap-0.5">
          {SELF.map((m) => t[m] > 0 && (
            <span key={m} style={{ width: `${(t[m] / Math.max(1, data.self_powered_km)) * 100}%`, background: META[m].color }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[#71717A]">
          {SELF.map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: META[m].color }} />
              {META[m].label} <b className="text-[#D4D4D8] tabular-nums">{Math.round(t[m]).toLocaleString("en-GB")}</b>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-5 pt-4 border-t border-[#18181B]">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#18181B]"><Car size={16} className="text-[#A1A1AA]" /></span>
            <div>
              <p className="text-lg font-semibold tabular-nums leading-none">{km(t.vehicle)} <span className="text-xs text-[#71717A] font-normal">km</span></p>
              <p className="text-[11px] text-[#71717A] mt-0.5">road & rail</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, #8B5CF6 14%, transparent)" }}>
              <Plane size={16} style={{ color: ink("#8B5CF6") }} />
            </span>
            <div>
              <p className="text-lg font-semibold tabular-nums leading-none">{km(t.flight)} <span className="text-xs text-[#71717A] font-normal">km</span></p>
              <p className="text-[11px] text-[#71717A] mt-0.5">flying · {(t.flight / EARTH_KM).toFixed(1)}× round the Earth</p>
            </div>
          </div>
        </div>
      </section>

      {/* Month by month */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Month by month{year ? "" : " · last 2 years"}</h2>
          <button onClick={() => setWithVehicle((v) => !v)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${withVehicle
                    ? "border-[#A1A1AA] text-[#D4D4D8]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
            {withVehicle ? "✓ " : "+ "}road & rail
          </button>
        </div>
        <div className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] px-3 pt-4 pb-2">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={months} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--viz-axis)", fontSize: 10 }}
                     tickFormatter={(v: string) => new Date(`${v}-15T12:00:00`).toLocaleDateString("en-GB", { month: "short" })}
                     interval={months.length > 14 ? 2 : 0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--viz-axis)", fontSize: 10 }} width={34} tickFormatter={km} />
              <Tooltip content={<MonthTip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
              {chartModes.map((m, i) => (
                <Bar key={m} dataKey={m} stackId="a" fill={META[m].color}
                     radius={i === chartModes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Records */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Biggest days</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(Object.keys(META) as Mode[]).map((m) => {
            const r = data.records[m];
            if (!r) return null;
            const { Icon, color, label } = META[m];
            return (
              <Link key={m} href={`/day/${r.date}`}
                    className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-3.5 hover:border-[#3F3F46] transition-colors">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
                  <Icon size={15} style={{ color: ink(color) }} />
                </span>
                <p className="text-xl font-semibold tabular-nums mt-2 leading-none">{km(r.km)} <span className="text-xs text-[#71717A] font-normal">km</span></p>
                <p className="text-[11px] text-[#A1A1AA] mt-1">{label}</p>
                <p className="text-[11px] text-[#52525B]">{day(r.date)}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Top ground days */}
      {data.top_ground_days.length > 0 && (
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Most ground covered</h2>
          <div className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] divide-y divide-[#18181B] overflow-hidden">
            {data.top_ground_days.map((g, i) => {
              const total = g.foot + g.run + g.bike + g.vehicle;
              return (
                <Link key={g.date} href={`/day/${g.date}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#111113]">
                  <span className="text-xs text-[#52525B] tabular-nums w-4">{i + 1}</span>
                  <span className="text-sm text-[#D4D4D8] w-28 shrink-0 tabular-nums">{day(g.date)}</span>
                  <span className="flex-1 flex h-2 rounded-full overflow-hidden bg-[#18181B]">
                    {(["foot", "run", "bike", "vehicle"] as const).map((m) => g[m] > 0 && (
                      <span key={m} style={{ width: `${(g[m] / Math.max(1, data.top_ground_days[0].foot + data.top_ground_days[0].run + data.top_ground_days[0].bike + data.top_ground_days[0].vehicle)) * 100}%`, background: META[m].color }} />
                    ))}
                  </span>
                  <span className="text-sm font-semibold tabular-nums w-16 text-right">{Math.round(total)} km</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Year by year (all time) */}
      {!year && data.yearly.length > 1 && (
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Year by year · own power</h2>
          <div className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] p-4 space-y-2.5">
            {[...data.yearly].reverse().map((y) => {
              const self = y.foot + y.run + y.bike;
              const max = Math.max(...data.yearly.map((r) => r.foot + r.run + r.bike), 1);
              return (
                <Link key={y.year} href={`/explore/movement?year=${y.year}`} className="flex items-center gap-3 group">
                  <span className="text-xs text-[#71717A] group-hover:text-[#FAFAFA] tabular-nums w-10">{y.year}</span>
                  <span className="flex-1 flex h-2.5 rounded-full overflow-hidden bg-[#18181B]">
                    {SELF.map((m) => y[m] > 0 && (
                      <span key={m} style={{ width: `${(y[m] / max) * 100}%`, background: META[m].color }} />
                    ))}
                  </span>
                  <span className="text-sm font-medium tabular-nums w-20 text-right">{Math.round(self).toLocaleString("en-GB")} km</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <p className="text-[11px] text-[#52525B] leading-relaxed">
        Google timeline modes until May 2026 (re-read by speed: a &ldquo;walk&rdquo; at car speed is a ride, a 3,000 km
        &ldquo;drive&rdquo; is a flight); since then GPS hops over 300 km or above 160 km/h are flights, walking comes from
        your steps and runs / rides from Garmin, and the rest of the ground distance is road &amp; rail.
      </p>
    </div>
  );
}
