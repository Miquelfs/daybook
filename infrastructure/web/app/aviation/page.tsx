"use client";

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  PlaneTakeoff, PlaneLanding, Moon, Clock, Globe, Plus,
  Shield, TrendingUp, Award, ChevronRight, Download,
  Flag, Compass, Plane, Fuel, Users, Layers, AlertTriangle,
  List, BarChart2, MapPin, CalendarDays, X, User, Gauge,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api, type FlightSummary, type LimitWindow } from "@/lib/api";
import { AddFlightSheet } from "@/components/aviation/AddFlightSheet";

const FlightRouteMap = dynamic(
  () => import("@/components/aviation/FlightRouteMap").then(m => m.FlightRouteMap),
  { ssr: false, loading: () => <div className="h-96 bg-[#18181B] rounded-lg animate-pulse" /> }
);

type Tab = "overview" | "logbook" | "map" | "stats";
type CodeMode = "icao" | "iata";

const TODAY = new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 30;

const EASA_COLS = [
  "Date", "Dep", "Dep Time", "Arr", "Arr Time", "Model", "Reg",
  "SP SE", "SP ME", "MP", "Total", "PIC Name",
  "T/O D", "T/O N", "Ldg D", "Ldg N",
  "Night", "IFR", "PIC", "CoPilot", "Dual", "Instr",
  "FSTD Date", "FSTD Type", "FSTD Total", "Remarks",
];

const BASE_API = (typeof window === "undefined"
  ? process.env.API_INTERNAL_URL
  : undefined) ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Fill all years from first Aerolink entry (2018) through today
const ALL_YEARS = Array.from(
  { length: new Date().getFullYear() - 2018 + 1 },
  (_, i) => String(2018 + i)
);

// Operator colour logic based on source + operator field
function operatorColor(f: FlightSummary): { dot: string; badge: string; label: string } {
  if (f.is_sim) return { dot: "#A78BFA", badge: "bg-violet-900/40 text-violet-300", label: "SIM" };
  if (f.source === "aerolink") return { dot: "#A78BFA", badge: "bg-violet-900/40 text-violet-300", label: "Aerolink" };
  const op = (f.operator || "").toLowerCase();
  if (op.includes("norwegian") || f.source === "norwegian")
    return { dot: "#EF4444", badge: "bg-red-900/40 text-red-300", label: "Norwegian" };
  if (op.includes("ryanair") || f.source === "full_csv")
    return { dot: "#3B82F6", badge: "bg-blue-900/40 text-blue-300", label: "Ryanair" };
  return { dot: "#71717A", badge: "bg-[#27272A] text-[#71717A]", label: f.operator || "Manual" };
}

function hToHHMM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function secToHHMM(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${h}:00`;
}

function routeCode(icao: string | null, iata: string | null, mode: CodeMode): string {
  if (mode === "iata") return iata || icao || "?";
  return icao || iata || "?";
}

function fmt(n: number | null | undefined, unit = ""): string {
  if (n == null) return "—";
  return n.toLocaleString() + (unit ? " " + unit : "");
}

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-[#18181B] rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-[#71717A]">{label}</p>
        {icon && <span className="text-[#52525B]">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

function AnalyticCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-[#18181B] rounded-lg p-3">
      <p className="text-xs text-[#71717A] mb-1">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${accent || "text-[#FAFAFA]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

function LimitBar({ window: w }: { window: LimitWindow }) {
  const pct = Math.min(100, (w.hours / w.limit_hours) * 100);
  const barColor = pct >= 90 ? "#EF4444" : pct >= 75 ? "#F59E0B" : "#38BDF8";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-[#71717A]">{w.label}</span>
        <span className="text-xs tabular-nums">
          <span className="text-[#FAFAFA] font-medium">{w.hours.toFixed(0)}h</span>
          <span className="text-[#52525B]"> / {w.limit_hours.toFixed(0)}h</span>
        </span>
      </div>
      <div className="h-1.5 bg-[#27272A] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-[#52525B]">{icon}</span>}
      <p className="text-sm font-medium text-[#FAFAFA]">{children}</p>
    </div>
  );
}

const AIRCRAFT_ALIASES: Record<string, string> = {
  "Boeing 737 MAX 8-200": "Boeing 737 MAX 8",
  "Boeing 737-8AS": "Boeing 737-800",
};

function shortAircraftType(raw: string | null | undefined): string {
  if (!raw) return "";
  return AIRCRAFT_ALIASES[raw] ?? raw;
}

// Format a stored pic_name:
// - 6-letter crew code (e.g. "ALEOLU") → kept as-is
// - "Firstname Lastname" → "F.LASTNAME"
function formatPicName(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  // 6-letter all-alpha crew code (Ryanair format) — display as-is
  if (/^[A-Za-z]{6}$/.test(s)) return s.toUpperCase();
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].toUpperCase();
  const initial = parts[0][0].toUpperCase();
  const surname = parts.slice(1).join(" ").toUpperCase();
  return `${initial}.${surname}`;
}

// Operator legend pill
function OpPill({ label, color }: { label: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {label}
    </span>
  );
}

type LookupKind = "airport" | "aircraft" | "captain";
type LookupPanel = { kind: LookupKind; query: string } | null;

export default function AviationPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [regSearch, setRegSearch] = useState("");
  const regInputRef = useRef<HTMLInputElement>(null);
  const [airportSearch, setAirportSearch] = useState("");
  const [captainSearch, setCaptainSearch] = useState("");
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [easaPage, setEasaPage] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [codeMode, setCodeMode] = useState<CodeMode>("icao");
  const [flightLimit, setFlightLimit] = useState(10);
  const [mapYear, setMapYear] = useState<string>("");
  const [lookup, setLookup] = useState<LookupPanel>(null);

  const { data: stats } = useQuery({
    queryKey: ["flightStats"],
    queryFn: () => api.flightStats(),
  });

  const { data: analytics } = useQuery({
    queryKey: ["flightAnalytics"],
    queryFn: () => api.flightAnalytics(),
    enabled: tab === "stats",
  });

  const { data: currency } = useQuery({
    queryKey: ["flightCurrency"],
    queryFn: () => api.flightCurrency(),
  });

  const { data: limits } = useQuery({
    queryKey: ["flightLimits"],
    queryFn: () => api.flightLimits(),
  });

  const { data: routes = [] } = useQuery({
    queryKey: ["flightRoutes", mapYear],
    queryFn: () => api.flightRoutes(mapYear || undefined),
    enabled: tab === "map",
  });

  const { data: airportVisits = [] } = useQuery({
    queryKey: ["flightAirports", mapYear],
    queryFn: () => api.flightAirports(mapYear || undefined),
    enabled: tab === "map",
  });

  const { data: allFlights = [] } = useQuery({
    queryKey: ["flights", "all"],
    queryFn: () => api.flights({}),
  });

  const { data: airportData, isLoading: airportLoading } = useQuery({
    queryKey: ["airportFlights", lookup?.query],
    queryFn: () => api.airportFlights(lookup!.query),
    enabled: lookup?.kind === "airport" && !!lookup.query,
  });

  const { data: aircraftData, isLoading: aircraftLoading } = useQuery({
    queryKey: ["aircraftHistory", lookup?.query],
    queryFn: () => api.aircraftHistory(lookup!.query),
    enabled: lookup?.kind === "aircraft" && !!lookup.query,
  });

  const { data: captainData, isLoading: captainLoading } = useQuery({
    queryKey: ["captainHistory", lookup?.query],
    queryFn: () => api.captainHistory(lookup!.query),
    enabled: lookup?.kind === "captain" && !!lookup.query,
  });

  const tot = stats?.totals;

  // Fill missing years with 0 for chart
  const yearMap = new globalThis.Map((stats?.by_year ?? []).map(y => [y.year, y]));
  const yearsWithGaps = ALL_YEARS.map(yr => yearMap.get(yr) ?? {
    year: yr, sectors: 0, block_hours: 0, pic_hours: 0, sic_hours: 0, night_hours: 0, takeoffs: 0, landings: 0,
  });

  const monthData = selectedYear
    ? stats?.by_month.filter(m => m.month.startsWith(selectedYear)) ?? []
    : [];

  const isExpiringSoon = currency?.next_expiry_date
    ? new Date(currency.next_expiry_date) <= new Date(Date.now() + 30 * 86400000)
    : false;

  const filteredFlights = allFlights.filter(f => {
    if (roleFilter && f.crew_role !== roleFilter) return false;
    if (yearFilter && !f.date.startsWith(yearFilter)) return false;
    return true;
  }).slice().reverse(); // newest first

  const shownFlights = filteredFlights.slice(0, flightLimit);
  const hasMore = filteredFlights.length > flightLimit;

  const easaPageSize = 50;
  const easaTotalPages = Math.ceil(allFlights.length / easaPageSize);
  const easaSlice = allFlights.slice(easaPage * easaPageSize, (easaPage + 1) * easaPageSize);

  const tabCls = (t: Tab) =>
    `flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${tab === t
      ? "bg-[#27272A] text-[#FAFAFA]"
      : "text-[#52525B] hover:text-[#A1A1AA]"}`;

  const uniqueYears = Array.from(new Set(allFlights.map(f => f.date.slice(0, 4)))).sort().reverse();

  const CodeToggle = () => (
    <div className="flex items-center bg-[#18181B] border border-[#27272A] rounded-lg p-0.5">
      <button className={`px-2 py-0.5 text-xs rounded-md transition-colors ${codeMode === "icao" ? "bg-sky-600 text-white" : "text-[#71717A]"}`}
        onClick={() => setCodeMode("icao")}>ICAO</button>
      <button className={`px-2 py-0.5 text-xs rounded-md transition-colors ${codeMode === "iata" ? "bg-sky-600 text-white" : "text-[#71717A]"}`}
        onClick={() => setCodeMode("iata")}>IATA</button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 pt-8 pb-24">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Today</Link>
            <h1 className="text-2xl font-semibold tracking-tight">Logbook</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Flights, routes & EASA hours</p>
          </div>
          <button onClick={() => setAddOpen(true)}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs rounded-lg transition-colors">
            <Plus size={13} />Add Flight
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mb-6 overflow-x-auto">
        <button className={tabCls("overview")} onClick={() => setTab("overview")}><List size={13} />Overview</button>
        <button className={tabCls("logbook")} onClick={() => setTab("logbook")}><BarChart2 size={13} />EASA</button>
        <button className={tabCls("map")} onClick={() => setTab("map")}><MapPin size={13} />Routes</button>
        <button className={tabCls("stats")} onClick={() => setTab("stats")}><TrendingUp size={13} />Analytics</button>
        <Link href="/aviation/roster" className={tabCls("roster" as Tab)}><CalendarDays size={13} />Roster</Link>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <>
          {tot && (
            <div className="grid grid-cols-2 gap-3 mb-3 sm:grid-cols-4">
              <StatCard label="Total Block" value={hToHHMM(tot.block_hours)} sub={`${tot.sectors} sectors`} icon={<Clock size={14} />} />
              <StatCard label="PIC" value={hToHHMM(tot.pic_hours)} sub={`SIC ${hToHHMM(tot.sic_hours)}`} icon={<Award size={14} />} />
              <StatCard label="Night" value={hToHHMM(tot.night_hours)} sub={`${((tot.night_hours / (tot.block_hours || 1)) * 100).toFixed(0)}% of total`} icon={<Moon size={14} />} />
              <StatCard label="Airports" value={stats.airports_visited} sub={`${stats.countries_visited} countries`} icon={<Globe size={14} />} />
            </div>
          )}

          {tot && tot.sim_sessions > 0 && (
            <div className="flex items-center gap-3 bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 mb-6">
              <Layers size={16} className="text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#71717A]">FSTD / Simulator</p>
                <p className="text-base font-semibold text-violet-300 tabular-nums">{hToHHMM(tot.sim_hours)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-[#52525B]">{tot.sim_sessions} session{tot.sim_sessions !== 1 ? "s" : ""}</p>
                <p className="text-xs text-[#3F3F46]">not counted in block</p>
              </div>
            </div>
          )}

          {tot && (
            <div className="grid grid-cols-4 gap-2 mb-6">
              {[
                { label: "T/O Day", value: tot.takeoffs_day, icon: <PlaneTakeoff size={12} /> },
                { label: "T/O Night", value: tot.takeoffs_night, icon: <PlaneTakeoff size={12} /> },
                { label: "Ldg Day", value: tot.landings_day, icon: <PlaneLanding size={12} /> },
                { label: "Ldg Night", value: tot.landings_night, icon: <PlaneLanding size={12} /> },
              ].map(({ label, value, icon }) => (
                <div key={label} className="bg-[#18181B] rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-[#52525B] mb-1">{icon}</div>
                  <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
                  <p className="text-xs text-[#71717A]">{label}</p>
                </div>
              ))}
            </div>
          )}

          {currency && (
            <div className={`rounded-lg p-4 mb-6 border ${isExpiringSoon ? "bg-amber-950/30 border-amber-700" : "bg-[#18181B] border-[#27272A]"}`}>
              <div className="flex items-center gap-2 mb-2">
                <Shield size={14} className={isExpiringSoon ? "text-amber-400" : "text-sky-400"} />
                <p className="text-sm font-medium text-[#FAFAFA]">90-Day Currency</p>
                {currency.next_expiry_date && (
                  <span className={`ml-auto text-xs ${isExpiringSoon ? "text-amber-400" : "text-[#52525B]"}`}>
                    Expires {format(parseISO(currency.next_expiry_date), "dd MMM yyyy")}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{currency.takeoffs_landings_90d}</p>
                  <p className="text-xs text-[#71717A]">T/O + Ldg</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{currency.night_takeoffs_90d + currency.night_landings_90d}</p>
                  <p className="text-xs text-[#71717A]">Night ops</p>
                </div>
                <div>
                  <p className={`text-xl font-semibold tabular-nums ${currency.takeoffs_landings_90d >= 3 ? "text-green-400" : "text-red-400"}`}>
                    {currency.takeoffs_landings_90d >= 3 ? "Current" : "NOT current"}
                  </p>
                  <p className="text-xs text-[#71717A]">Status</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#27272A]">
                <Moon size={12} className={currency.night_current ? "text-indigo-400" : "text-[#52525B]"} />
                {currency.night_current ? (
                  <p className="text-xs text-[#A1A1AA]">
                    Night pax currency <span className="text-green-400 font-medium">current</span>
                    {currency.night_expiry_date && (
                      <span className="text-[#52525B]"> · expires {format(parseISO(currency.night_expiry_date), "dd MMM yyyy")}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-[#71717A]">
                    Night pax currency <span className="text-amber-400 font-medium">not held</span>
                    <span className="text-[#52525B]"> · needs 1 night T/O + 1 night ldg in 90 days</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Flight time limitations (EASA ORO.FTL.210) */}
          {limits && (
            <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Gauge size={14} className="text-sky-400" />
                <p className="text-sm font-medium text-[#FAFAFA]">Flight Time Limits</p>
                <span className="ml-auto text-xs text-[#52525B]">EASA ORO.FTL.210</span>
              </div>
              <div className="space-y-3">
                {[limits.days_28, limits.calendar_year, limits.months_12].map(w => (
                  <LimitBar key={w.label} window={w} />
                ))}
              </div>
            </div>
          )}

          {/* Annual chart */}
          {yearsWithGaps.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-[#FAFAFA]">Hours by Year</p>
                <TrendingUp size={14} className="text-[#52525B]" />
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={yearsWithGaps} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: "#71717A", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#71717A", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 8 }}
                    labelStyle={{ color: "#FAFAFA" }}
                    formatter={(v, name) => [hToHHMM(Number(v ?? 0)), name === "block_hours" ? "Block" : name === "pic_hours" ? "PIC" : "SIC"]}
                  />
                  <Bar dataKey="block_hours" fill="#38BDF8" radius={[3, 3, 0, 0]} name="block_hours">
                    {yearsWithGaps.map((y) => (
                      <Cell key={y.year} fill={selectedYear === y.year ? "#0EA5E9" : "#38BDF8"}
                        className="cursor-pointer"
                        onClick={() => setSelectedYear(selectedYear === y.year ? null : y.year)}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="pic_hours" fill="#A78BFA" radius={[3, 3, 0, 0]} name="pic_hours" />
                </BarChart>
              </ResponsiveContainer>
              {selectedYear && <p className="text-xs text-sky-400 mt-1 text-center">Showing {selectedYear} · click bar to deselect</p>}
            </div>
          )}

          {selectedYear && monthData.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-[#FAFAFA] mb-3">Monthly — {selectedYear}</p>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={monthData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="month" tickFormatter={m => m.slice(5)} tick={{ fill: "#71717A", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#71717A", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 8 }} formatter={(v) => [hToHHMM(Number(v ?? 0)), "Block"]} />
                  <Bar dataKey="block_hours" fill="#38BDF8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Flights list */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <p className="text-sm font-medium text-[#FAFAFA] mr-auto">Flights</p>
              <CodeToggle />
              {/* Aircraft registration lookup */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const q = regSearch.trim().toUpperCase();
                  if (q) setLookup({ kind: "aircraft", query: q });
                }}
                className="flex items-center gap-1"
                title="Look up an aircraft by registration"
              >
                <input
                  ref={regInputRef}
                  className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA] placeholder-[#52525B] focus:outline-none focus:border-violet-500 w-24 font-mono uppercase"
                  placeholder="9H-QAE…"
                  value={regSearch}
                  onChange={e => setRegSearch(e.target.value.toUpperCase())}
                />
                <button type="submit" className="px-2 py-1 bg-[#27272A] hover:bg-[#3F3F46] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                  <Plane size={11} />
                </button>
              </form>
              {/* Airport ICAO lookup */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const q = airportSearch.trim().toUpperCase();
                  if (q) setLookup({ kind: "airport", query: q });
                }}
                className="flex items-center gap-1"
                title="Look up an airport by ICAO"
              >
                <input
                  className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA] placeholder-[#52525B] focus:outline-none focus:border-sky-500 w-20 font-mono uppercase"
                  placeholder="LEPA…"
                  value={airportSearch}
                  onChange={e => setAirportSearch(e.target.value.toUpperCase())}
                />
                <button type="submit" className="px-2 py-1 bg-[#27272A] hover:bg-[#3F3F46] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                  <MapPin size={11} />
                </button>
              </form>
              {/* Captain lookup */}
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const q = captainSearch.trim();
                  if (q) setLookup({ kind: "captain", query: q });
                }}
                className="flex items-center gap-1"
                title="Look up a captain"
              >
                <input
                  className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA] placeholder-[#52525B] focus:outline-none focus:border-amber-500 w-24 font-mono"
                  placeholder="ALEOLU…"
                  value={captainSearch}
                  onChange={e => setCaptainSearch(e.target.value)}
                />
                <button type="submit" className="px-2 py-1 bg-[#27272A] hover:bg-[#3F3F46] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                  <User size={11} />
                </button>
              </form>
              <select className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA]"
                value={yearFilter} onChange={e => { setYearFilter(e.target.value); setFlightLimit(10); }}>
                <option value="">All years</option>
                {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA]"
                value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setFlightLimit(10); }}>
                <option value="">All roles</option>
                <option value="pic">PIC</option>
                <option value="first_officer">SIC</option>
              </select>
            </div>

            {/* Operator legend */}
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <OpPill label="Ryanair" color="#3B82F6" />
              <OpPill label="Norwegian" color="#EF4444" />
              <OpPill label="Aerolink / Training" color="#A78BFA" />
              <OpPill label="Manual" color="#71717A" />
            </div>

            <div className="space-y-1">
              {shownFlights.map((f: FlightSummary) => (
                <FlightRow key={f.id} flight={f} codeMode={codeMode} />
              ))}
              {filteredFlights.length === 0 && (
                <p className="text-sm text-[#52525B] text-center py-4">No flights match the filter.</p>
              )}
            </div>

            {hasMore && (
              <button className="mt-3 w-full py-2 text-xs text-[#71717A] hover:text-[#A1A1AA] border border-[#27272A] rounded-lg transition-colors"
                onClick={() => setFlightLimit(l => l + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, filteredFlights.length - flightLimit)} more of {filteredFlights.length} flights
              </button>
            )}
            {!hasMore && filteredFlights.length > 10 && (
              <p className="mt-2 text-center text-xs text-[#52525B]">All {filteredFlights.length} flights shown</p>
            )}
          </div>
        </>
      )}

      {/* ── EASA LOGBOOK ── */}
      {tab === "logbook" && (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <p className="text-sm text-[#71717A]">{allFlights.length} entries · page {easaPage + 1}/{easaTotalPages}</p>
            <div className="ml-auto flex gap-2 flex-wrap">
              <a href={`${BASE_API}/flights/export/easa`} download="logbook_easa.csv"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                <Download size={12} />EASA CSV
              </a>
              <a href={`${BASE_API}/flights/export/excel`} download="logbook.xlsx"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                <Download size={12} />Excel
              </a>
              <a href={`${BASE_API}/flights/export/pdf`} download="logbook_dark.pdf"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded-lg text-xs text-[#A1A1AA] transition-colors">
                <Download size={12} />PDF
              </a>
              <a href={`${BASE_API}/flights/export/pdf?theme=light`} download="logbook.pdf"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-xs text-gray-700 transition-colors">
                <Download size={12} />PDF Light
              </a>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[#27272A]">
            <table className="text-xs min-w-max">
              <thead className="bg-[#18181B] sticky top-0">
                <tr>{EASA_COLS.map(col => (
                  <th key={col} className="px-2 py-2 text-left text-[#71717A] font-medium whitespace-nowrap border-b border-[#27272A]">{col}</th>
                ))}</tr>
              </thead>
              <tbody>
                {easaSlice.map((f, i) => {
                  const isPIC = f.crew_role === "pic";
                  const isSim = f.is_sim;
                  const rowCls = isSim ? "bg-amber-950/20" : isPIC ? "bg-violet-950/20" : i % 2 === 0 ? "bg-transparent" : "bg-[#18181B]/40";
                  const depTime = f.off_block_utc ? (f.off_block_utc.length > 5 ? f.off_block_utc.slice(11, 16) : f.off_block_utc) : "";
                  const arrTime = f.on_block_utc ? (f.on_block_utc.length > 5 ? f.on_block_utc.slice(11, 16) : f.on_block_utc) : "";
                  const picTime = isSim ? "" : secToHHMM(f.pic_seconds);
                  const sicTime = isSim ? "" : secToHHMM(f.sic_seconds);
                  const mpTime = isSim ? "" : secToHHMM(f.block_seconds);
                  const nightTime = isSim ? "" : secToHHMM(f.night_seconds);
                  // PIC Name column: always the captain/commander of the flight.
                  // School solo flights (pic_name empty, is_pic) → "M. FARRÉ" (SELF).
                  // All airline flights → captain crew code / name from pic_name field.
                  const picName = isSim
                    ? ""
                    : f.pic_name
                    ? formatPicName(f.pic_name)
                    : isPIC
                    ? "M. FARRÉ"
                    : "";
                  return (
                    <tr key={f.id} className={`${rowCls} hover:bg-[#27272A]/40 transition-colors`}>
                      <td className="px-2 py-1.5 text-[#A1A1AA] whitespace-nowrap">{f.date}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {f.dep_icao ? <button onClick={() => setLookup({ kind: "airport", query: f.dep_icao! })} className="text-[#FAFAFA] hover:text-sky-400 transition-colors">{f.dep_icao}</button> : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#71717A] tabular-nums">{depTime}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {f.arr_icao ? <button onClick={() => setLookup({ kind: "airport", query: f.arr_icao! })} className="text-[#FAFAFA] hover:text-sky-400 transition-colors">{f.arr_icao}</button> : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#71717A] tabular-nums">{arrTime}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA]">{shortAircraftType(f.aircraft_type)}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {f.aircraft_reg ? <button onClick={() => setLookup({ kind: "aircraft", query: f.aircraft_reg! })} className="text-[#71717A] hover:text-violet-400 transition-colors">{f.aircraft_reg}</button> : ""}
                      </td>
                      <td className="px-2 py-1.5 text-[#52525B]"></td>
                      <td className="px-2 py-1.5 text-[#52525B]"></td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{mpTime}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{mpTime}</td>
                      <td className={`px-2 py-1.5 font-mono text-xs`}>
                        {picName && f.pic_name
                          ? <button onClick={() => setLookup({ kind: "captain", query: f.pic_name! })} className={`hover:underline ${isPIC ? "text-violet-300" : "text-[#A1A1AA]"}`}>{picName}</button>
                          : <span className={isPIC ? "text-violet-300" : "text-[#A1A1AA]"}>{picName}</span>
                        }
                      </td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{isSim ? "" : (f.takeoffs_day || "")}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{isSim ? "" : (f.takeoffs_night || "")}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{isSim ? "" : (f.landings_day || "")}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{isSim ? "" : (f.landings_night || "")}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{nightTime}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{mpTime}</td>
                      <td className="px-2 py-1.5 text-violet-300 tabular-nums">{picTime}</td>
                      <td className="px-2 py-1.5 text-[#A1A1AA] tabular-nums">{sicTime}</td>
                      <td className="px-2 py-1.5 text-[#52525B]"></td>
                      <td className="px-2 py-1.5 text-[#52525B]"></td>
                      <td className="px-2 py-1.5 text-amber-400">{isSim ? f.date : ""}</td>
                      <td className="px-2 py-1.5 text-amber-300">{isSim ? (f.aircraft_type || "") : ""}</td>
                      <td className="px-2 py-1.5 text-amber-400 tabular-nums">{isSim ? secToHHMM(f.block_seconds) : ""}</td>
                      <td className="px-2 py-1.5 text-[#71717A] max-w-xs truncate"></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {easaTotalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button onClick={() => setEasaPage(p => Math.max(0, p - 1))} disabled={easaPage === 0}
                className="px-3 py-1.5 text-xs bg-[#18181B] border border-[#27272A] rounded-lg text-[#A1A1AA] disabled:opacity-40">Previous</button>
              <span className="text-xs text-[#52525B]">{easaPage + 1} / {easaTotalPages}</span>
              <button onClick={() => setEasaPage(p => Math.min(easaTotalPages - 1, p + 1))} disabled={easaPage === easaTotalPages - 1}
                className="px-3 py-1.5 text-xs bg-[#18181B] border border-[#27272A] rounded-lg text-[#A1A1AA] disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      )}

      {/* ── ROUTES MAP ── */}
      {tab === "map" && (
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <CodeToggle />
            <select className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA]"
              value={mapYear} onChange={e => setMapYear(e.target.value)}>
              <option value="">All years</option>
              {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {routes.length > 0
            ? <FlightRouteMap routes={routes} airports={airportVisits} height="440px" basesIcao={["LIME", "GCTS", "LELL", "LEPA"]} codeMode={codeMode} />
            : <div className="h-40 flex items-center justify-center text-[#52525B] text-sm">No route data for selected year.</div>
          }
          {routes.slice(0, 10).length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4 mt-4">
              <p className="text-sm font-medium text-[#FAFAFA] mb-3">Top Routes</p>
              <div className="space-y-2">
                {routes.slice(0, 10).map(r => (
                  <div key={`${r.dep_icao}-${r.arr_icao}`} className="flex items-center justify-between text-sm">
                    <span className="text-[#FAFAFA] font-mono text-xs">
                      {routeCode(r.dep_icao, r.dep_iata, codeMode)} → {routeCode(r.arr_icao, r.arr_iata, codeMode)}
                    </span>
                    <span className="text-[#71717A] tabular-nums text-xs">{r.count}× · {hToHHMM(r.total_block_hours)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ANALYTICS ── */}
      {tab === "stats" && analytics && (
        <div className="space-y-5">

          {/* Records grid */}
          <div>
            <SectionTitle icon={<Award size={14} />}>Records</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              {analytics.longest_flight && (
                <AnalyticCard label="Longest Flight" accent="text-sky-400"
                  value={hToHHMM((analytics.longest_flight.block_seconds || 0) / 3600)}
                  sub={`${analytics.longest_flight.dep_icao} → ${analytics.longest_flight.arr_icao} · ${analytics.longest_flight.date}`} />
              )}
              {analytics.shortest_flight && (
                <AnalyticCard label="Shortest Flight"
                  value={hToHHMM((analytics.shortest_flight.block_seconds || 0) / 3600)}
                  sub={`${analytics.shortest_flight.dep_icao} → ${analytics.shortest_flight.arr_icao} · ${analytics.shortest_flight.date}`} />
              )}
              {analytics.top_route && (
                <AnalyticCard label="Most Flown Route" accent="text-sky-400"
                  value={`${analytics.top_route.dep_icao} → ${analytics.top_route.arr_icao}`}
                  sub={`${analytics.top_route.cnt} sectors · ${hToHHMM(analytics.top_route.total_hours)}`} />
              )}
              {analytics.busiest_month && (
                <AnalyticCard label="Busiest Month"
                  value={analytics.busiest_month.month}
                  sub={`${analytics.busiest_month.sectors} sectors · ${hToHHMM(analytics.busiest_month.block_hours)}`} />
              )}
              {analytics.top_airport && (
                <AnalyticCard label="Most Visited Airport" accent="text-amber-400"
                  value={analytics.top_airport.iata || analytics.top_airport.icao}
                  sub={`${analytics.top_airport.city || ""} · ${analytics.top_airport.visits} visits`} />
              )}
            </div>
          </div>

          {/* Night flying */}
          {analytics.night_stats && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Moon size={14} />}>Night Flying</SectionTitle>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <AnalyticCard label="Night hours" value={hToHHMM(analytics.night_stats.night_hours)} accent="text-indigo-400"
                  sub={`${analytics.night_stats.night_pct}% of block`} />
                <AnalyticCard label="Night sectors" value={fmt(analytics.night_stats.night_sectors)}
                  sub={`${analytics.night_stats.full_night_sectors} fully at night`} />
                <AnalyticCard label="Night T/O · Ldg" value={`${analytics.night_stats.night_takeoffs} · ${analytics.night_stats.night_landings}`} />
              </div>
              {/* Day vs night split bar */}
              <div className="h-2 rounded-full overflow-hidden flex mb-1.5">
                <div className="bg-sky-500" style={{ width: `${100 - analytics.night_stats.night_pct}%` }} />
                <div className="bg-indigo-600" style={{ width: `${analytics.night_stats.night_pct}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-[#52525B] mb-3">
                <span>Day {(100 - analytics.night_stats.night_pct).toFixed(1)}%</span>
                <span>Night {analytics.night_stats.night_pct}%</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {analytics.night_stats.darkest_month && (
                  <AnalyticCard label="Most night in a month" value={analytics.night_stats.darkest_month.month}
                    sub={`${hToHHMM(analytics.night_stats.darkest_month.night_hours)} · ${analytics.night_stats.darkest_month.night_sectors} sectors`} />
                )}
                {analytics.night_stats.most_night_flight && (
                  <AnalyticCard label="Most night in a flight" accent="text-indigo-400"
                    value={hToHHMM(analytics.night_stats.most_night_flight.night_seconds / 3600)}
                    sub={`${analytics.night_stats.most_night_flight.dep_icao} → ${analytics.night_stats.most_night_flight.arr_icao} · ${analytics.night_stats.most_night_flight.date}`} />
                )}
              </div>
            </div>
          )}

          {/* Countries — map-style grid */}
          {analytics.countries.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Flag size={14} className="text-[#52525B]" />
                <p className="text-sm font-medium text-[#FAFAFA]">Countries</p>
                <span className="ml-auto text-xs bg-sky-900/40 text-sky-400 px-2 py-0.5 rounded-full font-medium">{analytics.countries.length}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {analytics.countries.map(c => (
                  <div key={c} className="flex items-center gap-1.5 bg-[#09090B] rounded-lg px-2 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500 flex-shrink-0" />
                    <span className="text-xs text-[#A1A1AA] truncate">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top destinations */}
          {analytics.top_destinations.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Compass size={14} />}>Top Destinations</SectionTitle>
              {analytics.top_destinations.map((d, i) => (
                <button key={d.arr_icao} onClick={() => setLookup({ kind: "airport", query: d.arr_icao })} className="w-full flex items-center gap-3 py-1.5 border-b border-[#27272A] last:border-0 hover:bg-[#27272A]/30 -mx-2 px-2 rounded transition-colors">
                  <span className="text-xs text-[#52525B] w-4">{i + 1}</span>
                  <span className="font-mono text-[#FAFAFA] text-sm hover:text-sky-400 transition-colors">{d.arr_iata || d.arr_icao}</span>
                  {d.city && <span className="text-[#71717A] text-xs">{d.city}, {d.country || ""}</span>}
                  <span className="ml-auto text-[#52525B] text-xs tabular-nums">{d.visits}×</span>
                </button>
              ))}
            </div>
          )}

          {/* Passengers */}
          {analytics.pax_stats && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Users size={14} />}>Passengers</SectionTitle>
              <div className="grid grid-cols-3 gap-3">
                <AnalyticCard label="Total carried" value={fmt(analytics.pax_stats.total_pax)} accent="text-sky-400" />
                <AnalyticCard label="Avg per flight" value={fmt(analytics.pax_stats.avg_pax)} />
                <AnalyticCard label="Busiest flight" value={fmt(analytics.pax_stats.max_pax) + " pax"} />
              </div>
              <p className="text-xs text-[#52525B] mt-2">Based on {analytics.pax_stats.flights_with_pax} flights with pax data</p>
            </div>
          )}

          {/* Fuel */}
          {analytics.fuel_stats && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Fuel size={14} />}>Fuel</SectionTitle>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <AnalyticCard label="Total burned" value={fmt(analytics.fuel_stats.total_burn_kg, "kg")} accent="text-orange-400" />
                <AnalyticCard label="Avg burn / flight" value={fmt(analytics.fuel_stats.avg_burn_kg, "kg")} />
                <AnalyticCard label="Avg uplift" value={fmt(analytics.fuel_stats.avg_uplift_kg, "kg")} />
              </div>
              {analytics.burn_by_type.length > 0 && (
                <>
                  <p className="text-xs text-[#52525B] mb-2">Burn efficiency by aircraft</p>
                  {analytics.burn_by_type.map(b => (
                    <div key={b.aircraft_type} className="flex items-center justify-between py-1 border-b border-[#27272A] last:border-0 text-xs">
                      <span className="text-[#A1A1AA]">{b.aircraft_type}</span>
                      <span className="text-[#71717A]">{fmt(b.avg_burn_kg)} kg avg</span>
                      {b.kg_per_nm && <span className="text-[#52525B]">{b.kg_per_nm} kg/NM</span>}
                    </div>
                  ))}
                </>
              )}
              <p className="text-xs text-[#52525B] mt-2">Based on {analytics.fuel_stats.flights_with_fuel} flights with fuel data</p>
            </div>
          )}

          {/* Delays */}
          {analytics.delay_stats && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<AlertTriangle size={14} />}>Delays</SectionTitle>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <AnalyticCard label="Delayed flights" value={fmt(analytics.delay_stats.delayed_flights)} accent="text-amber-400" />
                <AnalyticCard label="Avg delay" value={`${fmt(analytics.delay_stats.avg_delay_min)} min`} />
                <AnalyticCard label="Max delay" value={`${fmt(analytics.delay_stats.max_delay_min)} min`} />
              </div>
              <p className="text-xs text-[#52525B] mb-2">
                Total delay time: {hToHHMM((analytics.delay_stats.total_delay_min || 0) / 60)}
              </p>
              {analytics.delay_by_code.length > 0 && (
                <>
                  <p className="text-xs text-[#52525B] mb-2">Top delay codes</p>
                  {analytics.delay_by_code.map((d: { delay_code: string; cnt: number; avg_min: number }) => (
                    <div key={d.delay_code} className="flex items-center justify-between py-1 border-b border-[#27272A] last:border-0 text-xs">
                      <span className="text-[#FAFAFA] font-mono w-8">{d.delay_code}</span>
                      <span className="text-[#71717A]">{d.cnt} flights</span>
                      <span className="text-[#52525B]">{d.avg_min} min avg</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Aircraft types */}
          {analytics.aircraft_breakdown.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Plane size={14} />}>Aircraft Types</SectionTitle>
              {analytics.aircraft_breakdown.map(a => (
                <div key={a.aircraft_type} className="flex items-center justify-between py-1.5 border-b border-[#27272A] last:border-0">
                  <span className="text-[#A1A1AA] text-sm">{a.aircraft_type}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-[#52525B] text-xs tabular-nums">{a.sectors} sectors</span>
                    <span className="text-[#71717A] text-xs tabular-nums w-16 text-right">{hToHHMM(a.block_hours)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Top registrations */}
          {analytics.top_registrations.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle icon={<Layers size={14} />}>Most Flown Airframes</SectionTitle>
              {analytics.top_registrations.map((r, i) => (
                <button key={r.aircraft_reg} onClick={() => setLookup({ kind: "aircraft", query: r.aircraft_reg })} className="w-full flex items-center gap-3 py-1.5 border-b border-[#27272A] last:border-0 hover:bg-[#27272A]/30 -mx-2 px-2 rounded transition-colors">
                  <span className="text-xs text-[#52525B] w-4">{i + 1}</span>
                  <span className="font-mono text-[#FAFAFA] text-sm">{r.aircraft_reg}</span>
                  {r.aircraft_type && <span className="text-[#52525B] text-xs">{r.aircraft_type}</span>}
                  <span className="ml-auto text-[#71717A] text-xs tabular-nums">{r.sectors} sectors · {hToHHMM(r.block_hours)}</span>
                </button>
              ))}
            </div>
          )}

          {/* Operators */}
          {analytics.operators.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle>By Operator / Source</SectionTitle>
              {analytics.operators.map(o => (
                <div key={o.op_label} className="flex items-center justify-between py-1.5 border-b border-[#27272A] last:border-0">
                  <span className="text-[#A1A1AA] text-sm">{o.op_label || "Unknown"}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-[#52525B] text-xs">{o.sectors} sectors</span>
                    <span className="text-[#71717A] text-xs tabular-nums">{hToHHMM(o.block_hours)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Year-over-year chart + table — uses stats.by_year (no sims, all years filled) */}
          {yearsWithGaps.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle>Year-over-Year</SectionTitle>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={yearsWithGaps} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="year" tick={{ fill: "#71717A", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#71717A", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 8 }}
                    formatter={(v, name) => [hToHHMM(Number(v ?? 0)), name === "block_hours" ? "Block" : name === "pic_hours" ? "PIC" : "Night"]}
                  />
                  <Bar dataKey="block_hours" fill="#38BDF8" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pic_hours" fill="#A78BFA" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="night_hours" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 mb-3 text-xs text-[#52525B] justify-center">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-400 inline-block" />Block</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-400 inline-block" />PIC</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-700 inline-block" />Night</span>
              </div>
              {yearsWithGaps.filter(y => y.sectors > 0).map(y => (
                <div key={y.year} className="flex items-center justify-between text-xs py-1.5 border-b border-[#27272A] last:border-0">
                  <span className="text-[#A1A1AA] font-medium w-12">{y.year}</span>
                  <span className="text-[#52525B]">{y.sectors} sectors</span>
                  <span className="text-sky-400 tabular-nums">{hToHHMM(y.block_hours)}</span>
                  <span className="text-violet-400 tabular-nums">{hToHHMM(y.pic_hours)}</span>
                  <span className="text-blue-400 tabular-nums">{hToHHMM(y.night_hours)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Avg sector duration */}
          {analytics.avg_sector_by_year.length > 0 && (
            <div className="bg-[#18181B] rounded-lg p-4">
              <SectionTitle>Avg Sector Duration by Year</SectionTitle>
              {analytics.avg_sector_by_year.map(y => (
                <div key={y.year} className="flex items-center justify-between text-xs py-1.5 border-b border-[#27272A] last:border-0">
                  <span className="text-[#A1A1AA]">{y.year}</span>
                  <span className="text-[#FAFAFA] tabular-nums">{hToHHMM(y.avg_block_hours)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === "stats" && !analytics && (
        <div className="flex items-center justify-center h-32 text-[#52525B] text-sm">Loading analytics…</div>
      )}

      <AddFlightSheet date={TODAY} isOpen={addOpen} onClose={() => setAddOpen(false)} />

      {/* Inline lookup panel — slide in from bottom */}
      {lookup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setLookup(null)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#27272A] flex-shrink-0">
              {lookup.kind === "airport" && <MapPin size={15} className="text-sky-400" />}
              {lookup.kind === "aircraft" && <Plane size={15} className="text-violet-400" />}
              {lookup.kind === "captain" && <User size={15} className="text-amber-400" />}
              <span className="font-mono text-sm text-[#FAFAFA] font-medium">{lookup.query}</span>
              <button onClick={() => setLookup(null)} className="ml-auto text-[#52525B] hover:text-[#A1A1AA] transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Panel body */}
            <div className="overflow-y-auto flex-1 p-4">
              {/* Airport panel */}
              {lookup.kind === "airport" && (
                airportLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-sky-500" />
                  </div>
                ) : !airportData ? (
                  <p className="text-[#71717A] text-sm text-center py-10">No flights found for <span className="font-mono text-[#FAFAFA]">{lookup.query}</span>.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-base font-semibold text-[#FAFAFA]">{airportData.name}</p>
                      <p className="text-xs text-[#71717A]">{[airportData.city, airportData.country].filter(Boolean).join(", ")}</p>
                      {airportData.iata && <p className="text-xs text-[#52525B] font-mono">{airportData.icao} / {airportData.iata}</p>}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Movements", value: String(airportData.total_movements) },
                        { label: "Departures", value: String(airportData.departures) },
                        { label: "Arrivals", value: String(airportData.arrivals) },
                        { label: "Night ops", value: String(airportData.night_movements) },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[#18181B] border border-[#27272A] rounded-xl p-3 text-center">
                          <p className="text-lg font-semibold tabular-nums">{value}</p>
                          <p className="text-xs text-[#52525B] mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {(airportData.flights as Record<string, unknown>[]).map((f, i) => {
                        const dep = (f.dep_icao as string) || "—";
                        const arr = (f.arr_icao as string) || "—";
                        const isDepHere = dep === lookup.query;
                        const other = isDepHere ? arr : dep;
                        const block = secToHHMM((f.block_seconds as number) || 0);
                        const isPIC = (f.crew_role as string) === "pic";
                        const acft = shortAircraftType(f.aircraft_type as string);
                        return (
                          <Link key={i} href={`/aviation/${f.id}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#18181B] transition-colors text-xs"
                            onClick={() => setLookup(null)}
                          >
                            <span className="text-[#52525B] w-20 shrink-0 tabular-nums">{f.date as string}</span>
                            <span className="flex items-center gap-1 text-[#FAFAFA] font-mono">
                              {isDepHere
                                ? <><PlaneTakeoff size={10} className="text-sky-500" />{other}</>
                                : <><PlaneLanding size={10} className="text-emerald-500" />{other}</>}
                            </span>
                            <span className="text-[#52525B] ml-auto">{acft}</span>
                            <span className="text-[#A1A1AA] tabular-nums">{block}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isPIC ? "bg-violet-950/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
                              {isPIC ? "PIC" : "FO"}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Aircraft panel */}
              {lookup.kind === "aircraft" && (
                aircraftLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-violet-500" />
                  </div>
                ) : !aircraftData ? (
                  <p className="text-[#71717A] text-sm text-center py-10">No flights found for <span className="font-mono text-[#FAFAFA]">{lookup.query}</span>.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-base font-semibold text-[#FAFAFA] font-mono">{aircraftData.registration}</p>
                      <p className="text-xs text-[#71717A]">{shortAircraftType(aircraftData.aircraft_type)}</p>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Flights", value: String(aircraftData.total_flights) },
                        { label: "Block time", value: secToHHMM(aircraftData.total_block_seconds) },
                        { label: "Night", value: secToHHMM(aircraftData.total_night_seconds) },
                        { label: "First flight", value: aircraftData.first_flight },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[#18181B] border border-[#27272A] rounded-xl p-3 text-center">
                          <p className="text-lg font-semibold tabular-nums">{value}</p>
                          <p className="text-xs text-[#52525B] mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {(aircraftData.flights as Record<string, unknown>[]).map((f, i) => {
                        const dep = (f.dep_icao as string) || "—";
                        const arr = (f.arr_icao as string) || "—";
                        const block = secToHHMM((f.block_seconds as number) || 0);
                        const isPIC = (f.crew_role as string) === "pic";
                        return (
                          <Link key={i} href={`/aviation/${f.id}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#18181B] transition-colors text-xs"
                            onClick={() => setLookup(null)}
                          >
                            <span className="text-[#52525B] w-20 shrink-0 tabular-nums">{f.date as string}</span>
                            <span className="text-[#FAFAFA] font-mono">{dep} → {arr}</span>
                            <span className="text-[#A1A1AA] tabular-nums ml-auto">{block}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isPIC ? "bg-violet-950/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
                              {isPIC ? "PIC" : "FO"}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Captain panel */}
              {lookup.kind === "captain" && (
                captainLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-amber-500" />
                  </div>
                ) : !captainData ? (
                  <p className="text-[#71717A] text-sm text-center py-10">No flights found with captain <span className="text-[#FAFAFA]">{lookup.query}</span>.</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-base font-semibold text-[#FAFAFA]">{formatPicName(captainData.name)}</p>
                      <p className="text-xs text-[#71717A] font-mono">{captainData.name}</p>
                      {captainData.aircraft_types.length > 0 && (
                        <p className="text-xs text-[#52525B] mt-1">{captainData.aircraft_types.map(shortAircraftType).join(" · ")}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "Flights", value: String(captainData.total_flights) },
                        { label: "Block time", value: secToHHMM(captainData.total_block_seconds) },
                        { label: "Night", value: secToHHMM(captainData.total_night_seconds) },
                        { label: "First flight", value: captainData.first_flight },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-[#18181B] border border-[#27272A] rounded-xl p-3 text-center">
                          <p className="text-lg font-semibold tabular-nums">{value}</p>
                          <p className="text-xs text-[#52525B] mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {(captainData.flights as Record<string, unknown>[]).map((f, i) => {
                        const dep = (f.dep_icao as string) || "—";
                        const arr = (f.arr_icao as string) || "—";
                        const block = secToHHMM((f.block_seconds as number) || 0);
                        const isPIC = (f.crew_role as string) === "pic";
                        const acft = shortAircraftType(f.aircraft_type as string);
                        return (
                          <Link key={i} href={`/aviation/${f.id}`}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#18181B] transition-colors text-xs"
                            onClick={() => setLookup(null)}
                          >
                            <span className="text-[#52525B] w-20 shrink-0 tabular-nums">{f.date as string}</span>
                            <span className="text-[#FAFAFA] font-mono">{dep} → {arr}</span>
                            <span className="text-[#52525B] ml-auto">{acft}</span>
                            <span className="text-[#A1A1AA] tabular-nums">{block}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isPIC ? "bg-violet-950/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
                              {isPIC ? "PIC" : "FO"}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlightRow({ flight: f, codeMode }: { flight: FlightSummary; codeMode: CodeMode }) {
  const blockH = f.block_seconds ? (f.block_seconds / 3600).toFixed(1) : "—";
  const role = f.crew_role === "pic" ? "PIC" : f.crew_role === "first_officer" ? "SIC" : f.crew_role || "—";
  const dep = routeCode(f.dep_icao, f.dep_iata, codeMode);
  const arr = routeCode(f.arr_icao, f.arr_iata, codeMode);
  const { dot, badge } = operatorColor(f);

  return (
    <Link href={`/aviation/${f.id}`}
      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#18181B] transition-colors text-sm group">
      {/* Operator color dot */}
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
      <span className="text-[#52525B] text-xs w-20 shrink-0 tabular-nums">{f.date}</span>
      <span className="text-[#FAFAFA] font-mono text-xs">{dep} → {arr}</span>
      {f.night_seconds > 0 && (
        <span className="flex items-center gap-0.5 text-indigo-400 text-xs tabular-nums" title={`${secToHHMM(f.night_seconds)} night`}>
          <Moon size={9} />{(f.night_seconds / 3600).toFixed(1)}
        </span>
      )}
      <span className="text-[#71717A] text-xs ml-auto hidden sm:block">{f.flight_number || ""}</span>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${f.crew_role === "pic" ? "bg-violet-900/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
        {role}
      </span>
      <span className="text-[#A1A1AA] tabular-nums w-10 text-right text-xs">{blockH}h</span>
      <ChevronRight size={11} className="text-[#52525B] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </Link>
  );
}
