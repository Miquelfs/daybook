"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlightRouteMap, type MapStyle } from "@/components/aviation/FlightRouteMap";
import { passengerFlightsApi, type FlightAnalytics } from "@/lib/passenger-flights-api";
import { AIRLINE_COLORS, DEFAULT_AIRLINE_COLOR } from "@/lib/airline-colors";

type CodeMode = "icao" | "iata";

// Accent palette per card — echoes MyFlightRadar's colour-coded panels, tuned
// for the dark theme (one hue per card, bars a translucent tint of it).
const ACCENTS = {
  emerald: "#34D399",
  amber: "#F59E0B",
  rose: "#F87171",
  violet: "#A78BFA",
  teal: "#2DD4BF",
  sky: "#38BDF8",
};


export function FlightStats({ a }: { a: FlightAnalytics }) {
  const t = a.totals;

  const [codeMode, setCodeMode] = useState<CodeMode>("iata");
  const [mapStyle, setMapStyle] = useState<MapStyle>("dark");
  const [mapYear, setMapYear] = useState<string>("");

  const years = useMemo(
    () => Object.keys(a.flights_per_year).sort((x, y) => y.localeCompare(x)),
    [a.flights_per_year],
  );

  // Map data follows the year selector; all-time comes straight from analytics.
  const { data: mapData } = useQuery({
    queryKey: ["passenger-map", mapYear],
    queryFn: () => passengerFlightsApi.map(mapYear || undefined),
    initialData: { routes_geo: a.routes_geo, airports_geo: a.airports_geo },
    enabled: mapYear !== "",
  });
  const routes = mapYear ? (mapData?.routes_geo ?? []) : a.routes_geo;
  const airports = mapYear ? (mapData?.airports_geo ?? []) : a.airports_geo;

  const yearBars = useMemo(() => {
    const entries = Object.entries(a.flights_per_year).sort(([x], [y]) => x.localeCompare(y));
    const max = Math.max(1, ...entries.map(([, n]) => n));
    return { entries, max };
  }, [a.flights_per_year]);

  return (
    <div className="flex flex-col gap-6">
      {/* Hero totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Hero label="Flights" value={t.flights.toLocaleString()}
          sub={`${t.domestic} domestic · ${t.international} intl`} />
        <Hero label="Distance" value={`${t.distance_mi.toLocaleString()} mi`}
          sub={`${t.distance_km.toLocaleString()} km`} />
        <Hero label="In the air" value={`${Math.floor(t.hours)}h ${Math.round((t.hours % 1) * 60)}m`}
          sub={`${(t.hours / 24).toFixed(1)} days`} />
        <Hero label="CO₂" value={`${t.co2_tons} t`} sub="estimated" />
      </div>

      {/* Secondary chips */}
      <div className="flex flex-wrap gap-2">
        <Chip label="Airports" value={t.distinct_airports} />
        <Chip label="Airlines" value={t.distinct_airlines} />
        <Chip label="Aircraft" value={t.distinct_aircraft} />
        <Chip label="Countries" value={t.distinct_countries} />
        <Chip label="Routes" value={t.distinct_routes} />
        <Chip label="Years flying" value={t.years_flying} />
      </div>

      {/* World map — routes coloured by airline, with view controls */}
      {a.routes_geo.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Segmented options={[["icao", "ICAO"], ["iata", "IATA"]]}
              value={codeMode} onChange={(v) => setCodeMode(v as CodeMode)} />
            <Segmented options={[["dark", "Dark"], ["light", "Light"], ["satellite", "Sat"]]}
              value={mapStyle} onChange={(v) => setMapStyle(v as MapStyle)} />
            <select value={mapYear} onChange={(e) => setMapYear(e.target.value)}
              className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA]">
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="rounded-xl overflow-hidden border border-[#27272A]">
            {routes.length > 0 ? (
              <FlightRouteMap
                routes={routes}
                airports={airports}
                height="420px"
                basesIcao={["LEBL"]}
                baseColors={{ LEBL: ACCENTS.amber }}
                codeMode={codeMode}
                mapStyle={mapStyle}
                airlineColors={AIRLINE_COLORS}
              />
            ) : (
              <div className="h-40 flex items-center justify-center text-[#52525B] text-sm">
                No flights in {mapYear}.
              </div>
            )}
          </div>
          {/* Airline colour legend — only the airlines actually flown */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {a.top_airlines.map((al) => (
              <span key={al.airline} className="inline-flex items-center gap-1.5 text-[11px] text-[#A1A1AA]">
                <span className="w-3 h-[3px] rounded-full"
                  style={{ background: AIRLINE_COLORS[al.airline] ?? DEFAULT_AIRLINE_COLOR }} />
                {al.airline}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Colour-coded top lists */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BarCard title="Top airports" accent={ACCENTS.emerald}
          items={a.top_airports.map((x) => ({ label: x.code, sub: x.city ?? undefined, count: x.count }))} />
        <BarCard title="Top airlines" accent={ACCENTS.amber}
          items={a.top_airlines.map((x) => ({
            label: x.airline, count: x.count,
            color: AIRLINE_COLORS[x.airline] ?? DEFAULT_AIRLINE_COLOR,
          }))} />
        <BarCard title="Top aircraft" accent={ACCENTS.rose}
          items={a.top_aircraft.map((x) => ({ label: x.code, count: x.count }))} />
        <BarCard title="Top routes" accent={ACCENTS.violet}
          items={a.top_routes.map((x) => ({ label: x.route, count: x.count }))} />
        <BarCard title="Top countries" accent={ACCENTS.teal}
          items={a.top_countries.map((x) => ({ label: x.country, count: x.count }))} />

        {/* Flights per year */}
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest"
            style={{ color: ACCENTS.sky }}>Flights per year</div>
          <div className="px-4 py-3 flex items-end gap-1.5 h-[168px]">
            {yearBars.entries.map(([year, n]) => (
              <div key={year} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                <span className="text-[10px] text-[#71717A] tabular-nums">{n}</span>
                <div className="w-full rounded-t"
                  style={{ height: `${(n / yearBars.max) * 100}%`, background: ACCENTS.sky, minHeight: 2 }} />
                <span className="text-[9px] text-[#52525B] rotate-0 tabular-nums">{year.slice(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cabin / seat / reason splits */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SplitCard title="Class" data={a.class_breakdown} accent={ACCENTS.emerald} />
        <SplitCard title="Seat" data={a.seat_breakdown} accent={ACCENTS.sky} />
        <SplitCard title="Reason" data={a.reason_breakdown} accent={ACCENTS.violet} />
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange }: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center bg-[#18181B] border border-[#27272A] rounded-lg p-0.5">
      {options.map(([val, label]) => (
        <button key={val} onClick={() => onChange(val)}
          className={`px-2.5 py-0.5 text-xs rounded-md transition-colors ${
            value === val ? "bg-sky-600 text-white" : "text-[#71717A] hover:text-[#A1A1AA]"
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Hero({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-0.5 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs bg-[#18181B] border border-[#27272A] rounded-full px-3 py-1">
      <span className="font-semibold tabular-nums text-[#FAFAFA]">{value}</span>
      <span className="text-[#52525B]">{label}</span>
    </span>
  );
}

function BarCard({ title, accent, items }: {
  title: string;
  accent: string;
  items: { label: string; sub?: string; count: number; color?: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
        {title}
      </div>
      <div className="px-4 pb-3 flex flex-col gap-1.5">
        {items.length === 0 && <p className="text-xs text-[#52525B] pb-1">No data yet</p>}
        {items.map((it, i) => {
          const c = it.color ?? accent;
          return (
            <div key={i} className="relative flex items-center h-6 rounded overflow-hidden bg-[#18181B]">
              <div className="absolute inset-y-0 left-0 rounded"
                style={{ width: `${(it.count / max) * 100}%`, background: `${c}26` }} />
              <span className="relative z-10 px-2 text-xs text-[#FAFAFA] truncate">
                {it.label}{it.sub && <span className="text-[#52525B]"> · {it.sub}</span>}
              </span>
              <span className="relative z-10 ml-auto px-2 text-xs tabular-nums" style={{ color: c }}>
                {it.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SplitCard({ title, data, accent }: { title: string; data: Record<string, number>; accent: string }) {
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-widest" style={{ color: accent }}>
        {title}
      </div>
      <div className="px-4 pb-3 flex flex-col gap-1.5">
        {entries.length === 0 && <p className="text-xs text-[#52525B]">No data yet</p>}
        {entries.map(([k, n]) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="text-[#A1A1AA] w-20 truncate">{k}</span>
            <div className="flex-1 h-1.5 rounded-full bg-[#18181B] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(n / total) * 100}%`, background: accent }} />
            </div>
            <span className="tabular-nums text-[#71717A] w-6 text-right">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
