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
  const selected = months.find((m) => m.month === picked) ?? months[months.length - 1];
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

      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 pt-4 pb-2">
        {view === "flows" ? (
          <FlowBars months={months} selected={selected.month} onPick={setPicked} />
        ) : (
          <SavedBars months={months} selected={selected.month} onPick={setPicked} goal={goal} />
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
          <span className="ml-auto">Tap a month</span>
        </div>
      </div>

      <MonthCard m={selected} goal={goal} />

      <MonthTable months={[...months].reverse()} selected={selected.month} onPick={setPicked} />
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
    <span className={`block text-center text-[10px] leading-tight h-6 ${active ? "text-[#FAFAFA] font-semibold" : "text-[#52525B]"}`}>
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
      className={`flex-1 min-w-0 flex flex-col rounded-md transition-colors ${active ? "bg-[#27272A]/70" : "hover:bg-[#18181B]"}`}
      aria-label={format(monthDate(m), "MMMM yyyy")}
      aria-pressed={active}
    >
      {children}
      <MonthLabel m={m} n={n} active={active} />
    </button>
  );
}

function FlowBars({ months, selected, onPick }: { months: MonthDetail[]; selected: string; onPick: (m: string) => void }) {
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
  months: MonthDetail[]; selected: string; onPick: (m: string) => void; goal: number;
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

function MonthCard({ m, goal }: { m: MonthDetail; goal: number }) {
  const net = m.income - m.spent;
  const hit = goal > 0 && net >= goal;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[#FAFAFA]">{format(monthDate(m.month), "MMMM yyyy")}</p>
        <Link href={`/money?month=${m.month}`} className="text-xs text-[#F59E0B] hover:text-[#FCD34D]">
          Transactions →
        </Link>
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

function MonthTable({ months, selected, onPick }: { months: MonthDetail[]; selected: string; onPick: (m: string) => void }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <div className="grid grid-cols-[1fr_repeat(3,minmax(0,5.5rem))] gap-2 px-4 py-2 text-[10px] text-[#52525B] uppercase tracking-widest border-b border-[#18181B]">
        <span>Month</span>
        <span className="text-right">Income</span>
        <span className="text-right">Spent</span>
        <span className="text-right">Net</span>
      </div>
      {months.map((m) => {
        const net = m.income - m.spent;
        return (
          <button
            key={m.month}
            type="button"
            onClick={() => onPick(m.month)}
            className={`w-full grid grid-cols-[1fr_repeat(3,minmax(0,5.5rem))] gap-2 px-4 py-2 text-sm tabular-nums text-left border-b border-[#18181B] last:border-0 transition-colors ${
              m.month === selected ? "bg-[#27272A]/60" : "hover:bg-[#18181B]"
            }`}
          >
            <span className="text-[#A1A1AA]">{format(monthDate(m.month), "MMM yyyy")}</span>
            <span className="text-right text-[#D4D4D8]">{fmtAmount(m.income)}</span>
            <span className="text-right text-[#D4D4D8]">{fmtAmount(m.spent)}</span>
            <span className={`text-right ${net < 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>{signed(net)}</span>
          </button>
        );
      })}
    </div>
  );
}
