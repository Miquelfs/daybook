"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudSun, PlaneLanding, Package } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Metar = {
  phase: "takeoff" | "landing"; station: string; obs_time: string; raw: string;
  wind_dir: number | null; wind_kt: number | null; gust_kt: number | null; vis_m: number | null;
  ceiling_ft: number | null; wx: string | null; temp_c: number | null; qnh_hpa: number | null; category: string | null;
};
type RunwayResp = {
  current: { runway: string; source: "manual" | "adsb" | "wind"; confidence: string;
             headwind_kt: number | null; crosswind_kt: number | null } | null;
  options: string[];
  airport?: string | null;
  takeoff: { runway: string; source: string; headwind_kt: number | null; crosswind_kt: number | null } | null;
  takeoff_options: string[];
  takeoff_airport?: string | null;
};

const SOURCE: Record<string, string> = { manual: "set by you", adsb: "from ADS-B track", wind: "likely, from wind" };
const CAT: Record<string, string> = { VFR: "text-[#4ADE80]", MVFR: "text-[#60A5FA]", IFR: "text-[#F87171]", LIFR: "text-[#E879F9]" };

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#18181B] rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[#52525B]">{icon}</span>
        <p className="text-xs font-medium text-[#71717A] uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

function wind(m: Metar) {
  if (m.wind_kt == null) return "—";
  const dir = m.wind_dir == null ? "VRB" : `${String(m.wind_dir).padStart(3, "0")}°`;
  return `${dir} ${m.wind_kt}${m.gust_kt ? `G${m.gust_kt}` : ""} kt`;
}

/** Landing runway (pick / correct it) + the METARs at takeoff and landing. */
export function FlightWeatherRunway({ flightId, isSim }: { flightId: string; isSim?: boolean }) {
  const qc = useQueryClient();
  const { data: rw } = useQuery<RunwayResp>({
    queryKey: ["flight-runway", flightId],
    queryFn: () => fetch(`${BASE}/flights/${encodeURIComponent(flightId)}/runway`).then((r) => r.json()),
    enabled: !isSim,
  });
  const { data: metars = [] } = useQuery<Metar[]>({
    queryKey: ["flight-metars", flightId],
    queryFn: () => fetch(`${BASE}/flights/${encodeURIComponent(flightId)}/metars`).then((r) => r.json()),
    enabled: !isSim,
  });
  const { data: loads = [] } = useQuery<{
    id: number; source: string; pax_total?: number; pax_adult?: number; pax_child?: number; pax_infant?: number;
    zones?: Record<string, number>; holds_kg?: Record<string, number>; bags_pcs?: number; baggage_kg?: number;
    freight_kg?: number; avg_bag_kg?: number; hold_total_kg?: number; remarks?: string; message_time_utc?: string;
  }[]>({
    queryKey: ["flight-loadsheets", flightId],
    queryFn: () => fetch(`${BASE}/flights/${encodeURIComponent(flightId)}/loadsheets`).then((r) => r.json()),
    enabled: !isSim,
  });
  if (isSim) return null;
  const load = loads[loads.length - 1];

  async function pick(r: string, phase: "takeoff" | "landing") {
    await fetch(`${BASE}/flights/${encodeURIComponent(flightId)}/runway`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runway: r, phase }),
    });
    qc.invalidateQueries({ queryKey: ["flight-runway", flightId] });
  }

  const cur = rw?.current;
  return (
    <>
      <Card title="Runways" icon={<PlaneLanding size={14} />}>
        <div className="space-y-4">
          <RunwayPicker label="Takeoff" airport={rw?.takeoff_airport} options={rw?.takeoff_options ?? []}
            current={rw?.takeoff ? { ...rw.takeoff, source: rw.takeoff.source } : null}
            onPick={(r) => pick(r, "takeoff")} />
          <RunwayPicker label="Landing" airport={rw?.airport} options={rw?.options ?? []}
            current={cur ?? null} onPick={(r) => pick(r, "landing")} />
        </div>
      </Card>

      <Card title="Weather (METAR)" icon={<CloudSun size={14} />}>
        {metars.length === 0 ? (
          <p className="text-xs text-[#71717A]">No METAR yet for this flight. They're fetched overnight for takeoff and landing.</p>
        ) : (
          <div className="space-y-3">
            {metars.map((m) => (
              <div key={m.phase}>
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-[#E4E4E7] capitalize w-16">{m.phase}</span>
                  <span className="text-xs text-[#A1A1AA]">{m.station} · {m.obs_time.slice(11, 16)}Z</span>
                  {m.category && <span className={`ml-auto text-[11px] font-semibold ${CAT[m.category] ?? ""}`}>{m.category}</span>}
                </div>
                <p className="text-sm text-[#FAFAFA] mt-0.5">
                  {wind(m)}
                  {m.vis_m != null ? ` · ${m.vis_m >= 10000 ? "10+" : (m.vis_m / 1000).toFixed(1)} km` : ""}
                  {m.ceiling_ft != null ? ` · ceiling ${m.ceiling_ft} ft` : ""}
                  {m.wx ? ` · ${m.wx}` : ""}
                  {m.temp_c != null ? ` · ${m.temp_c}°C` : ""}
                  {m.qnh_hpa != null ? ` · Q${m.qnh_hpa}` : ""}
                </p>
                <p className="font-mono text-[10px] text-[#52525B] mt-0.5 break-all">{m.raw}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      {load && (
        <Card title="Load (final figures)" icon={<Package size={14} />}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-[#09090B] py-2">
              <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{load.pax_total ?? "—"}</p>
              <p className="text-[10px] text-[#71717A]">pax{load.pax_infant ? ` + ${load.pax_infant} inf` : ""}</p>
            </div>
            <div className="rounded-lg bg-[#09090B] py-2">
              <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{load.bags_pcs ?? "—"}</p>
              <p className="text-[10px] text-[#71717A]">bags{load.avg_bag_kg ? ` · ${load.avg_bag_kg} kg avg` : ""}</p>
            </div>
            <div className="rounded-lg bg-[#09090B] py-2">
              <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{load.hold_total_kg ?? load.baggage_kg ?? "—"}</p>
              <p className="text-[10px] text-[#71717A]">kg in holds{load.freight_kg ? ` · ${load.freight_kg} cargo` : ""}</p>
            </div>
          </div>
          <p className="text-[11px] text-[#71717A] mt-2">
            {load.pax_adult != null ? `${load.pax_adult} adults · ${load.pax_child ?? 0} children · ${load.pax_infant ?? 0} infants` : ""}
            {load.zones ? ` · zones ${Object.entries(load.zones).map(([z, n]) => `${z}${n}`).join("/")}` : ""}
            {load.holds_kg ? ` · holds ${Object.entries(load.holds_kg).map(([h, kg]) => `${h}:${kg}`).join(" ")}` : ""}
          </p>
          {load.remarks && <p className="text-[11px] text-[#A1A1AA] mt-1">{load.remarks}</p>}
        </Card>
      )}
    </>
  );
}


function RunwayPicker({ label, airport, options, current, onPick }: {
  label: string; airport?: string | null; options: string[];
  current: { runway: string; source: string; headwind_kt: number | null; crosswind_kt: number | null } | null;
  onPick: (r: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const likely = current?.source === "wind";
  return (
    <div>
      <p className="text-[11px] text-[#71717A] mb-1.5">{label}{airport ? ` · ${airport}` : ""}</p>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {options.map((r) => {
            const on = current?.runway === r || (likely && current!.runway.split("/").includes(r));
            return (
              <button key={r} onClick={() => onPick(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-mono border transition-colors ${
                  on && !likely ? "bg-[#F59E0B] text-[#09090B] border-transparent font-semibold"
                    : on ? "border-[#F59E0B]/40 text-[#F59E0B]" : "border-[#27272A] text-[#A1A1AA] hover:border-[#3F3F46]"}`}>
                {r}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="e.g. 24L" maxLength={4}
            className="w-24 bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-1.5 text-base sm:text-sm font-mono text-[#FAFAFA] outline-none focus:border-[#52525B]" />
          <button onClick={() => typed && onPick(typed)} disabled={!typed}
            className="px-3 py-1.5 rounded-lg text-xs bg-[#27272A] text-[#A1A1AA] disabled:opacity-40">Save</button>
        </div>
      )}
      <p className="text-[11px] text-[#71717A] mt-1.5">
        {current ? <>RWY {current.runway}{likely ? " · likely, from wind — tap to set" : ""}
          {current.headwind_kt != null ? ` · ${current.headwind_kt >= 0 ? "headwind" : "tailwind"} ${Math.abs(current.headwind_kt)} kt` : ""}
          {current.crosswind_kt != null ? ` · crosswind ${current.crosswind_kt} kt` : ""}</>
          : "Tap the runway you used."}
      </p>
    </div>
  );
}
