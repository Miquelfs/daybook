"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CloudRain, Wind } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Effect = {
  condition: string; label: string; enough_data: boolean; n_with: number; n_without: number;
  stress_with?: number; stress_without?: number; delta?: number; hr_delta?: number | null; t?: number;
  strength?: "strong" | "likely" | "unclear";
};
type Tough = {
  flight_id: string; date: string; route: string; stress_delta: number; hr_delta: number | null; you_flew: boolean;
  crew: string | null; weather: string; raw: string; notes: string | null; conditions: string[];
};
type Resp = {
  phase: string; flights: number; avg_stress_delta: number | null; effects: Effect[]; toughest: Tough[];
  coverage: { flights: number; with_metar: number; with_physio: number };
};

export function WeatherStress() {
  const [phase, setPhase] = useState<"landing" | "takeoff">("landing");
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["weather-stress", phase],
    queryFn: () => fetch(`${BASE}/aviation/weather-stress?phase=${phase}`, { cache: "no-store" }).then((r) => r.json()),
  });

  const shown = (data?.effects ?? []).filter((e) => e.enough_data);
  const max = Math.max(...shown.map((e) => Math.abs(e.delta ?? 0)), 1);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <p className="text-[10px] uppercase tracking-widest text-[#71717A] flex items-center gap-1.5"><Wind size={12} /> Weather × stress</p>
          <div className="flex rounded-lg border border-[#27272A] p-0.5">
            {(["landing", "takeoff"] as const).map((p) => (
              <button key={p} onClick={() => setPhase(p)}
                className={`px-3 py-1 text-[11px] rounded-md capitalize ${phase === p ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A]"}`}>{p}s</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-[#71717A] mb-4">
          Your stress spike in the {phase} window (vs the day's baseline) by the METAR at the {phase === "landing" ? "arrival" : "departure"} airport.
          {data ? ` ${data.flights} ${phase}s with both weather and physiology` : ""}
          {data?.avg_stress_delta != null ? ` · average spike +${data.avg_stress_delta}` : ""}.
        </p>

        {isLoading ? <div className="h-24 rounded-xl bg-[#18181B] animate-pulse" /> : shown.length === 0 ? (
          <p className="text-sm text-[#71717A]">
            Not enough flights with both a METAR and stress data yet
            ({data?.coverage.with_metar ?? 0} of {data?.coverage.flights ?? 0} flights have METARs,
            {" "}{data?.coverage.with_physio ?? 0} have stress data). The METAR backfill fills this in.
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((e) => {
              const up = (e.delta ?? 0) > 0;
              return (
                <li key={e.condition}>
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm text-[#E4E4E7] flex-1 min-w-0">{e.label}</p>
                    <span className={`text-sm font-semibold tabular-nums ${up ? "text-[#F87171]" : "text-[#4ADE80]"}`}>
                      {up ? "+" : ""}{e.delta} stress
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-1 flex-1 rounded-full bg-[#27272A] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(Math.abs(e.delta ?? 0) / max) * 100}%`, background: up ? "#F87171" : "#4ADE80" }} />
                    </div>
                    <span className="text-[10px] text-[#52525B] tabular-nums shrink-0">
                      {e.stress_with} vs {e.stress_without} · {e.n_with}/{e.n_without} {phase}s
                      {e.hr_delta != null ? ` · HR ${e.hr_delta > 0 ? "+" : ""}${e.hr_delta}` : ""} · {e.strength}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(data?.effects ?? []).some((e) => !e.enough_data) && shown.length > 0 && (
          <p className="text-[10px] text-[#52525B] mt-3">
            Too few {phase}s yet for: {(data?.effects ?? []).filter((e) => !e.enough_data).map((e) => e.label.split(" (")[0].toLowerCase()).join(", ")}.
          </p>
        )}
      </div>

      {(data?.toughest.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5">
          <p className="text-[10px] uppercase tracking-widest text-[#71717A] mb-3 flex items-center gap-1.5">
            <CloudRain size={12} /> Toughest {phase}s
          </p>
          <ul className="divide-y divide-[#18181B]">
            {data!.toughest.map((t) => (
              <li key={t.flight_id} className="py-2.5">
                <button onClick={() => setOpen(open === t.flight_id ? null : t.flight_id)} className="w-full text-left">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-[#E4E4E7] font-medium">{t.route}</span>
                    <span className="text-[11px] text-[#71717A]">{t.date}{t.you_flew ? " · you flew" : t.crew ? ` · ${t.crew}` : ""}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums text-[#F87171]">+{t.stress_delta}</span>
                  </div>
                  <p className="text-[11px] text-[#A1A1AA] mt-0.5">{t.weather}</p>
                  {t.notes && <p className="text-[11px] text-[#F59E0B] mt-0.5">“{t.notes}”</p>}
                </button>
                {open === t.flight_id && (
                  <p className="mt-1.5 font-mono text-[10px] text-[#71717A] break-all bg-[#18181B] rounded-lg px-2.5 py-1.5">{t.raw}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
