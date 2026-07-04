"use client";

import { fmtAmount, type WaterfallData } from "@/lib/money-api";

// Income → category expenses → savings, as horizontal waterfall rows.
// One identity (money flow), so expenses share a single hue; income and
// savings carry inflow/outcome semantics.
export function WaterfallChart({ data }: { data: WaterfallData }) {
  const totalExpenses = data.categories.reduce((s, c) => s + c.amount, 0);
  const scale = Math.max(data.income, totalExpenses, 1);

  let running = data.income;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="flex flex-col gap-1">
        {/* Income */}
        <Row
          label="Income"
          amount={data.income}
          leftPct={0}
          widthPct={(data.income / scale) * 100}
          color="#22C55E"
          strong
        />

        {/* Expense steps, walking left from income */}
        {data.categories.map((c) => {
          const before = running;
          running -= c.amount;
          const left = (Math.max(running, 0) / scale) * 100;
          const width = ((Math.min(before, scale) - Math.max(running, 0)) / scale) * 100;
          return (
            <Row
              key={c.name}
              label={c.name}
              amount={-c.amount}
              leftPct={left}
              widthPct={width}
              color="#3B82F6"
            />
          );
        })}

        {/* Savings */}
        <Row
          label="Savings"
          amount={data.savings}
          leftPct={0}
          widthPct={(Math.abs(data.savings) / scale) * 100}
          color={data.savings >= 0 ? "#22C55E" : "#EF4444"}
          strong
        />
      </div>
      <p className="text-xs text-[#52525B] mt-3">
        {data.savings >= 0
          ? `${(data.savings_rate * 100).toFixed(0)}% of income kept`
          : "spent more than earned this month"}
      </p>
    </div>
  );
}

function Row({
  label, amount, leftPct, widthPct, color, strong = false,
}: {
  label: string; amount: number; leftPct: number; widthPct: number; color: string; strong?: boolean;
}) {
  return (
    <div className="group" title={`${label}: ${amount < 0 ? "−" : ""}${fmtAmount(amount)}`}>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className={strong ? "text-[#D4D4D8] font-medium" : "text-[#71717A]"}>{label}</span>
        <span className={`tabular-nums ${strong ? "text-[#D4D4D8]" : "text-[#52525B]"}`}>
          {amount < 0 ? "−" : ""}{fmtAmount(amount)}
        </span>
      </div>
      <div className="h-3 rounded-sm bg-[#18181B] relative overflow-hidden">
        <div
          className="absolute top-0 h-full rounded-sm opacity-70 group-hover:opacity-100 transition-opacity"
          style={{
            left: `${leftPct}%`,
            width: `${Math.max(widthPct, 0.5)}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
