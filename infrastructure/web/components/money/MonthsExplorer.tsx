"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { moneyApi, fmtAmount, type MonthDetail } from "@/lib/money-api";
import { StatTile } from "./ui";

type View = "flows" | "saved";

const INCOME = "#22C55E";
const SPENT = "#EF4444";

const monthDate = (m: string) => parseISO(`${m}-01`);
const signed = (v: number) => `${v < 0 ? "−" : "+"}${fmtAmount(v)}`;
const pct = (f: number | null) => (f === null ? null : `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(0)}%`);

// Month by month: income vs spending or net saved, every bar tappable — the card
// below shows that month in full; the table lists every month.
export function MonthsExplorer({ goal }: { goal: number }) {
  const [view, setView] = useState<View>("flows");
  const [range, setRange] = useState<12 | 24>(12);
  const [picked, setPicked] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["money", "historical"],
    queryFn: () => moneyApi.historicalTrends(24),
  });

  if (isLoading) return <div className="h-64 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.months.length === 0) return <p className="text-xs text-[#52525B]">No history yet.</p>;

  const months = data.months.slice(-range);
  // Nothing picked = totals for the whole range; tapping the picked month again clears it.
  const selected = months.find((m) => m.month === picked) ?? null;
  const pick = (m: string) => setPicked((cur) => (cur === m ? null : m));
  const avgSaved = data.avg_monthly_income - data.avg_monthly_spent;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Avg income" value={fmtAmount(data.avg_monthly_income)} sub="per month" />
        <StatTile label="Avg spent" value={fmtAmount(data.avg_monthly_spent)} sub="per month" />
        <StatTile
          label="Avg saved"
          value={signed(avgSaved)}
          sub={`${Math.round(data.avg_savings_rate * 100)}% of income`}
          tone={avgSaved < 0 ? "bad" : goal && avgSaved < goal ? "warn" : "good"}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Toggle
          value={view}
          onChange={setView}
          options={[["flows", "Income & spending"], ["saved", "Saved"]]}
        />
        <Toggle value={range} onChange={setRange} options={[[12, "12 mo"], [24, "24 mo"]]} />
      </div>

      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-3 pt-4 pb-2">
        {view === "flows" ? (
          <FlowBars months={months} selected={selected?.month} onPick={pick} />
        ) : (
          <SavedBars months={months} selected={selected?.month} onPick={pick} goal={goal} />
        )}
        <div className="flex items-center gap-4 mt-3 text-[11px] text-[#71717A]">
          {view === "flows" ? (
            <>
              <Legend color={INCOME} label="Income" />
              <Legend color={SPENT} label="Spending" />
            </>
          ) : (
            <>
              <Legend color={INCOME} label="Saved" />
              <Legend color={SPENT} label="Overspent" />
              {goal > 0 && <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-[#A1A1AA]" />Goal</span>}
            </>
          )}
          <span className="ml-auto">{selected ? "Tap again for totals" : "Tap a month"}</span>
        </div>
      </div>

      {selected ? (
        <MonthCard m={selected} goal={goal} onClose={() => setPicked(null)} />
      ) : (
        <TotalsCard months={months} goal={goal} />
      )}

      <MonthTable months={[...months].reverse()} selected={selected?.month} onPick={pick} />
    </div>
  );
}

function Toggle<T extends string | number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: [T, string][];
}) {
  return (
    <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-0.5">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
            value === v ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// "Oct" under every month at 12; at 24 only every quarter. January carries the year.
function MonthLabel({ m, n, active }: { m: string; n: number; active: boolean }) {
  const d = monthDate(m);
  const show = n <= 12 || d.getMonth() % 3 === 0;
  return (
    <span className={`block text-center text-[10px] leading-tight h-6 ${active ? "text-[#F59E0B] font-semibold" : "text-[#52525B]"}`}>
      {show ? format(d, "MMM") : ""}
      {show && d.getMonth() === 0 && <span className="block text-[9px] text-[#71717A]">{format(d, "yyyy")}</span>}
    </span>
  );
}

function Column({ m, n, active, onPick, children }: {
  m: string; n: number; active: boolean; onPick: (m: string) => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(m)}
      className={`flex-1 min-w-0 flex flex-col rounded-md transition-colors ${active ? "bg-[#F59E0B]/10 ring-1 ring-[#F59E0B]/40" : "hover:bg-[#18181B]"}`}
      aria-label={format(monthDate(m), "MMMM yyyy")}
      aria-pressed={active}
    >
      {children}
      <MonthLabel m={m} n={n} active={active} />
    </button>
  );
}

function FlowBars({ months, selected, onPick }: { months: MonthDetail[]; selected?: string; onPick: (m: string) => void }) {
  const max = Math.max(...months.map((m) => Math.max(m.income, m.spent)), 1);
  return (
    <div className="flex gap-1">
      {months.map((m) => (
        <Column key={m.month} m={m.month} n={months.length} active={m.month === selected} onPick={onPick}>
          <div className="h-36 flex items-end justify-center gap-[2px] px-[2px]">
            <span className="flex-1 max-w-3 rounded-t-[3px]" style={{ height: `${(m.income / max) * 100}%`, background: INCOME }} />
            <span className="flex-1 max-w-3 rounded-t-[3px]" style={{ height: `${(m.spent / max) * 100}%`, background: SPENT }} />
          </div>
        </Column>
      ))}
    </div>
  );
}

function SavedBars({ months, selected, onPick, goal }: {
  months: MonthDetail[]; selected?: string; onPick: (m: string) => void; goal: number;
}) {
  const up = Math.max(...months.map((m) => m.savings), goal, 1);
  const down = Math.max(...months.map((m) => -m.savings), 0);
  const H = 144;
  const upH = (H * up) / (up + down);
  const goalY = upH - (goal / up) * upH;
  return (
    <div className="relative">
      {goal > 0 && (
        <div className="absolute left-0 right-0 border-t border-dashed border-[#A1A1AA]/60 pointer-events-none" style={{ top: goalY }} />
      )}
      <div className="flex gap-1">
        {months.map((m) => {
          const h = m.savings >= 0 ? (m.savings / up) * upH : (-m.savings / (down || 1)) * (H - upH);
          return (
            <Column key={m.month} m={m.month} n={months.length} active={m.month === selected} onPick={onPick}>
              <div className="relative w-full" style={{ height: H }}>
                <div className="absolute left-0 right-0 border-t border-[#3F3F46]" style={{ top: upH }} />
                <span
                  className="absolute left-1/2 -translate-x-1/2 w-3/5 max-w-5"
                  style={
                    m.savings >= 0
                      ? { bottom: H - upH, height: h, background: INCOME, borderRadius: "3px 3px 0 0" }
                      : { top: upH, height: h, background: SPENT, borderRadius: "0 0 3px 3px" }
                  }
                />
              </div>
            </Column>
          );
        })}
      </div>
    </div>
  );
}

function Delta({ label, f, goodWhenUp }: { label: string; f: number | null; goodWhenUp: boolean }) {
  const text = pct(f);
  if (text === null) return null;
  const good = f === 0 || (f! > 0) === goodWhenUp;
  return (
    <span className="text-xs">
      <span className="text-[#52525B]">{label} </span>
      <span className={`tabular-nums ${good ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{text}</span>
    </span>
  );
}

function MonthCard({ m, goal, onClose }: { m: MonthDetail; goal: number; onClose: () => void }) {
  const net = m.income - m.spent;
  const hit = goal > 0 && net >= goal;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[#FAFAFA]">{format(monthDate(m.month), "MMMM yyyy")}</p>
        <div className="flex items-center gap-3">
          <Link href={`/money?month=${m.month}`} className="text-xs text-[#F59E0B] hover:text-[#FCD34D]">
            Transactions →
          </Link>
          <button type="button" onClick={onClose} className="text-xs text-[#71717A] hover:text-[#FAFAFA]" aria-label="Back to totals">
            ✕
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Income</p>
          <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(m.income)}</p>
          <Delta label="vs prev" f={m.mom_income_pct} goodWhenUp />
        </div>
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Spent</p>
          <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(m.spent)}</p>
          <Delta label="vs prev" f={m.mom_expenses_pct} goodWhenUp={false} />
        </div>
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Net</p>
          <p className={`text-lg font-semibold tabular-nums ${net < 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>{signed(net)}</p>
          <span className="text-xs text-[#52525B]">{Math.round(m.savings_rate * 100)}% of income</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-[#18181B]">
        {goal > 0 && (
          <span className={`text-xs ${hit ? "text-[#22C55E]" : "text-[#A1A1AA]"}`}>
            {hit ? `✓ Goal hit (${fmtAmount(goal)})` : `${fmtAmount(goal - net)} short of the ${fmtAmount(goal)} goal`}
          </span>
        )}
        <Delta label="Spent vs a year ago" f={m.yoy_expenses_pct} goodWhenUp={false} />
        <Delta label="Income vs a year ago" f={m.yoy_income_pct} goodWhenUp />
      </div>
    </div>
  );
}

// Income / spent / net summed over a set of months.
function sums(months: MonthDetail[]) {
  const income = months.reduce((t, m) => t + m.income, 0);
  const spent = months.reduce((t, m) => t + m.spent, 0);
  return { income, spent, net: income - spent, rate: income > 0 ? (income - spent) / income : 0 };
}

function TotalsCard({ months, goal }: { months: MonthDetail[]; goal: number }) {
  const t = sums(months);
  const hits = goal > 0 ? months.filter((m) => m.income - m.spent >= goal).length : null;
  const first = format(monthDate(months[0].month), "MMM yyyy");
  const last = format(monthDate(months[months.length - 1].month), "MMM yyyy");
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-4">
      <p className="text-sm font-semibold text-[#FAFAFA] mb-3">
        {months.length} months <span className="font-normal text-[#71717A]">· {first} – {last}</span>
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Income</p>
          <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(t.income)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Spent</p>
          <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(t.spent)}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest">Net</p>
          <p className={`text-lg font-semibold tabular-nums ${t.net < 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>{signed(t.net)}</p>
          <span className="text-xs text-[#52525B]">{Math.round(t.rate * 100)}% of income</span>
        </div>
      </div>
      {hits !== null && (
        <p className="text-xs text-[#A1A1AA] mt-3 pt-3 border-t border-[#18181B]">
          Goal of {fmtAmount(goal)} hit in {hits} of {months.length} months
        </p>
      )}
    </div>
  );
}

const ROW = "grid grid-cols-[1fr_repeat(3,minmax(0,5.5rem))] gap-2 px-4 tabular-nums";

// Solid theme colours only — the light theme remaps bg-[#18181B] but not its /60 variant.
function SumRow({ label, months, total = false }: { label: string; months: MonthDetail[]; total?: boolean }) {
  const t = sums(months);
  return (
    <div
      className={`${ROW} items-baseline ${
        total ? "py-3 text-sm font-semibold border-t-2 border-[#3F3F46]" : "py-2 text-sm font-semibold bg-[#18181B] border-b border-[#27272A]"
      }`}
    >
      <span className={total ? "text-[#FAFAFA]" : "text-[11px] text-[#71717A] uppercase tracking-widest"}>{label}</span>
      <span className="text-right text-[#D4D4D8]">{fmtAmount(t.income)}</span>
      <span className="text-right text-[#D4D4D8]">{fmtAmount(t.spent)}</span>
      <span className={`text-right ${t.net < 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>{signed(t.net)}</span>
    </div>
  );
}

// Newest first, a subtotal row heading each calendar year, the range total at the bottom.
function MonthTable({ months, selected, onPick }: { months: MonthDetail[]; selected?: string; onPick: (m: string) => void }) {
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))];
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden">
      <div className={`${ROW} py-2 text-[10px] text-[#52525B] uppercase tracking-widest border-b border-[#18181B]`}>
        <span>Month</span>
        <span className="text-right">Income</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Net</span>
      </div>
      {years.map((y) => {
        const inYear = months.filter((m) => m.month.startsWith(y));
        return (
          <div key={y}>
            <SumRow label={`${y}${inYear.length < 12 ? ` · ${inYear.length} months` : ""}`} months={inYear} />
            {inYear.map((m) => {
              const net = m.income - m.spent;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => onPick(m.month)}
                  className={`w-full ${ROW} py-2 text-sm text-left border-b border-[#18181B] transition-colors ${
                    m.month === selected ? "bg-[#F59E0B]/10" : "hover:bg-[#18181B]"
                  }`}
                >
                  <span className={m.month === selected ? "text-[#F59E0B] font-medium" : "text-[#A1A1AA]"}>
                    {format(monthDate(m.month), "MMMM")}
                  </span>
                  <span className="text-right text-[#D4D4D8]">{fmtAmount(m.income)}</span>
                  <span className="text-right text-[#D4D4D8]">{fmtAmount(m.spent)}</span>
                  <span className={`text-right ${net < 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>{signed(net)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      <SumRow label={`Total · ${months.length} months`} months={months} total />
    </div>
  );
}
