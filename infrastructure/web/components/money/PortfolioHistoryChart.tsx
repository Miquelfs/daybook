"use client";

import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { moneyApi, fmtAmount, type PortfolioHistoryPoint, type PortfolioRange } from "@/lib/money-api";
import { Skeleton } from "@/components/ui/kit";

const RANGES: PortfolioRange[] = ["1M", "3M", "YTD", "1Y", "ALL"];
const WORTH = "#22C55E";
const MONEY_IN = "#71717A";

interface Props {
  data: PortfolioHistoryPoint[];
}

// Worth vs money put in over time. Hover (or touch and drag) for any day's values.
export function PortfolioHistoryChart({ data: initial }: Props) {
  const [range, setRange] = useState<PortfolioRange>("1Y");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // "1Y" is what the server rendered — restore it rather than keeping
    // whatever the previously selected range loaded.
    setHover(null);
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
  const hasInv = invs.some(v => v > 0);
  const yMin = Math.min(...values, ...(hasInv ? invs : []));
  const yMax = Math.max(...values, ...(hasInv ? invs : []));
  const yRange = yMax - yMin || 1;

  const w = 640, h = 180, padX = 12, padY = 12;
  const step = (w - padX * 2) / (data.length - 1);
  const x = (i: number) => padX + i * step;
  const y = (v: number) => padY + (h - padY * 2) * (1 - (v - yMin) / yRange);

  const pathFor = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const areaPath = pathFor(values) + ` L${x(data.length - 1)},${h - padY} L${padX},${h - padY} Z`;

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const vx = ((e.clientX - box.left) / box.width) * w;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round((vx - padX) / step))));
  }

  const p = hover !== null ? data[hover] : null;
  const growth = p ? p.total_value_eur - p.invested_eur : 0;
  const tipLeft = hover !== null ? (x(hover) / w) * 100 : 0;

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
        <Skeleton h={180} />
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            width="100%"
            viewBox={`0 0 ${w} ${h}`}
            className="block touch-pan-y cursor-crosshair"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="ptfArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={WORTH} stopOpacity="0.35" />
                <stop offset="100%" stopColor={WORTH} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#ptfArea)" />
            {hasInv && <path d={pathFor(invs)} fill="none" stroke={MONEY_IN} strokeWidth="1.5" strokeDasharray="4 3" />}
            <path d={pathFor(values)} fill="none" stroke={WORTH} strokeWidth="2" />
            {p && hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={padY} y2={h - padY} stroke="#A1A1AA" strokeWidth="1" />
                {hasInv && <circle cx={x(hover)} cy={y(p.invested_eur)} r="4" fill={MONEY_IN} stroke="#0D0D0F" strokeWidth="2" />}
                <circle cx={x(hover)} cy={y(p.total_value_eur)} r="4.5" fill={WORTH} stroke="#0D0D0F" strokeWidth="2" />
              </g>
            )}
          </svg>
          {p && (
            <div
              className="absolute top-0 pointer-events-none bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 shadow-lg text-xs tabular-nums whitespace-nowrap"
              style={{
                left: `${tipLeft}%`,
                transform: tipLeft > 60 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
              }}
            >
              <p className="text-[#A1A1AA] mb-1">{format(parseISO(p.date), "d MMM yyyy")}</p>
              <p className="text-[#FAFAFA]">
                <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: WORTH }} />
                Worth {fmtAmount(p.total_value_eur)}
              </p>
              {hasInv && (
                <>
                  <p className="text-[#D4D4D8]">
                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: MONEY_IN }} />
                    Money in {fmtAmount(p.invested_eur)}
                  </p>
                  <p className={growth >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}>
                    Growth {growth >= 0 ? "+" : "−"}{fmtAmount(growth)}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-[10px] text-[#71717A] mt-2 px-2">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ background: WORTH }} />Worth</span>
          {hasInv && (
            <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed" style={{ borderColor: MONEY_IN }} />Money in</span>
          )}
        </span>
        {/* Actual window covered — with young portfolios every range shows the
            same span until enough daily snapshots accumulate */}
        <span className="tabular-nums text-[#52525B]">
          {format(parseISO(data[0].date), "d MMM yy")} → {format(parseISO(data[data.length - 1].date), "d MMM yy")}
        </span>
      </div>
    </div>
  );
}
