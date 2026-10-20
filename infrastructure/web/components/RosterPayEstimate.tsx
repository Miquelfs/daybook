"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, Info, AlertTriangle } from "lucide-react";
import {
  usePaySettings, useSavePaySettings, fmtEur, dayBadge,
  PER_DIEM_LABEL, type PayEstimate, type PayLine, type PayDay,
} from "@/lib/roster-pay";

const monthName = (m: string) => format(parseISO(m + "-01"), "MMMM yyyy");
const shortDay = (d: string) => format(parseISO(d), "EEE d");

function Line({ l }: { l: PayLine }) {
  const hasUnits = l.units != null && l.rate != null;
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="text-[10px] font-mono text-[#3F3F46] w-9 shrink-0">{l.code}</span>
      <span className="flex-1 min-w-0 text-sm text-[#A1A1AA] truncate">
        {l.label}
        {l.in_kind && <span className="text-[10px] text-[#52525B] ml-1.5">in kind</span>}
      </span>
      {hasUnits && (
        <span className="text-xs text-[#52525B] tabular-nums shrink-0 hidden sm:inline">
          {Number.isInteger(l.units) ? l.units : l.units!.toFixed(2)} × {l.rate!.toFixed(2)}
        </span>
      )}
      <span className="text-sm tabular-nums text-[#E4E4E7] w-24 text-right shrink-0">{fmtEur(l.amount)}</span>
    </div>
  );
}

function Total({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: "plain" | "gross" | "net" | "minus" }) {
  const color = tone === "gross" ? "text-[#F59E0B] font-bold" : tone === "net" ? "text-emerald-400 font-bold" : tone === "minus" ? "text-[#A1A1AA]" : "text-[#E4E4E7]";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className={`text-sm ${tone === "gross" || tone === "net" ? "font-semibold text-[#FAFAFA]" : "text-[#A1A1AA]"}`}>{label}</p>
        {sub && <p className="text-[11px] text-[#52525B] mt-0.5">{sub}</p>}
      </div>
      <p className={`text-sm tabular-nums shrink-0 ${color}`}>{value}</p>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <p className="text-xs text-[#52525B] uppercase tracking-widest pt-4 pb-1">{title}</p>;
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[#52525B]">{label}</span>
      <div className="flex items-center gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
        <button onClick={onDec} aria-label={`Decrease ${label}`} className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] text-xs">−</button>
        <span className="min-w-[2.75rem] text-center text-sm font-semibold text-[#FAFAFA] tabular-nums">{value}</span>
        <button onClick={onInc} aria-label={`Increase ${label}`} className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:text-[#FAFAFA] text-xs">+</button>
      </div>
    </div>
  );
}

function Settings() {
  const { data: s } = usePaySettings();
  const save = useSavePaySettings();
  if (!s) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-4">
      <div className="flex gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
        {(["FO", "CPT"] as const).map(c => (
          <button key={c} onClick={() => save.mutate({ category: c })}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${s.category === c ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
            {c}
          </button>
        ))}
      </div>
      <Stepper label="Lvl" value={String(s.level)}
        onDec={() => save.mutate({ level: Math.max(1, s.level - 1) })}
        onInc={() => save.mutate({ level: Math.min(10, s.level + 1) })} />
      <Stepper label="IRPF" value={`${s.irpf_pct.toFixed(2)}%`}
        onDec={() => save.mutate({ irpf_pct: Math.max(0, +(s.irpf_pct - 0.25).toFixed(2)) })}
        onInc={() => save.mutate({ irpf_pct: Math.min(50, +(s.irpf_pct + 0.25).toFixed(2)) })} />
      <Stepper label="Jornada" value={`${s.jornada_pct}%`}
        onDec={() => save.mutate({ jornada_pct: Math.max(50, s.jornada_pct - 10) })}
        onInc={() => save.mutate({ jornada_pct: Math.min(100, s.jornada_pct + 10) })} />
    </div>
  );
}

function DayRow({ d, onSelect }: { d: PayDay; onSelect?: (date: string) => void }) {
  const badge = dayBadge(d);
  const bits = [
    d.route || null,
    d.per_diem ? PER_DIEM_LABEL[d.per_diem] : null,
    d.positioning ? `${d.positioning}× positioning` : null,
    d.standby_paid ? "SBY paid" : null,
    d.sim ? "Sim" : null,
  ].filter(Boolean);
  return (
    <button onClick={() => onSelect?.(d.date)}
      className="w-full flex items-center gap-3 px-3 py-2 bg-[#111113] hover:bg-[#18181B] rounded-lg text-left transition-colors">
      <span className="text-xs text-[#71717A] tabular-nums w-12 shrink-0">{shortDay(d.date)}</span>
      <span className="text-[11px] text-[#52525B] w-9 shrink-0">{d.planned_code ?? "—"}</span>
      <span className="flex-1 min-w-0 text-xs text-[#A1A1AA] truncate">{bits.join(" · ") || "—"}</span>
      {d.projected && <span className="pay-badge pay-badge-mute text-[10px] px-1.5 py-0.5">Plan</span>}
      {badge && <span className={`pay-badge pay-badge-${badge.tone} text-[10px] px-1.5 py-0.5`}>{badge.label}</span>}
      {Object.keys(d.override).length > 0 && <span className="text-[10px] text-[#F59E0B]" title="Edited">✎</span>}
    </button>
  );
}

export function RosterPayEstimate({ data, isLoading, error, onSelectDate }: {
  data: PayEstimate | undefined;
  isLoading: boolean;
  error: unknown;
  onSelectDate?: (date: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showDays, setShowDays] = useState(false);

  const fixed = data?.fixed ?? [];
  const work = data?.variable.filter(v => !v.per_diem) ?? [];
  const dietas = data?.variable.filter(v => v.per_diem) ?? [];
  const flagged = data ? data.flags.activated.length + data.flags.not_flown.length + data.flags.extra_duty.length : 0;
  const payDays = data?.days.filter(d => d.route || d.per_diem || d.standby_paid || d.sim || d.positioning || d.bdo || d.planned === "standby" || d.status !== "as_planned") ?? [];

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#111113] transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20 flex items-center justify-center text-sm shrink-0">💰</div>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-[#FAFAFA] truncate">
              {data ? `${monthName(data.payslip_month)} payslip` : "Payslip estimate"}
            </p>
            <p className="text-xs text-[#52525B] truncate">
              {data ? `Variable pay from ${format(parseISO(data.activity_month + "-01"), "MMMM")}` : "CLA II ESP"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {data && !isLoading && (
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-400 tabular-nums">{fmtEur(data.net)}</p>
              <p className="text-xs text-[#52525B] tabular-nums">{fmtEur(data.gross)} gross</p>
            </div>
          )}
          {expanded ? <ChevronUp size={16} className="text-[#52525B]" /> : <ChevronDown size={16} className="text-[#52525B]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[#18181B]">
          <Settings />

          {isLoading && (
            <div className="h-20 flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-[#F59E0B] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!!error && <p className="text-xs text-rose-400 py-3">Failed to load estimate — is the Pi reachable?</p>}

          {data && !isLoading && (
            <>
              {data.projected_days > 0 && (
                <div className="flex items-start gap-2 bg-[#18181B] rounded-xl px-4 py-3 mt-4">
                  <Info size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
                  <p className="text-xs text-[#A1A1AA] leading-relaxed">
                    {data.projected_days} upcoming flying day{data.projected_days !== 1 ? "s" : ""} projected from the roster
                    ({data.block_hours_actual.toFixed(1)} h logged + {(data.block_hours - data.block_hours_actual).toFixed(1)} h planned).
                  </p>
                </div>
              )}

              {flagged > 0 && (
                <div className="flex items-start gap-2 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl px-4 py-3 mt-3">
                  <AlertTriangle size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
                  <div className="text-xs text-[#A1A1AA] leading-relaxed space-y-0.5">
                    {data.flags.activated.length > 0 && (
                      <p><strong className="text-[#E4E4E7]">Called out from standby:</strong> {data.flags.activated.map(shortDay).join(", ")}. Paid as flying, not as SBY.</p>
                    )}
                    {data.flags.not_flown.length > 0 && (
                      <p><strong className="text-[#E4E4E7]">Planned flying, nothing logged:</strong> {data.flags.not_flown.map(shortDay).join(", ")}. Swap or cancellation?</p>
                    )}
                    {data.flags.extra_duty.length > 0 && (
                      <p><strong className="text-[#E4E4E7]">Flew on a day off:</strong> {data.flags.extra_duty.map(shortDay).join(", ")}
                        {data.flags.bdo_unconfirmed.length > 0 ? ". If it was a BDO, mark it on the day." : "."}</p>
                    )}
                    <p className="text-[#52525B]">Tap a day to correct what&apos;s paid.</p>
                  </div>
                </div>
              )}

              <Section title={`Fixed · ${monthName(data.payslip_month)}${data.jornada_pct < 100 ? ` · ${data.jornada_pct}%` : ""}`} />
              <div className="divide-y divide-[#18181B]">{fixed.map(l => <Line key={l.key} l={l} />)}</div>

              <Section title={`Variable · ${monthName(data.activity_month)} · ${data.block_hours.toFixed(2)} h`} />
              <div className="divide-y divide-[#18181B]">
                {work.length ? work.map(l => <Line key={l.key} l={l} />) : <p className="text-xs text-[#52525B] py-2">Nothing logged yet.</p>}
              </div>
              {data.jornada_prev_pct < 100 && (
                <p className="text-[11px] text-[#52525B] pt-1">Reduced band from {data.blh_threshold} h at {data.jornada_prev_pct}% jornada.</p>
              )}

              {dietas.length > 0 && (
                <>
                  <Section title="Dietas (exempt)" />
                  <div className="divide-y divide-[#18181B]">{dietas.map(l => <Line key={l.key} l={l} />)}</div>
                </>
              )}

              <div className="bg-[#111113] rounded-xl px-4 py-2 mt-4 divide-y divide-[#18181B]">
                <Total label="Total devengado" value={fmtEur(data.gross)} tone="gross" />
                <Total label="In-kind (insurance + pension)" value={`− ${fmtEur(data.in_kind)}`} tone="minus" sub="Accrued and deducted — no effect on net" />
                <Total label="Social Security" value={`− ${fmtEur(data.social_security.total)}`} tone="minus"
                  sub={`Base ${fmtEur(data.social_security.base)}${data.social_security.excess > 0 ? " (capped)" : ""} · CC ${fmtEur(data.social_security.common)} · desempleo ${fmtEur(data.social_security.unemployment)} · FP ${fmtEur(data.social_security.training)}${data.social_security.solidarity ? ` · solidaria ${fmtEur(data.social_security.solidarity)}` : ""}`} />
                <Total label={`IRPF ${data.irpf_pct.toFixed(2)}%`} value={`− ${fmtEur(data.irpf)}`} tone="minus"
                  sub={`On ${fmtEur(data.irpf_base)} — pay minus in-kind and exempt dietas`} />
                <Total label="IRPF in kind" value={`− ${fmtEur(data.irpf_in_kind)}`} tone="minus" sub="Licence-loss insurance" />
                <Total label="Líquido a percibir" value={fmtEur(data.net)} tone="net" />
              </div>

              {payDays.length > 0 && (
                <button onClick={() => setShowDays(s => !s)}
                  className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors mt-3">
                  {showDays ? "Hide" : "Show"} day-by-day ({payDays.length} days)
                  {showDays ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
              {showDays && (
                <div className="mt-2 space-y-1">
                  {payDays.map(d => <DayRow key={d.date} d={d} onSelect={onSelectDate} />)}
                </div>
              )}

              <p className="text-[10px] text-[#3F3F46] leading-relaxed pt-3">
                Calibrated to the Sep 2026 payslip. Not modelled: travel expense refunds (gastos de viaje), arrears and one-off corrections.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
