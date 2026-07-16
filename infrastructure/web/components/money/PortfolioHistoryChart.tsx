"use client";

import { useEffect, useState } from "react";
import { moneyApi, type PortfolioHistoryPoint, type PortfolioRange } from "@/lib/money-api";

const RANGES: PortfolioRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];

interface Props {
  data: PortfolioHistoryPoint[];
}

export function PortfolioHistoryChart({ data: initial }: Props) {
  const [range, setRange] = useState<PortfolioRange>("1Y");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // "1Y" is what the server rendered — restore it rather than keeping
    // whatever the previously selected range loaded.
    if (range === "1Y") { setData(initial); return; }
    let alive = true;
    setLoading(true);
    moneyApi.portfolioHistory(range).then(d => {
      if (alive) { setData(d); setLoading(false); }
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, initial]);

  if (data.length < 2) {
    return (
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-8 mb-4 text-center">
        <p className="text-xs text-[#52525B]">Not enough history yet — chart appears after a few daily syncs.</p>
      </div>
    );
  }

  const values = data.map(d => d.total_value_eur);
  const invs = data.map(d => d.invested_eur);
  const yMin = Math.min(...values, ...invs.filter(v => v > 0));
  const yMax = Math.max(...values, ...invs);
  const yRange = yMax - yMin || 1;

  const w = 640, h = 180, padX = 12, padY = 12;
  const step = (w - padX * 2) / (data.length - 1);

  function pathFor(vals: number[]) {
    return vals.map((v, i) => {
      const x = padX + i * step;
      const y = padY + (h - padY * 2) * (1 - (v - yMin) / yRange);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }

  const areaPath = pathFor(values) +
    ` L${padX + (data.length - 1) * step},${h - padY} L${padX},${h - padY} Z`;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#71717A] uppercase tracking-widest">Net worth</p>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                r === range ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#18181B] text-[#71717A] hover:text-[#D4D4D8]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-xs text-[#52525B]">Loading…</div>
      ) : (
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="block">
          <defs>
            <linearGradient id="ptfArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22C55E" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#ptfArea)" />
          {invs.some(v => v > 0) && (
            <path d={pathFor(invs)} fill="none" stroke="#71717A" strokeWidth="1.2" strokeDasharray="3 3" />
          )}
          <path d={pathFor(values)} fill="none" stroke="#22C55E" strokeWidth="1.8" />
        </svg>
      )}
      <div className="flex justify-between text-[10px] text-[#52525B] mt-2 px-2">
        <span className="text-[#22C55E]/70">Value</span>
        {/* Actual window covered — with young portfolios every range shows the
            same span until enough daily snapshots accumulate */}
        <span className="tabular-nums">{data[0].date} → {data[data.length - 1].date} · {data.length}d</span>
        <span>Invested (dashed)</span>
      </div>
    </div>
  );
}
