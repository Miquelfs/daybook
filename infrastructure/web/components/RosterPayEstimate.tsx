"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Info, Plane, Calendar } from "lucide-react";

interface PerDiemDetail {
  date: string;
  first_dep: string;
  last_arr: string;
  perd_type: string;
  cross_midnight: boolean;
}

interface PayEstimate {
  month: string;
  category: string;
  level: number;
  irpf_rate: number;
  block_hours: number;
  sectors: number;
  sim_days: number;
  duty_counts: Record<string, number>;
  base_salary: number;
  fixed_supplements: {
    phone: number;
    connectivity: number;
    uniform: number;
    parking: number;
    total: number;
  };
  variable_pay: {
    blh_hours: number;
    blh_pay: number;
    blhp_hours: number;
    blhp_pay: number;
    sby_days: number;
    sby_pay: number;
    sim_days: number;
    sim_pay: number;
    vac_days: number;
    soc_pay: number;
    lvo_days: number;
    lvo_pay: number;
    dh_int_days: number;
    dh_int_pay: number;
    dh_int_overnight_days: number;
    dh_int_overnight_pay: number;
    bdo_days: number;
    bdo_pay: number;
    hdb_days: number;
    hdb_pay: number;
    total: number;
  };
  per_diem_detail: PerDiemDetail[];
  gross_monthly: number;
  net_monthly_estimate: number;
  notes: string[];
}

function fmt(n: number) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Row({
  label, value, sub, highlight, zero
}: {
  label: string; value: string; sub?: string; highlight?: boolean; zero?: boolean;
}) {
  if (zero) return null;
  return (
    <div className={`flex items-start justify-between py-2 ${highlight ? "border-t border-[#27272A] mt-1" : ""}`}>
      <div className="flex-1 min-w-0 pr-4">
        <p className={`text-sm ${highlight ? "font-semibold text-[#FAFAFA]" : "text-[#A1A1AA]"}`}>{label}</p>
        {sub && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
      </div>
      <p className={`text-sm tabular-nums shrink-0 ${highlight ? "font-bold text-[#F59E0B]" : "text-[#E4E4E7]"}`}>{value}</p>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <p className="text-xs text-[#52525B] uppercase tracking-widest pt-4 pb-1">{title}</p>;
}

export function RosterPayEstimate({ month, billedMonth }: { month: string; billedMonth: string }) {
  const [category, setCategory] = useState<"FO" | "CPT">("FO");
  const [level, setLevel] = useState(4);
  const [irpf, setIrpf] = useState(24); // percentage
  const [expanded, setExpanded] = useState(true);
  const [showPerDiemDetail, setShowPerDiemDetail] = useState(false);

  const { data, isLoading, error } = useQuery<PayEstimate>({
    queryKey: ["pay-estimate", month, category, level, irpf],
    queryFn: async () => {
      const res = await fetch(
        `/api/roster/pay-estimate?month=${month}&category=${category}&level=${level}&irpf=${irpf / 100}`
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 60_000,
  });

  const hasFlightData = data && data.block_hours > 0;
  const hasPerDiems = data && (data.variable_pay.dh_int_days + data.variable_pay.dh_int_overnight_days) > 0;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#111113] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20 flex items-center justify-center text-sm">
            💰
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-[#FAFAFA]">Pay estimate</p>
            <p className="text-xs text-[#52525B]">Billed in {billedMonth} · CLA 2025</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && !isLoading && (
            <div className="text-right">
              <p className="text-sm font-bold text-[#F59E0B] tabular-nums">{fmt(data.gross_monthly)}</p>
              <p className="text-xs text-[#52525B]">gross</p>
            </div>
          )}
          {expanded ? <ChevronUp size={16} className="text-[#52525B]" /> : <ChevronDown size={16} className="text-[#52525B]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[#18181B] space-y-1">

          {/* Config row */}
          <div className="flex flex-wrap items-center gap-3 pt-4">
            {/* Category */}
            <div className="flex gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
              {(["FO", "CPT"] as const).map(c => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${category === c ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                  {c}
                </button>
              ))}
            </div>

            {/* Level */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#52525B]">Lvl</span>
              <div className="flex gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
                <button onClick={() => setLevel(l => Math.max(1, l - 1))}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors text-xs">−</button>
                <span className="w-5 text-center text-sm font-semibold text-[#FAFAFA]">{level}</span>
                <button onClick={() => setLevel(l => Math.min(10, l + 1))}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors text-xs">+</button>
              </div>
            </div>

            {/* IRPF */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#52525B]">IRPF</span>
              <div className="flex gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
                <button onClick={() => setIrpf(i => Math.max(15, i - 1))}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors text-xs">−</button>
                <span className="w-8 text-center text-sm font-semibold text-[#FAFAFA]">{irpf}%</span>
                <button onClick={() => setIrpf(i => Math.min(47, i + 1))}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors text-xs">+</button>
              </div>
            </div>
          </div>

          {isLoading && (
            <div className="h-20 flex items-center justify-center py-4">
              <div className="w-4 h-4 border-2 border-[#F59E0B] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 py-3">Failed to load estimate — is the Pi reachable?</p>
          )}

          {data && !isLoading && (
            <>
              {!hasFlightData && (
                <div className="flex items-start gap-2 bg-[#1a1a0a] border border-[#F59E0B]/20 rounded-xl px-4 py-3 mt-3">
                  <Info size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
                  <p className="text-xs text-[#A1A1AA]">
                    No flights logged for {month} yet. Block hours and per diems will populate once flights are synced from Norwegian.
                  </p>
                </div>
              )}

              {/* ── Fixed ─────────────────────────────────────────────── */}
              <SectionHeader title="Fixed remuneration" />
              <div className="divide-y divide-[#111113]">
                <Row label="Base salary" value={fmt(data.base_salary)}
                  sub={`${category} Level ${level} · 2025 table`} />
                <Row label="Phone + connectivity" value={fmt(data.fixed_supplements.phone + data.fixed_supplements.connectivity)} />
                <Row label="Uniform supplement" value={fmt(data.fixed_supplements.uniform)} />
              </div>

              {/* ── Variable ──────────────────────────────────────────── */}
              <SectionHeader title="Variable pay (billed next month)" />
              <div className="divide-y divide-[#111113]">
                <Row
                  label={`BLH — ${data.variable_pay.blh_hours.toFixed(1)}h`}
                  value={fmt(data.variable_pay.blh_pay)}
                  sub={hasFlightData ? `${data.sectors} sectors · €${(data.variable_pay.blh_pay / Math.max(data.variable_pay.blh_hours, 0.01)).toFixed(2)}/h` : "No flights yet"}
                  zero={data.variable_pay.blh_pay === 0 && !hasFlightData}
                />
                {data.variable_pay.blhp_hours > 0 && (
                  <Row
                    label={`BLHp — ${data.variable_pay.blhp_hours.toFixed(1)}h over 60h`}
                    value={fmt(data.variable_pay.blhp_pay)}
                    sub="Productivity supplement (Art.2.02)"
                  />
                )}
                <Row label={`STBY — ${data.variable_pay.sby_days} day${data.variable_pay.sby_days !== 1 ? "s" : ""}`}
                  value={fmt(data.variable_pay.sby_pay)}
                  zero={data.variable_pay.sby_days === 0} />
                <Row label={`Simulator — ${data.variable_pay.sim_days} day${data.variable_pay.sim_days !== 1 ? "s" : ""}`}
                  value={fmt(data.variable_pay.sim_pay)}
                  zero={data.variable_pay.sim_days === 0} />
                <Row label={`VAC/SOC — ${data.variable_pay.vac_days} day${data.variable_pay.vac_days !== 1 ? "s" : ""}`}
                  value={fmt(data.variable_pay.soc_pay)}
                  sub="Variable supplement on vacation days"
                  zero={data.variable_pay.vac_days === 0} />
                <Row label={`DH positioning — ${data.variable_pay.lvo_days} day${data.variable_pay.lvo_days !== 1 ? "s" : ""}`}
                  value={fmt(data.variable_pay.lvo_pay)}
                  sub="LVO days from roster"
                  zero={data.variable_pay.lvo_days === 0} />
              </div>

              {/* ── Per diems ─────────────────────────────────────────── */}
              {hasFlightData && (
                <>
                  <SectionHeader title="Per diems (from flight data)" />
                  <div className="divide-y divide-[#111113]">
                    <Row
                      label={`Intl day trip — ${data.variable_pay.dh_int_days} day${data.variable_pay.dh_int_days !== 1 ? "s" : ""}`}
                      value={fmt(data.variable_pay.dh_int_pay)}
                      sub="Departed & returned to PMI same day"
                      zero={data.variable_pay.dh_int_days === 0}
                    />
                    <Row
                      label={`Intl overnight — ${data.variable_pay.dh_int_overnight_days} night${data.variable_pay.dh_int_overnight_days !== 1 ? "s" : ""}`}
                      value={fmt(data.variable_pay.dh_int_overnight_pay)}
                      sub="Away from base at end of duty day"
                      zero={data.variable_pay.dh_int_overnight_days === 0}
                    />
                    <Row
                      label={`BDO — ${data.variable_pay.bdo_days} day${data.variable_pay.bdo_days !== 1 ? "s" : ""}`}
                      value={fmt(data.variable_pay.bdo_pay)}
                      sub="Landing after 00:01 UTC on day off (Art.2.07)"
                      zero={data.variable_pay.bdo_days === 0}
                    />
                    <Row
                      label={`HDB — ${data.variable_pay.hdb_days} half-day${data.variable_pay.hdb_days !== 1 ? "s" : ""}`}
                      value={fmt(data.variable_pay.hdb_pay)}
                      sub="Landing 00:01–04:00 UTC next day (Art.2.09)"
                      zero={data.variable_pay.hdb_days === 0}
                    />
                  </div>

                  {/* Per diem day detail toggle */}
                  {data.per_diem_detail.length > 0 && (
                    <button
                      onClick={() => setShowPerDiemDetail(s => !s)}
                      className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors mt-2"
                    >
                      <Plane size={11} />
                      {showPerDiemDetail ? "Hide" : "Show"} per-day breakdown
                      {showPerDiemDetail ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  )}

                  {showPerDiemDetail && (
                    <div className="mt-2 space-y-1">
                      {data.per_diem_detail.map((d) => (
                        <div key={d.date} className="flex items-center gap-3 px-3 py-2 bg-[#111113] rounded-lg">
                          <Calendar size={11} className="text-[#52525B] shrink-0" />
                          <span className="text-xs text-[#71717A] tabular-nums w-20 shrink-0">
                            {new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                          <span className="text-xs text-[#A1A1AA] font-mono">{d.first_dep} → {d.last_arr}</span>
                          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            d.perd_type === "int_overnight"
                              ? "bg-indigo-900/40 text-indigo-300"
                              : "bg-emerald-900/30 text-emerald-400"
                          }`}>
                            {d.perd_type === "int_overnight" ? "Overnight" : "Day trip"}
                          </span>
                          {d.cross_midnight && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 font-medium">
                              00:xx
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Totals ────────────────────────────────────────────── */}
              <div className="bg-[#111113] rounded-xl px-4 py-3 mt-4 space-y-0">
                <Row label="Gross monthly" value={fmt(data.gross_monthly)} highlight />
                <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#1a1a1a]">
                  <div>
                    <p className="text-sm text-[#A1A1AA]">Net estimate</p>
                    <p className="text-xs text-[#52525B] mt-0.5">After {irpf}% IRPF + 6.35% SS</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-400 tabular-nums">{fmt(data.net_monthly_estimate)}</p>
                </div>
              </div>

              {/* Billing note */}
              <div className="flex items-start gap-2 bg-[#18181B] rounded-xl px-4 py-3 mt-3">
                <Info size={13} className="text-[#52525B] mt-0.5 shrink-0" />
                <p className="text-[11px] text-[#52525B] leading-relaxed">
                  Variable pay + per diems from <strong className="text-[#71717A]">{month}</strong> are billed in <strong className="text-[#71717A]">{billedMonth}</strong>. Fixed salary is always current month. Per diems inferred from ICAO codes — every NAS Spain flight counted as international.
                </p>
              </div>

              <p className="text-[10px] text-[#3F3F46] leading-relaxed pt-1">
                Estimate only. Actual payslip may differ due to per diem caps, corrections, or unreported items. Consult your payslip for exact figures.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Standalone hook + card for finance forecast integration ───────────────────

export function usePayEstimate(month: string, category = "FO", level = 4, irpf = 0.24) {
  return useQuery<PayEstimate>({
    queryKey: ["pay-estimate", month, category, level, irpf],
    queryFn: async () => {
      const res = await fetch(
        `/api/roster/pay-estimate?month=${month}&category=${category}&level=${level}&irpf=${irpf}`
      );
      if (!res.ok) throw new Error("no estimate");
      return res.json();
    },
    staleTime: 120_000,
  });
}
