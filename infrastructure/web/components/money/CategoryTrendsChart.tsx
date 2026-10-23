"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

const SHOWN = 8;

type Row = {
  category: string;
  series: number[];      // one value per month, oldest first
  total: number;
  avg: number;
  recent: number;        // average of the last 3 months
  change: number | null; // recent vs the months before, as a fraction
};

// One row per category, biggest first: 12-month total, monthly average, a strip
// of the months, and whether the last 3 months ran above or below its usual.
// Every row is labelled, so there's no legend and no colour per category.
export function CategoryTrendsChart() {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["money", "categoryTrends"],
    queryFn: () => moneyApi.categoryTrends(12),
  });

  if (isLoading) return <div className="h-64 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.months.length === 0) return <p className="text-sm text-[#52525B]">No history yet.</p>;

  const idx = new Map(data.months.map((m, i) => [m, i]));
  const byCat = new Map<string, number[]>();
  for (const it of data.items) {
    const series = byCat.get(it.category) ?? data.months.map(() => 0);
    series[idx.get(it.month)!] += Math.max(0, it.spent);
    byCat.set(it.category, series);
  }

  const rows: Row[] = [...byCat.entries()]
    .map(([category, series]) => {
      const total = series.reduce((a, b) => a + b, 0);
      const last3 = series.slice(-3);
      const before = series.slice(0, -3);
      const recent = last3.reduce((a, b) => a + b, 0) / Math.max(last3.length, 1);
      const usual = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
      return {
        category, series, total,
        avg: total / series.length,
        recent,
        change: usual > 0 ? (recent - usual) / usual : null,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const grand = rows.reduce((t, r) => t + r.total, 0);
  const visible = showAll ? rows : rows.slice(0, SHOWN);
  const first = format(parseISO(`${data.months[0]}-01`), "MMM yyyy");
  const last = format(parseISO(`${data.months[data.months.length - 1]}-01`), "MMM yyyy");

  return (
    <div>
      <p className="text-xs text-[#52525B] mb-3">
        {first} – {last} · {fmtAmount(grand)} across {rows.length} categories. ▲▼ compares the last 3 months with the months before.
      </p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
        {visible.map((r) => (
          <CategoryRow
            key={r.category}
            r={r}
            share={grand ? r.total / grand : 0}
            months={data.months}
            open={open === r.category}
            onToggle={() => setOpen((o) => (o === r.category ? null : r.category))}
          />
        ))}
      </div>
      {rows.length > SHOWN && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full mt-2 py-2 text-xs text-[#71717A] hover:text-[#FAFAFA]"
        >
          {showAll ? "Show top 8" : `Show all ${rows.length} categories`}
        </button>
      )}
    </div>
  );
}

function Trend({ change }: { change: number | null }) {
  if (change === null) return <span className="text-xs text-[#3F3F46] w-14 text-right">—</span>;
  const pct = Math.round(change * 100);
  if (Math.abs(pct) < 10) return <span className="text-xs text-[#71717A] w-14 text-right">steady</span>;
  // Spending up is the bad direction
  return (
    <span className={`text-xs tabular-nums w-14 text-right ${pct > 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function CategoryRow({ r, share, months, open, onToggle }: {
  r: Row; share: number; months: string[]; open: boolean; onToggle: () => void;
}) {
  const max = Math.max(...r.series, 1);
  return (
    <div>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#18181B] transition-colors">
        <span className="text-base w-6 text-center shrink-0">{CATEGORY_EMOJI[r.category] ?? "💳"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#D4D4D8] truncate">{r.category}</p>
          <p className="text-xs text-[#52525B] tabular-nums truncate">
            {fmtAmount(r.avg)}/mo · {Math.round(share * 100)}% of spending
          </p>
        </div>
        {/* The months as one-colour bars; the last one darker = most recent */}
        <div className="hidden sm:flex items-end gap-[2px] h-7 w-24 shrink-0" aria-hidden>
          {r.series.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[2px]"
              style={{
                height: `${v > 0 ? Math.max((v / max) * 100, 6) : 0}%`,
                background: i === r.series.length - 1 ? "#A1A1AA" : "#52525B",
              }}
            />
          ))}
        </div>
        <span className="text-sm tabular-nums text-[#FAFAFA] w-20 text-right shrink-0">{fmtAmount(r.total)}</span>
        <Trend change={r.change} />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="flex items-end gap-1 h-24">
            {r.series.map((v, i) => (
              <div key={months[i]} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full">
                <span className="text-[9px] text-[#71717A] tabular-nums mb-0.5">{v > 0 ? Math.round(v) : ""}</span>
                <span
                  className="w-full max-w-5 rounded-t-[3px] bg-[#71717A]"
                  style={{ height: `${v > 0 ? Math.max((v / max) * 70, 2) : 0}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-1">
            {months.map((m) => (
              <span key={m} className="flex-1 min-w-0 text-center text-[9px] text-[#52525B]">
                {format(parseISO(`${m}-01`), "MMM").slice(0, 3)}
              </span>
            ))}
          </div>
          <p className="text-xs text-[#52525B] mt-2 tabular-nums">
            Last 3 months {fmtAmount(r.recent)}/mo · 12-month average {fmtAmount(r.avg)}/mo
          </p>
        </div>
      )}
    </div>
  );
}
