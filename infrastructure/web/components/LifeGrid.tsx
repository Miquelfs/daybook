"use client";

import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { type LifeWeekCell, type LifeGridResponse, type LifePeriod } from "@/lib/api";

// ── Grid geometry ─────────────────────────────────────────────────────────────
const CELL_W  = 11;
const CELL_H  = 11;
const GAP     = 1;
const COLS    = 52;
const ROWS    = 90;
const LABEL_W = 28;
const HEADER_H = 18;

const TOTAL_W = LABEL_W + COLS * (CELL_W + GAP) - GAP;
const TOTAL_H = HEADER_H + ROWS * (CELL_H + GAP) - GAP;

// Reserved strips: relationship = top 10%, location = bottom 10%.
// Middle 80% split equally among all other categories.
const STRIP_H     = Math.round(CELL_H * 0.10);   // 1px at CELL_H=9
const CONTENT_H   = CELL_H - STRIP_H * 2;         // 7px middle
const LOCATION_CAT     = "location";
const RELATIONSHIP_CAT = "relationship";

// Gold is reserved for "today" — never use it for period fills.
const TODAY_COLOR  = "#F59E0B";
const PAST_COLOR   = "#27272A";
const FUTURE_COLOR = "#18181B";

// ── Colour resolution ─────────────────────────────────────────────────────────
const TAILWIND_HEX: Record<string, string> = {
  "slate-400":"#94a3b8","slate-500":"#64748b","slate-600":"#475569",
  "zinc-400":"#a1a1aa","zinc-500":"#71717a","zinc-600":"#52525b",
  "red-400":"#f87171","red-500":"#ef4444","red-600":"#dc2626",
  "orange-400":"#fb923c","orange-500":"#f97316",
  "amber-400":"#fbbf24","amber-500":"#f59e0b",
  "yellow-300":"#fde047","yellow-400":"#facc15",
  "lime-400":"#a3e635","lime-500":"#84cc16",
  "green-400":"#4ade80","green-500":"#22c55e","green-600":"#16a34a",
  "emerald-400":"#34d399","emerald-500":"#10b981","emerald-600":"#059669",
  "teal-400":"#2dd4bf","teal-500":"#14b8a6",
  "cyan-400":"#22d3ee","cyan-500":"#06b6d4",
  "sky-300":"#7dd3fc","sky-400":"#38bdf8","sky-500":"#0ea5e9","sky-600":"#0284c7",
  "blue-300":"#93c5fd","blue-400":"#60a5fa","blue-500":"#3b82f6","blue-600":"#2563eb",
  "indigo-400":"#818cf8","indigo-500":"#6366f1",
  "violet-400":"#a78bfa","violet-500":"#8b5cf6",
  "purple-400":"#c084fc","purple-500":"#a855f7",
  "fuchsia-400":"#e879f9","fuchsia-500":"#d946ef",
  "pink-400":"#f472b6","pink-500":"#ec4899",
  "rose-400":"#fb7185","rose-500":"#f43f5e","rose-600":"#e11d48",
};

export function colorHex(c: string | null | undefined): string {
  if (!c) return "#3f3f46";
  if (c.startsWith("#")) return c;
  return TAILWIND_HEX[c] ?? "#6b7280";
}

export const LIFE_PALETTE = TAILWIND_HEX;

function cellX(col: number) { return LABEL_W + (col - 1) * (CELL_W + GAP); }
function cellY(row: number) { return HEADER_H + row * (CELL_H + GAP); }

// ── Cell slice builder ────────────────────────────────────────────────────────
// Layout (top → bottom, CELL_H = 9px):
//   [0]   top 1px  → relationship strip (if active)
//   [1-7] mid 7px  → other categories split equally
//   [8]   bot 1px  → location strip (if active)
//
// Strip categories never expand into the middle even when alone.
function buildSlices(
  periods: LifePeriod[],
  x: number,
  y: number,
  visibleCategories: Set<string> | undefined,
): { fill: string; sy: number; sh: number }[] {
  const visible = !visibleCategories || visibleCategories.size === 0
    ? periods
    : periods.filter((p) => visibleCategories.has(p.category));

  const relPeriod  = visible.find((p) => p.category === RELATIONSHIP_CAT);
  const locPeriod  = visible.find((p) => p.category === LOCATION_CAT);
  const midPeriods = visible.filter(
    (p) => p.category !== LOCATION_CAT && p.category !== RELATIONSHIP_CAT
  );

  if (!relPeriod && !locPeriod && midPeriods.length === 0) return [];

  const slices: { fill: string; sy: number; sh: number }[] = [];

  // Top strip: relationship
  if (relPeriod) {
    slices.push({ fill: colorHex(relPeriod.color), sy: y, sh: STRIP_H });
  }

  // Middle: other categories
  if (midPeriods.length > 0) {
    const midTop = y + STRIP_H;
    const sliceH = CONTENT_H / midPeriods.length;
    midPeriods.forEach((p, i) => {
      slices.push({ fill: colorHex(p.color), sy: midTop + i * sliceH, sh: sliceH });
    });
  }

  // Bottom strip: location
  if (locPeriod) {
    slices.push({ fill: colorHex(locPeriod.color), sy: y + CELL_H - STRIP_H, sh: STRIP_H });
  }

  return slices;
}

// ── Late-year fill: cols 51–52 inherit from the nearest non-empty prior week ─
// Birthday-anchored years can have sparse final weeks when the period's end_date
// falls a few days before the cell's week_start. Walk back up to col 48.
function fillWeek52(cells: LifeWeekCell[]): LifeWeekCell[] {
  const byKey = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  return cells.map((c) => {
    if (c.col < 51) return c;
    if (c.periods.length > 0) return c;
    for (let col = c.col - 1; col >= 48; col--) {
      const prev = byKey.get(`${c.row}:${col}`);
      if (prev && prev.periods.length > 0) return { ...c, periods: prev.periods };
    }
    return c;
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TooltipState {
  x: number;
  y: number;
  cell: LifeWeekCell;
}

export interface LifeGridProps {
  data: LifeGridResponse;
  visibleCategories?: Set<string>;
  eventsOnly?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function LifeGrid({ data, visibleCategories, eventsOnly }: LifeGridProps) {
  const router  = useRouter();
  const svgRef  = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const decades = [0, 10, 20, 30, 40, 50, 60, 70, 80];
  const cells   = fillWeek52(data.cells);

  function handleMouseEnter(e: React.MouseEvent, cell: LifeWeekCell) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, cell });
  }

  // When clicking a cell that has events, navigate to the first event's date
  // so you land exactly on the right day instead of the week start.
  function handleCellClick(cell: LifeWeekCell) {
    if (cell.events.length > 0) {
      router.push(`/day/${cell.events[0].event_date}`);
    } else {
      router.push(`/day/${cell.week_start}`);
    }
  }

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
        width="100%"
        style={{ maxWidth: TOTAL_W, display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Decade labels */}
        {decades.map((d) => (
          <text key={d} x={LABEL_W - 4} y={cellY(d) + CELL_H / 2 + 4}
            textAnchor="end" fontSize={6} fill="#52525B">{d}</text>
        ))}

        {/* Week column headers */}
        {[1, 13, 26, 39, 52].map((w) => (
          <text key={w} x={cellX(w) + CELL_W / 2} y={HEADER_H - 5}
            textAnchor="middle" fontSize={5} fill="#3F3F46">{w}</text>
        ))}

        {/* Cells */}
        {cells.map((cell) => {
          const x = cellX(cell.col);
          const y = cellY(cell.row);

          const hasEvents = cell.events.length > 0;

          // eventsOnly: dim cells without events
          if (eventsOnly && !hasEvents) {
            return (
              <rect key={`${cell.row}:${cell.col}`}
                x={x} y={y} width={CELL_W} height={CELL_H}
                fill={cell.is_past ? PAST_COLOR : FUTURE_COLOR}
                opacity={0.3} rx={1}
                className="cursor-pointer"
                onMouseEnter={(e) => handleMouseEnter(e, cell)}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => handleCellClick(cell)}
              />
            );
          }

          const slices = buildSlices(cell.periods, x, y, visibleCategories);
          const hasMiddleSlice = slices.some((s) => s.sy > y && s.sy < y + CELL_H - STRIP_H);
          const hasFill = slices.length > 0;

          const baseColor = cell.is_current ? TODAY_COLOR
            : hasMiddleSlice ? "#09090B"
            : cell.is_past ? PAST_COLOR
            : FUTURE_COLOR;

          return (
            <g key={`${cell.row}:${cell.col}`}>
              <rect
                x={x} y={y} width={CELL_W} height={CELL_H}
                fill={baseColor}
                opacity={!cell.is_past && !cell.is_current && !hasFill ? 0.55 : 1}
                rx={1}
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onMouseEnter={(e) => handleMouseEnter(e, cell)}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => handleCellClick(cell)}
              />

              {/* Period slices */}
              {!cell.is_current && slices.map((s, i) => (
                <rect key={i}
                  x={x} y={s.sy} width={CELL_W} height={s.sh}
                  fill={s.fill}
                  rx={0}
                  style={{ pointerEvents: "none" }}
                />
              ))}

              {/* Event dot — centered, larger */}
              {hasEvents && (
                <circle
                  cx={x + CELL_W / 2} cy={y + CELL_H / 2} r={2}
                  fill="#FFFFFF"
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 max-w-[230px] rounded-lg border border-[#27272A] bg-[#09090B]/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(tooltip.x + 14, TOTAL_W - 240),
            top: tooltip.y + 12,
          }}
        >
          <p className="font-medium text-[#FAFAFA]">
            Age {tooltip.cell.row}, week {tooltip.cell.col}
          </p>
          <p className="text-[#52525B] mb-1.5">
            {tooltip.cell.week_start} → {tooltip.cell.week_end}
          </p>

          {tooltip.cell.periods.length === 0 && (
            <p className="text-[#3F3F46] italic">No periods</p>
          )}
          {tooltip.cell.periods.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
                style={{ background: colorHex(p.color) }} />
              <span className="text-[#A1A1AA] truncate">{p.label}</span>
              <span className="text-[#3F3F46] ml-auto flex-shrink-0">{p.category}</span>
            </div>
          ))}

          {tooltip.cell.events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-1.5 mt-1 pt-1 border-t border-[#18181B]">
              <span className="text-white">·</span>
              <span className="text-white truncate">{ev.label}</span>
            </div>
          ))}

          {tooltip.cell.is_current && (
            <p className="mt-1.5 text-[#F59E0B] font-medium">← you are here</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Legend / filter ───────────────────────────────────────────────────────────

interface LegendProps {
  periods: LifePeriod[];
  visibleCategories: Set<string>;
  eventsOnly: boolean;
  onToggleCategory: (cat: string) => void;
  onToggleEventsOnly: () => void;
}

export function LifeLegend({
  periods, visibleCategories, eventsOnly,
  onToggleCategory, onToggleEventsOnly,
}: LegendProps) {
  const cats = Array.from(new Map(periods.map((p) => [p.category, p])).values());

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {cats.map((p) => {
        const active = visibleCategories.size === 0 || visibleCategories.has(p.category);
        return (
          <button
            key={p.category}
            onClick={() => onToggleCategory(p.category)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
              active
                ? "border-[#27272A] text-[#A1A1AA]"
                : "border-[#18181B] text-[#3F3F46] opacity-40"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
              style={{ background: colorHex(p.color) }} />
            {p.category}
          </button>
        );
      })}

      <button
        onClick={onToggleEventsOnly}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
          eventsOnly
            ? "border-white/30 text-white bg-white/5"
            : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
        }`}
      >
        <span className="inline-block h-2 w-2 rounded-full bg-white flex-shrink-0" />
        Events
      </button>
    </div>
  );
}
