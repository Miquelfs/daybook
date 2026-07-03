"use client";

import { useEffect, useState } from "react";
import { moneyApi, type HoldingHistoryPoint, type PortfolioRange } from "@/lib/money-api";

const RANGES: PortfolioRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];

interface Props {
  id: string;
  initial: HoldingHistoryPoint[];
}

export function HoldingHistoryChart({ id, initial }: Props) {
  const [range, setRange] = useState<PortfolioRange>("1Y");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (range === "1Y") return;
    let alive = true;
    setLoading(true);
    moneyApi.holdingHistory(id, range).then(d => {
      if (alive) { setData(d); setLoading(false); }
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, range]);

  if (data.length < 2) {
    return (
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-8 mb-4 text-center">
        <p className="text-xs text-[#52525B]">Price history builds up as daily syncs run.</p>
      </div>
    );
  }

  const values = data.map(d => d.price_eur);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const yRange = yMax - yMin || 1;

  const w = 640, h = 180, padX = 12, padY = 12;
  const step = (w - padX * 2) / (data.length - 1);

  const path = values.map((v, i) => {
    const x = padX + i * step;
    const y = padY + (h - padY * 2) * (1 - (v - yMin) / yRange);
    return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

  const areaPath = path + ` L${padX + (data.length - 1) * step},${h - padY} L${padX},${h - padY} Z`;
  const trendPos = values[values.length - 1] >= values[0];
  const stroke = trendPos ? "#22C55E" : "#EF4444";
  const fillId = trendPos ? "hArea+" : "hArea-";

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#71717A] uppercase tracking-widest">Price</p>
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
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${fillId})`} />
          <path d={path} fill="none" stroke={stroke} strokeWidth="1.8" />
        </svg>
      )}
      <div className="flex justify-between text-[10px] text-[#52525B] mt-2 px-2">
        <span>€{values[0].toFixed(2)}</span>
        <span>€{values[values.length - 1].toFixed(2)}</span>
      </div>
    </div>
  );
}
