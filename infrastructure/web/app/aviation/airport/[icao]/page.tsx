"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ArrowLeft, Clock, MapPin, PlaneTakeoff, PlaneLanding, Calendar, Moon } from "lucide-react";

function secToHHMM(s: number): string {
  if (!s) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

const AIRCRAFT_ALIASES: Record<string, string> = {
  "Boeing 737 MAX 8-200": "Boeing 737 MAX 8",
  "Boeing 737-8AS": "Boeing 737-800",
};

function shortType(raw: string | null): string {
  if (!raw) return "?";
  return AIRCRAFT_ALIASES[raw] ?? raw;
}

function formatPicName(raw: string | null): string {
  if (!raw) return "";
  if (/^[A-Za-z]{6}$/.test(raw.trim())) return raw.trim().toUpperCase();
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return raw.toUpperCase();
  return `${parts[0][0].toUpperCase()}.${parts.slice(1).join(" ").toUpperCase()}`;
}

export default function AirportPage() {
  const { icao } = useParams<{ icao: string }>();
  const router = useRouter();
  const code = icao.toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ["airportFlights", code],
    queryFn: () => api.airportFlights(code),
    enabled: !!code,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-sky-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#09090B] p-6">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-[#71717A] hover:text-[#FAFAFA] mb-6 text-sm">
          <ArrowLeft size={14} /> Back
        </button>
        <p className="text-[#71717A]">No flights found for <span className="font-mono text-[#FAFAFA]">{code}</span>.</p>
      </div>
    );
  }

  const flights = data.flights as Record<string, unknown>[];

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-[#71717A] hover:text-[#FAFAFA] mb-6 text-sm transition-colors">
          <ArrowLeft size={14} /> Back
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="w-10 h-10 rounded-xl bg-sky-950/40 flex items-center justify-center flex-shrink-0">
            <MapPin size={18} className="text-sky-400" />
          </div>
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-bold tracking-tight font-mono">{data.icao}</h1>
              {data.iata && <span className="text-[#71717A] font-mono text-lg">{data.iata}</span>}
            </div>
            <p className="text-[#A1A1AA] text-sm mt-0.5">{data.name}</p>
            <p className="text-[#52525B] text-xs mt-0.5">{[data.city, data.country].filter(Boolean).join(", ")}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {[
            { label: "Movements", value: String(data.total_movements), icon: <MapPin size={12} /> },
            { label: "Departures", value: String(data.departures), icon: <PlaneTakeoff size={12} /> },
            { label: "Arrivals", value: String(data.arrivals), icon: <PlaneLanding size={12} /> },
            { label: "Night ops here", value: String(data.night_movements), icon: <Moon size={12} /> },
            { label: "Block time", value: secToHHMM(data.total_block_seconds), icon: <Clock size={12} /> },
            { label: "First visit", value: data.first_visit ?? "—", icon: <Calendar size={12} /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="bg-[#18181B] border border-[#27272A] rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-[#52525B] text-xs mb-2">{icon}{label}</div>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        {/* Flight list */}
        <div className="bg-[#18181B] border border-[#27272A] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#27272A] flex items-center justify-between">
            <h2 className="text-sm font-medium text-[#A1A1AA]">All movements</h2>
            <span className="text-xs text-[#52525B]">{data.total_movements} flights</span>
          </div>
          <div className="divide-y divide-[#27272A]">
            {flights.map((f, i) => {
              const dep = (f.dep_icao as string) || "—";
              const arr = (f.arr_icao as string) || "—";
              const isDepHere = dep === code;
              const otherIcao = isDepHere ? arr : dep;
              const otherCity = isDepHere
                ? (f.arr_city as string | null)
                : (f.dep_city as string | null);
              const role = f.crew_role as string;
              const isPIC = role === "pic";
              const block = secToHHMM((f.block_seconds as number) || 0);
              const nightSec = (f.night_seconds as number) || 0;
              const fn = f.flight_number as string | null;
              const acft = shortType(f.aircraft_type as string | null);
              const picName = formatPicName(f.pic_name as string | null);
              return (
                <div
                  key={i}
                  className="px-4 py-3 hover:bg-[#27272A]/40 transition-colors cursor-pointer"
                  onClick={() => router.push(`/aviation/${f.id}`)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-[#52525B] tabular-nums flex-shrink-0">{f.date as string}</span>
                      <div className="flex items-center gap-1.5 text-sm">
                        {isDepHere
                          ? <><PlaneTakeoff size={11} className="text-sky-500 flex-shrink-0" /><span className="font-mono text-[#FAFAFA]">{otherIcao}</span></>
                          : <><PlaneLanding size={11} className="text-emerald-500 flex-shrink-0" /><span className="font-mono text-[#FAFAFA]">{otherIcao}</span></>
                        }
                        {otherCity && <span className="hidden sm:block text-xs text-[#52525B] truncate">{otherCity}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {fn && <span className="text-xs text-[#52525B]">{fn}</span>}
                      {picName && <span className="text-xs text-[#52525B] font-mono hidden sm:block">{picName}</span>}
                      <span className="text-xs text-[#71717A]">{acft}</span>
                      {nightSec > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-indigo-400 tabular-nums">
                          <Moon size={9} />{secToHHMM(nightSec)}
                        </span>
                      )}
                      <span className="text-xs text-[#A1A1AA] tabular-nums">{block}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${isPIC ? "bg-violet-950/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
                        {isPIC ? "PIC" : "FO"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
