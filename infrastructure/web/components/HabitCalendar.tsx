"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ChevronDown, Flame } from "lucide-react";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Validated dark-mode categorical palette (dataviz skill reference palette).
// Assigned per-entity by a stable hash so a tag/person keeps its colour
// regardless of what else is selected.
const PALETTE = [
  "#3987e5", "#199e70", "#c98500", "#008300",
  "#9085e9", "#e66767", "#d55181", "#d95926",
];
const NEGATIVE_COLOR = "#e66767"; // red — a filled cell means a slip
const EMPTY = "#1C1C1F";

// The user started logging on this date — nothing before it, so the grid
// never renders empty cells earlier than this.
const APP_START = new Date(2026, 4, 18); // 18 May 2026 (a Monday; month is 0-indexed)

const DAY_MS = 86400000;

// Default tags/people shown when first landing on the "All" view, so the page
// doesn't dump every tag at once. Matched against normalised slug OR name, so
// they resolve regardless of exact slug. Everything else is one click away.
const DEFAULT_TAG_KEYS = new Set([
  "no_instagram", "noinstagram", "instagram", "personal", "candy",
  "cycling", "swimming", "running", "tennis",
]);
const DEFAULT_PERSON_KEYS = new Set(["alice", "milo"]);

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
function isDefaultItem(item: GridItem, keys: Set<string>): boolean {
  return keys.has(norm(item.name)) || (item.slug ? keys.has(norm(item.slug)) : false);
}

type GridItem = {
  kind: "tag" | "person";
  id: number;
  slug?: string;
  name: string;
  icon: string | null;
  category: string | null;
  color: string | null;
  is_negative: boolean;
  dates: string[];
  total_days: number;
  current_streak: number;
  longest_streak: number;
  longest_streak_end: string | null;
};

const RANGES = [
  { label: "13w", weeks: 13 },
  { label: "26w", weeks: 26 },
  { label: "1y", weeks: 53 },
];

const CATEGORY_LABEL: Record<string, string> = {
  activity: "Activity", social: "Social", work: "Work", health: "Health",
  location: "Location", emotion: "Emotion", environment: "Environment",
};
function catLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

function stableColor(item: GridItem): string {
  if (item.is_negative) return NEGATIVE_COLOR;
  if (item.color) return item.color;
  const key = `${item.kind}:${item.slug ?? item.id}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function itemKey(item: GridItem): string {
  return `${item.kind}:${item.slug ?? item.id}`;
}

/** Monday-aligned week columns from max(today-weeks, APP_START) up to today. */
function buildWeeks(weeks: number, today: Date): Date[][] {
  const start = new Date(today);
  start.setDate(start.getDate() - weeks * 7 + 1);
  if (start < APP_START) start.setTime(APP_START.getTime());
  const dow = (start.getDay() + 6) % 7; // back up to Monday
  start.setDate(start.getDate() - dow);

  const cols: Date[][] = [];
  const cur = new Date(start);
  while (cur <= today) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(cur);
      dd.setDate(dd.getDate() + d);
      col.push(dd);
    }
    cols.push(col);
    cur.setDate(cur.getDate() + 7);
  }
  return cols;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "•";
}

/** For negative tags: clean days since last slip, and longest clean gap in the window. */
function cleanMetrics(dates: string[], weeks: number, today: Date): { current: number; best: number } {
  let windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - weeks * 7 + 1);
  if (windowStart < APP_START) windowStart = new Date(APP_START);
  if (dates.length === 0) {
    const span = Math.round((today.getTime() - windowStart.getTime()) / DAY_MS) + 1;
    return { current: span, best: span };
  }
  const parsed = dates.map((d) => parseISO(d)).sort((a, b) => a.getTime() - b.getTime());
  const last = parsed[parsed.length - 1];
  const current = Math.max(0, Math.round((today.getTime() - last.getTime()) / DAY_MS));
  let best = Math.max(0, Math.round((parsed[0].getTime() - windowStart.getTime()) / DAY_MS));
  for (let i = 1; i < parsed.length; i++) {
    best = Math.max(best, Math.round((parsed[i].getTime() - parsed[i - 1].getTime()) / DAY_MS) - 1);
  }
  best = Math.max(best, current);
  return { current, best };
}

function GridCard({ item, weeks }: { item: GridItem; weeks: number }) {
  const color = stableColor(item);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cols = useMemo(() => buildWeeks(weeks, today), [weeks, today.getTime()]);
  const dateSet = useMemo(() => new Set(item.dates), [item.dates]);

  const neg = item.is_negative;
  const negM = neg ? cleanMetrics(item.dates, weeks, today) : null;
  const currentVal = negM ? negM.current : item.current_streak;
  const bestVal = negM ? negM.best : item.longest_streak;
  const isPerson = item.kind === "person";

  const monthLabels = cols.map((col, i) => {
    const first = col[0];
    if (i === 0) return format(first, "MMM");
    const prev = cols[i - 1][0];
    return first.getMonth() !== prev.getMonth() ? format(first, "MMM") : "";
  });

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 hover:border-[#3F3F46] transition-colors">
      {/* Title row */}
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {item.icon ?? (isPerson ? initial(item.name) : "🏷️")}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#FAFAFA] truncate">{item.name}</p>
            <p className="text-[11px] text-[#52525B]">
              {item.total_days} {item.total_days === 1 ? "day" : "days"}
              {item.category && <span className="text-[#3F3F46]"> · {catLabel(item.category)}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-right">
          <div>
            <div className="flex items-center justify-end gap-1">
              {!neg && currentVal > 0 && <Flame size={12} style={{ color }} />}
              <span className="text-lg font-bold tabular-nums" style={{ color: neg ? "#10B981" : color }}>
                {currentVal}
              </span>
            </div>
            <p className="text-[10px] text-[#52525B]">{neg ? "days clean" : "current"}</p>
          </div>
          <div>
            <span className="text-lg font-bold tabular-nums text-[#A1A1AA]">{bestVal}</span>
            <p className="text-[10px] text-[#52525B]">best</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
        <div className="inline-block">
          <div className="flex gap-[3px] mb-1 ml-[16px]">
            {monthLabels.map((m, i) => (
              <div key={i} className="w-[12px] text-[9px] text-[#3F3F46] whitespace-nowrap">{m}</div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex flex-col gap-[3px] mr-[3px]">
              {["", "M", "", "W", "", "F", ""].map((d, i) => (
                <div key={i} className="w-[13px] h-[12px] text-[8px] text-[#3F3F46] leading-[12px]">{d}</div>
              ))}
            </div>
            {cols.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((d) => {
                  const ds = iso(d);
                  const hidden = d > today || d < APP_START;
                  const active = dateSet.has(ds);
                  return (
                    <div
                      key={ds}
                      title={hidden ? "" : `${format(d, "EEE d MMM yyyy")}${active ? (neg ? " · logged" : " · ✓") : ""}`}
                      className="w-[12px] h-[12px] rounded-[3px]"
                      style={{
                        backgroundColor: hidden ? "transparent" : active ? color : EMPTY,
                        opacity: hidden ? 0 : 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {neg && (
        <p className="text-[10px] text-[#3F3F46] mt-2.5">Filled = a day you logged this — fewer is better.</p>
      )}
    </div>
  );
}

// ── Category / group dropdown ─────────────────────────────────────────────────

function Dropdown({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count: number }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-[#0D0D0F] border border-[#27272A] rounded-lg pl-3 pr-2 py-1.5 text-xs text-[#FAFAFA] hover:border-[#3F3F46] transition-colors"
      >
        <span className="text-[#52525B]">{label}</span>
        <span className="font-medium">{current?.label ?? "All"}</span>
        <ChevronDown size={13} className={`text-[#52525B] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 min-w-[180px] bg-[#18181B] border border-[#27272A] rounded-lg overflow-hidden shadow-xl py-1">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-4 px-3 py-2 text-xs text-left transition-colors ${
                o.value === value ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#A1A1AA] hover:bg-[#27272A]/60"
              }`}
            >
              <span>{o.label}</span>
              <span className="text-[#52525B] tabular-nums">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HabitCalendar() {
  const [mode, setMode] = useState<"tags" | "people">("tags");
  const [weeks, setWeeks] = useState(26);
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: items = [], isLoading } = useQuery<GridItem[]>({
    queryKey: ["habit-grid", mode, weeks],
    queryFn: () =>
      fetch(`${BASE_URL}/${mode === "tags" ? "tags" : "contacts"}/grid?days=${weeks * 7}`).then((r) => r.json()),
  });

  // Category / group options built from the data. Items with no category are
  // not given an "Other" bucket — they're still reachable under "All".
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      if (!it.category) continue;
      counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
    }
    const opts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: catLabel(value), count }));
    return [{ value: "all", label: "All", count: items.length }, ...opts];
  }, [items]);

  const visible = useMemo(
    () => (cat === "all" ? items : items.filter((it) => (it.category ?? "other") === cat)),
    [items, cat],
  );

  // Reset category when switching Tags/People
  useEffect(() => { setCat("all"); }, [mode]);

  // Default selection: a curated set on the "All" view, else everything in the category
  useEffect(() => {
    let base: GridItem[];
    if (cat === "all") {
      const keys = mode === "tags" ? DEFAULT_TAG_KEYS : DEFAULT_PERSON_KEYS;
      const matched = items.filter((it) => isDefaultItem(it, keys));
      base = matched.length > 0 ? matched : items.slice(0, 6);
    } else {
      base = items.filter((it) => (it.category ?? "other") === cat);
    }
    setSelected(new Set(base.map(itemKey)));
  }, [mode, cat, items]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const shown = items.filter((it) => selected.has(itemKey(it)));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1">
            {(["tags", "people"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  mode === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {options.length > 1 && (
            <Dropdown
              label={mode === "tags" ? "Category" : "Group"}
              value={cat}
              options={options}
              onChange={setCat}
            />
          )}
        </div>
        <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.weeks}
              onClick={() => setWeeks(r.weeks)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                weeks === r.weeks ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 bg-[#18181B] rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-12 text-center">
          <p className="text-sm text-[#71717A]">
            {mode === "tags" ? "No tags logged yet." : "No people logged yet."}
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <>
          {/* Chips within the chosen category */}
          {visible.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {visible.map((it) => {
                const key = itemKey(it);
                const on = selected.has(key);
                const color = stableColor(it);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                      on ? "text-[#FAFAFA]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                    }`}
                    style={on ? { borderColor: color, backgroundColor: `${color}1f` } : {}}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? color : "#3F3F46" }} />
                    {it.icon && <span>{it.icon}</span>}
                    {it.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Grid cards */}
          <div className="space-y-3">
            {shown.map((it) => (
              <GridCard key={itemKey(it)} item={it} weeks={weeks} />
            ))}
            {shown.length === 0 && (
              <p className="text-xs text-[#52525B] text-center py-6">
                Pick a {mode === "tags" ? "tag" : "person"} above to see its calendar.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
