"use client";

import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { LIFE_PALETTE, type LifeWeekCell, type LifeGridResponse, type LifePeriod } from "@/lib/api";

// ── Geometry ──────────────────────────────────────────────────────────────────
// Cells are short and wide — optimised for horizontal reading on mobile.
const CELL_W  = 9;
const CELL_H  = 5;   // shorter than the single-grid version
const GAP     = 1;
const COLS    = 52;
const LABEL_W = 44;  // left margin for category label
const HEADER_H = 14; // top margin for column markers (shared, rendered once)

const BAND_GAP    = 6;  // vertical gap between category bands
const ROW_COUNT   = 90;

const GRID_W = LABEL_W + COLS * (CELL_W + GAP) - GAP;

// Width of one full grid row in SVG units
function cellX(col: number) {
  return LABEL_W + (col - 1) * (CELL_W + GAP);
}

function colorHex(name: string | null | undefined): string {
  if (!name) return "";
  return LIFE_PALETTE[name] ?? "#6b7280";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TooltipState {
  // position relative to the outer container (px)
  x: number;
  y: number;
  cell: LifeWeekCell;
  categoryLabel: string;
  activePeriods: LifePeriod[];
}

interface Props {
  data: LifeGridResponse;
  /** All periods from /life/periods — used to determine which categories exist */
  periods: LifePeriod[];
}

// The ordered category rows we want to show (only rows that have at least one period are rendered)
const CATEGORY_ORDER = [
  "education",
  "work",
  "aviation",
  "location",
  "relationship",
  "health",
  "other",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  education:    "Education",
  work:         "Work",
  aviation:     "Aviation",
  location:     "Location",
  relationship: "Relationship",
  health:       "Health",
  other:        "Other",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function LifeGridByCategory({ data, periods }: Props) {
  const router   = useRouter();
  const wrapRef  = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Which categories have at least one period?
  const usedCategories = CATEGORY_ORDER.filter((cat) =>
    periods.some((p) => p.category === cat)
  );
  // Always show at least one band so the grid isn't blank on first load
  const categories = usedCategories.length > 0 ? usedCategories : ["work" as const];

  // Pre-index: for each category, build a map (row,col) → LifePeriod[]
  // Multiple periods of the same category can overlap a single cell (different layers/labels).
  const categoryPeriodMap: Record<string, Map<string, LifePeriod[]>> = {};
  for (const cat of categories) {
    const m = new Map<string, LifePeriod[]>();
    categoryPeriodMap[cat] = m;
  }
  for (const p of periods) {
    const m = categoryPeriodMap[p.category];
    if (!m) continue;
    // Find all cells this period covers by scanning the grid cells
    // (cheaper than date arithmetic: the grid is already computed)
  }

  // Build cell lookup once
  const cellByKey = new Map<string, LifeWeekCell>();
  for (const c of data.cells) cellByKey.set(`${c.row}:${c.col}`, c);

  // For each period, walk its cells and register it in the category map
  for (const p of periods) {
    const m = categoryPeriodMap[p.category];
    if (!m) continue;
    for (const c of data.cells) {
      const inRange =
        c.week_start >= p.start_date &&
        (!p.end_date || c.week_start <= p.end_date);
      if (!inRange) continue;
      const key = `${c.row}:${c.col}`;
      const existing = m.get(key) ?? [];
      existing.push(p);
      m.set(key, existing);
    }
  }

  // Build event lookup: (row,col) → events
  const eventMap = new Map<string, typeof data.cells[0]["events"]>();
  for (const c of data.cells) {
    if (c.events.length > 0) eventMap.set(`${c.row}:${c.col}`, c.events);
  }

  // Height of one category band (90 rows × cell+gap)
  const bandH = ROW_COUNT * (CELL_H + GAP) - GAP;

  // Total SVG height: header + one band per category + gaps between them
  const totalH = HEADER_H + categories.length * bandH + (categories.length - 1) * BAND_GAP;

  // Y-offset of the top of a given band index
  function bandY(bandIdx: number) {
    return HEADER_H + bandIdx * (bandH + BAND_GAP);
  }

  // Y of a cell within its band
  function cellYInBand(row: number) {
    return row * (CELL_H + GAP);
  }

  function handleMouseEnter(
    e: React.MouseEvent,
    cell: LifeWeekCell,
    cat: string,
    activePeriods: LifePeriod[],
  ) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      cell,
      categoryLabel: CATEGORY_LABELS[cat] ?? cat,
      activePeriods,
    });
  }

  // Decade markers — which rows to label
  const decadeMarkers = [0, 10, 20, 30, 40, 50, 60, 70, 80];

  return (
    <div ref={wrapRef} className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${GRID_W} ${totalH}`}
        width="100%"
        style={{ maxWidth: GRID_W, display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* ── Shared column header (week numbers) ── */}
        {[1, 13, 26, 39, 52].map((w) => (
          <text
            key={w}
            x={cellX(w) + CELL_W / 2}
            y={HEADER_H - 4}
            textAnchor="middle"
            fontSize={5}
            fill="#3F3F46"
          >
            {w}
          </text>
        ))}

        {/* ── One band per category ── */}
        {categories.map((cat, bandIdx) => {
          const periodMap = categoryPeriodMap[cat];
          const by = bandY(bandIdx);

          return (
            <g key={cat}>
              {/* Category label (vertical, left of the band) */}
              <text
                x={LABEL_W - 4}
                y={by + bandH / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={5.5}
                fill="#52525B"
                style={{ userSelect: "none" }}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </text>

              {/* Decade age markers — only on the first band to avoid repetition */}
              {bandIdx === 0 &&
                decadeMarkers.map((decade) => (
                  <text
                    key={decade}
                    x={LABEL_W - 4}
                    y={by + cellYInBand(decade) + CELL_H / 2 + 1.5}
                    textAnchor="end"
                    fontSize={4.5}
                    fill="#3F3F46"
                  >
                    {decade}
                  </text>
                ))}

              {/* Cells */}
              {data.cells.map((cell) => {
                const key  = `${cell.row}:${cell.col}`;
                const cx   = cellX(cell.col);
                const cy   = by + cellYInBand(cell.row);
                const hits = periodMap.get(key) ?? [];
                const hasHit = hits.length > 0;
                const events = eventMap.get(key) ?? [];

                // Pick fill: first period's colour, or past/future default
                const fill = cell.is_current
                  ? "#F59E0B"
                  : hasHit
                  ? colorHex(hits[0].color)
                  : cell.is_past
                  ? "#1E1E21"
                  : "#131315";

                const opacity = !cell.is_past && !cell.is_current && !hasHit ? 0.5 : 1;

                // If multiple periods share this cell (rare: two periods of same category),
                // render a thin right-edge stripe in the second colour
                const secondHex = hits.length > 1 ? colorHex(hits[1].color) : null;

                return (
                  <g key={key}>
                    <rect
                      x={cx}
                      y={cy}
                      width={CELL_W}
                      height={CELL_H}
                      fill={fill}
                      opacity={opacity}
                      rx={0.5}
                      className="cursor-pointer"
                      onMouseEnter={(e) => handleMouseEnter(e, cell, cat, hits)}
                      onMouseLeave={() => setTooltip(null)}
                      onClick={() => router.push(`/day/${cell.week_start}`)}
                    />

                    {/* Second-period stripe (right edge, 2px wide) */}
                    {secondHex && (
                      <rect
                        x={cx + CELL_W - 2}
                        y={cy}
                        width={2}
                        height={CELL_H}
                        fill={secondHex}
                        rx={0.5}
                        style={{ pointerEvents: "none" }}
                      />
                    )}

                    {/* Event dot on the top-right */}
                    {events.length > 0 && (
                      <circle
                        cx={cx + CELL_W - 1.5}
                        cy={cy + 1.5}
                        r={1}
                        fill="#FAFAFA"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                );
              })}

              {/* Thin separator line below each band (except last) */}
              {bandIdx < categories.length - 1 && (
                <line
                  x1={LABEL_W}
                  y1={by + bandH + BAND_GAP / 2}
                  x2={GRID_W}
                  y2={by + bandH + BAND_GAP / 2}
                  stroke="#1E1E21"
                  strokeWidth={0.5}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 max-w-[240px] rounded-lg border border-[#27272A] bg-[#09090B]/95 px-3 py-2 text-xs shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(tooltip.x + 14, GRID_W - 250),
            top: tooltip.y + 10,
          }}
        >
          <p className="font-medium text-[#FAFAFA]">
            Age {tooltip.cell.row}, week {tooltip.cell.col}
          </p>
          <p className="text-[#52525B] mb-1">
            {tooltip.cell.week_start} → {tooltip.cell.week_end}
          </p>

          {tooltip.activePeriods.length === 0 && (
            <p className="text-[#3F3F46] italic">No {tooltip.categoryLabel.toLowerCase()} period</p>
          )}

          {tooltip.activePeriods.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 mt-0.5">
              <span
                className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
                style={{ background: colorHex(p.color) }}
              />
              <span className="text-[#A1A1AA] truncate">{p.label}</span>
            </div>
          ))}

          {tooltip.cell.events.map((ev) => (
            <div key={ev.id} className="flex items-center gap-1.5 mt-1">
              <span className="text-white">·</span>
              <span className="text-white truncate">{ev.label}</span>
            </div>
          ))}

          {tooltip.cell.is_current && (
            <p className="mt-1 text-[#F59E0B] font-medium">← you are here</p>
          )}
        </div>
      )}
    </div>
  );
}
