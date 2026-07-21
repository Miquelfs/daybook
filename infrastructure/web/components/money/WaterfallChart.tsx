"use client";

import { fmtAmount, type WaterfallData } from "@/lib/money-api";

// "Where the money went": a top-line flow (income → expenses → net) plus a
// ranked category breakdown. Expenses share one hue (magnitude, one identity);
// income/net carry reserved status colours (good/critical), never a category hue.
const CAT_HUE = "#F59E0B";

export function WaterfallChart({ data }: { data: WaterfallData }) {
  const cats = [...data.categories].sort((a, b) => b.amount - a.amount);
  const totalExp = cats.reduce((s, c) => s + c.amount, 0);
  const maxCat = Math.max(...cats.map((c) => c.amount), 1);
  const net = data.savings;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      {/* Flow summary */}
      <div className="flex items-stretch gap-2 mb-5">
        <Flow label="Income" value={data.income} color="#22C55E" />
        <Flow label="Expenses" value={-totalExp} color="#EF4444" />
        <Flow label={net >= 0 ? "Saved" : "Overspent"} value={net} color={net >= 0 ? "#22C55E" : "#EF4444"} strong />
      </div>

      {/* Ranked category breakdown */}
      <div className="flex flex-col gap-2.5">
        {cats.map((c) => {
          const pct = totalExp > 0 ? (c.amount / totalExp) * 100 : 0;
          return (
            <div key={c.name} className="group">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#A1A1AA]">{c.name}</span>
                <span className="tabular-nums text-[#71717A]">
                  {fmtAmount(c.amount)}
                  <span className="text-[#3F3F46]"> · {pct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all group-hover:opacity-100 opacity-85"
                  style={{ width: `${Math.max((c.amount / maxCat) * 100, 1.5)}%`, backgroundColor: CAT_HUE }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[#52525B] mt-4">
        {net >= 0
          ? `${(data.savings_rate * 100).toFixed(0)}% of income kept`
          : "spent more than earned this month"}
      </p>
    </div>
  );
}

function Flow({ label, value, color, strong = false }: { label: string; value: number; color: string; strong?: boolean }) {
  return (
    <div className="flex-1 bg-[#111113] border border-[#27272A] rounded-lg px-3 py-2">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-0.5">{label}</p>
      <p className={`tabular-nums ${strong ? "text-base font-semibold" : "text-sm"}`} style={{ color }}>
        {value < 0 ? "−" : ""}{fmtAmount(Math.abs(value))}
      </p>
    </div>
  );
}
