"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { Activity, Moon, Dumbbell, Flame, AlertTriangle } from "lucide-react";
import {
  injuriesApi,
  type Injury,
  type InjuryCreate,
  type InjuryPatch,
  type ActiveSummaryItem,
  type InjuryStatus,
  type InjurySide,
  ZONE_LABELS,
} from "@/lib/injuries-api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Zone definitions ──────────────────────────────────────────────────────────

type ZoneDef = {
  slug: string;
  side: InjurySide;
  view: "front" | "back";
  shape: "rect" | "ellipse";
  // rect: x, y, w, h  |  ellipse: cx, cy, rx, ry
  coords: [number, number, number, number];
  // center point for bubble overlay
  cx: number;
  cy: number;
};

// ViewBox is 100 × 240 per side
const ZONES: ZoneDef[] = [
  // ── FRONT ────────────────────────────────────────────
  // head/neck area
  { slug: "neck",       side: null,    view: "front", shape: "ellipse", coords: [50, 28, 8, 6],   cx: 50, cy: 28 },
  // shoulders
  { slug: "shoulder",   side: "left",  view: "front", shape: "ellipse", coords: [31, 58, 11, 9],  cx: 31, cy: 58 },
  { slug: "shoulder",   side: "right", view: "front", shape: "ellipse", coords: [69, 58, 11, 9],  cx: 69, cy: 58 },
  // chest
  { slug: "chest",      side: null,    view: "front", shape: "rect",    coords: [38, 62, 24, 18], cx: 50, cy: 71 },
  // elbows
  { slug: "elbow",      side: "left",  view: "front", shape: "ellipse", coords: [18, 97, 8, 7],   cx: 18, cy: 97 },
  { slug: "elbow",      side: "right", view: "front", shape: "ellipse", coords: [82, 97, 8, 7],   cx: 82, cy: 97 },
  // wrists
  { slug: "wrist",      side: "left",  view: "front", shape: "ellipse", coords: [12, 120, 7, 6],  cx: 12, cy: 120 },
  { slug: "wrist",      side: "right", view: "front", shape: "ellipse", coords: [88, 120, 7, 6],  cx: 88, cy: 120 },
  // hip flexor
  { slug: "hip_flexor", side: "left",  view: "front", shape: "rect",    coords: [32, 118, 16, 14], cx: 40, cy: 125 },
  { slug: "hip_flexor", side: "right", view: "front", shape: "rect",    coords: [52, 118, 16, 14], cx: 60, cy: 125 },
  // groin
  { slug: "groin",      side: null,    view: "front", shape: "rect",    coords: [40, 132, 20, 12], cx: 50, cy: 138 },
  // quads
  { slug: "quad",       side: "left",  view: "front", shape: "rect",    coords: [31, 144, 18, 36], cx: 40, cy: 162 },
  { slug: "quad",       side: "right", view: "front", shape: "rect",    coords: [51, 144, 18, 36], cx: 60, cy: 162 },
  // knees
  { slug: "knee",       side: "left",  view: "front", shape: "ellipse", coords: [40, 182, 11, 9],  cx: 40, cy: 182 },
  { slug: "knee",       side: "right", view: "front", shape: "ellipse", coords: [60, 182, 11, 9],  cx: 60, cy: 182 },
  // shins
  { slug: "shin",       side: "left",  view: "front", shape: "rect",    coords: [33, 192, 13, 28], cx: 39, cy: 206 },
  { slug: "shin",       side: "right", view: "front", shape: "rect",    coords: [54, 192, 13, 28], cx: 60, cy: 206 },
  // ankles
  { slug: "ankle",      side: "left",  view: "front", shape: "ellipse", coords: [39, 222, 10, 7],  cx: 39, cy: 222 },
  { slug: "ankle",      side: "right", view: "front", shape: "ellipse", coords: [61, 222, 10, 7],  cx: 61, cy: 222 },
  // feet
  { slug: "foot",       side: "left",  view: "front", shape: "rect",    coords: [30, 228, 20, 10], cx: 40, cy: 233 },
  { slug: "foot",       side: "right", view: "front", shape: "rect",    coords: [50, 228, 20, 10], cx: 60, cy: 233 },

  // ── BACK ─────────────────────────────────────────────
  { slug: "neck",       side: null,    view: "back", shape: "ellipse", coords: [50, 28, 8, 6],   cx: 50, cy: 28 },
  { slug: "upper_back", side: null,    view: "back", shape: "rect",    coords: [36, 60, 28, 22], cx: 50, cy: 71 },
  { slug: "shoulder",   side: "left",  view: "back", shape: "ellipse", coords: [27, 62, 10, 9],  cx: 27, cy: 62 },
  { slug: "shoulder",   side: "right", view: "back", shape: "ellipse", coords: [73, 62, 10, 9],  cx: 73, cy: 62 },
  { slug: "lower_back", side: null,    view: "back", shape: "rect",    coords: [37, 82, 26, 20], cx: 50, cy: 92 },
  { slug: "glute",      side: "left",  view: "back", shape: "ellipse", coords: [38, 104, 14, 13], cx: 38, cy: 104 },
  { slug: "glute",      side: "right", view: "back", shape: "ellipse", coords: [62, 104, 14, 13], cx: 62, cy: 104 },
  { slug: "hip",        side: "left",  view: "back", shape: "ellipse", coords: [28, 110, 10, 9],  cx: 28, cy: 110 },
  { slug: "hip",        side: "right", view: "back", shape: "ellipse", coords: [72, 110, 10, 9],  cx: 72, cy: 110 },
  { slug: "hamstring",  side: "left",  view: "back", shape: "rect",    coords: [31, 118, 17, 38], cx: 39, cy: 137 },
  { slug: "hamstring",  side: "right", view: "back", shape: "rect",    coords: [52, 118, 17, 38], cx: 61, cy: 137 },
  { slug: "it_band",    side: "left",  view: "back", shape: "rect",    coords: [26, 130, 8, 40],  cx: 30, cy: 150 },
  { slug: "it_band",    side: "right", view: "back", shape: "rect",    coords: [66, 130, 8, 40],  cx: 70, cy: 150 },
  { slug: "calf",       side: "left",  view: "back", shape: "rect",    coords: [33, 158, 14, 34], cx: 40, cy: 175 },
  { slug: "calf",       side: "right", view: "back", shape: "rect",    coords: [53, 158, 14, 34], cx: 60, cy: 175 },
  { slug: "achilles",   side: "left",  view: "back", shape: "ellipse", coords: [38, 194, 8, 10],  cx: 38, cy: 194 },
  { slug: "achilles",   side: "right", view: "back", shape: "ellipse", coords: [62, 194, 8, 10],  cx: 62, cy: 194 },
];

// ── Colors ────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<InjuryStatus, string> = {
  active: "#F97316",
  recovering: "#EAB308",
  resolved: "#22C55E",
};

const STATUS_BG: Record<InjuryStatus, string> = {
  active: "bg-orange-500/20 text-orange-400",
  recovering: "bg-yellow-500/20 text-yellow-400",
  resolved: "bg-emerald-500/20 text-emerald-400",
};

// ── Body SVG ──────────────────────────────────────────────────────────────────

function BodySilhouetteFront() {
  return (
    <>
      {/* Head */}
      <ellipse cx="50" cy="18" rx="12" ry="14" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Neck */}
      <rect x="44" y="30" width="12" height="8" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Torso — wider at shoulders, tapers at waist */}
      <path d="M32,38 Q30,55 33,88 L67,88 Q70,55 68,38 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Collarbone lines */}
      <line x1="44" y1="40" x2="32" y2="44" stroke="#4F4F5A" strokeWidth="0.6" />
      <line x1="56" y1="40" x2="68" y2="44" stroke="#4F4F5A" strokeWidth="0.6" />
      {/* Centre chest line */}
      <line x1="50" y1="42" x2="50" y2="86" stroke="#3A3A42" strokeWidth="0.5" strokeDasharray="1.5,2" />
      {/* Abs lines (3 horizontal) */}
      <line x1="40" y1="62" x2="60" y2="62" stroke="#3A3A42" strokeWidth="0.5" />
      <line x1="39" y1="72" x2="61" y2="72" stroke="#3A3A42" strokeWidth="0.5" />
      <line x1="40" y1="82" x2="60" y2="82" stroke="#3A3A42" strokeWidth="0.5" />
      {/* Upper arms */}
      <rect x="17" y="42" width="13" height="40" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="70" y="42" width="13" height="40" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Forearms */}
      <rect x="11" y="84" width="11" height="36" rx="4" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="78" y="84" width="11" height="36" rx="4" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Hands */}
      <ellipse cx="16" cy="127" rx="7" ry="9" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <ellipse cx="84" cy="127" rx="7" ry="9" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Pelvis */}
      <path d="M33,88 Q28,102 33,108 L67,108 Q72,102 67,88 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Upper legs */}
      <rect x="33" y="108" width="16" height="56" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="51" y="108" width="16" height="56" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Kneecap bumps */}
      <ellipse cx="41" cy="164" rx="7" ry="5" fill="#313138" stroke="#3F3F46" strokeWidth="0.6" />
      <ellipse cx="59" cy="164" rx="7" ry="5" fill="#313138" stroke="#3F3F46" strokeWidth="0.6" />
      {/* Lower legs — slightly tapered */}
      <path d="M34,166 Q32,190 35,218 L47,218 Q46,190 48,166 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <path d="M52,166 Q54,190 53,218 L65,218 Q68,190 66,166 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Feet — pointing forward */}
      <ellipse cx="41" cy="220" rx="12" ry="6" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <ellipse cx="59" cy="220" rx="12" ry="6" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
    </>
  );
}

function BodySilhouetteBack() {
  return (
    <>
      {/* Head — back of head, slightly rounder */}
      <ellipse cx="50" cy="18" rx="13" ry="14" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Hair / back of head detail */}
      <ellipse cx="50" cy="12" rx="10" ry="8" fill="#252529" stroke="#3A3A42" strokeWidth="0.5" />
      {/* Neck */}
      <rect x="44" y="30" width="12" height="8" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Trapezius / upper back — wider trapezoid */}
      <path d="M30,38 Q28,55 33,88 L67,88 Q72,55 70,38 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Spine line */}
      <line x1="50" y1="38" x2="50" y2="108" stroke="#4A4A54" strokeWidth="0.7" />
      {/* Spine vertebrae dots */}
      <circle cx="50" cy="45" r="1" fill="#4A4A54" />
      <circle cx="50" cy="52" r="1" fill="#4A4A54" />
      <circle cx="50" cy="59" r="1" fill="#4A4A54" />
      <circle cx="50" cy="66" r="1" fill="#4A4A54" />
      <circle cx="50" cy="73" r="1" fill="#4A4A54" />
      <circle cx="50" cy="80" r="1" fill="#4A4A54" />
      {/* Shoulder blade left */}
      <path d="M33,50 Q30,60 34,70 Q40,68 42,56 Z" fill="#313138" stroke="#4A4A54" strokeWidth="0.5" />
      {/* Shoulder blade right */}
      <path d="M67,50 Q70,60 66,70 Q60,68 58,56 Z" fill="#313138" stroke="#4A4A54" strokeWidth="0.5" />
      {/* Upper arms */}
      <rect x="17" y="42" width="13" height="40" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="70" y="42" width="13" height="40" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Forearms */}
      <rect x="11" y="84" width="11" height="36" rx="4" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="78" y="84" width="11" height="36" rx="4" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Hands — back of hands */}
      <ellipse cx="16" cy="127" rx="7" ry="9" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <ellipse cx="84" cy="127" rx="7" ry="9" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Knuckle lines on hands */}
      <line x1="11" y1="121" x2="21" y2="121" stroke="#3A3A42" strokeWidth="0.4" />
      <line x1="11" y1="125" x2="21" y2="125" stroke="#3A3A42" strokeWidth="0.4" />
      <line x1="79" y1="121" x2="89" y2="121" stroke="#3A3A42" strokeWidth="0.4" />
      <line x1="79" y1="125" x2="89" y2="125" stroke="#3A3A42" strokeWidth="0.4" />
      {/* Lower back / glutes */}
      <path d="M33,88 Q27,104 33,114 L67,114 Q73,104 67,88 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Glute crease */}
      <path d="M33,108 Q50,112 67,108" stroke="#3A3A42" strokeWidth="0.6" fill="none" />
      {/* Upper legs — hamstrings, slightly fuller */}
      <rect x="33" y="114" width="16" height="52" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <rect x="51" y="114" width="16" height="52" rx="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Back of knee crease */}
      <path d="M33,166 Q41,170 49,166" stroke="#3A3A42" strokeWidth="0.6" fill="none" />
      <path d="M51,166 Q59,170 67,166" stroke="#3A3A42" strokeWidth="0.6" fill="none" />
      {/* Lower legs — calves, more defined bulge */}
      <path d="M33,168 Q29,184 33,218 L47,218 Q48,184 49,168 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <path d="M51,168 Q52,184 53,218 L67,218 Q71,184 71,168 Z" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      {/* Calf muscle highlight */}
      <ellipse cx="40" cy="183" rx="5" ry="9" fill="#303037" stroke="none" />
      <ellipse cx="60" cy="183" rx="5" ry="9" fill="#303037" stroke="none" />
      {/* Achilles / heel */}
      <rect x="35" y="212" width="11" height="8" rx="2" fill="#313138" stroke="#3F3F46" strokeWidth="0.6" />
      <rect x="54" y="212" width="11" height="8" rx="2" fill="#313138" stroke="#3F3F46" strokeWidth="0.6" />
      {/* Feet — pointing outward slightly at back */}
      <ellipse cx="41" cy="221" rx="11" ry="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
      <ellipse cx="60" cy="221" rx="11" ry="5" fill="#2A2A2F" stroke="#3F3F46" strokeWidth="0.8" />
    </>
  );
}

type Selected = { zone: string; side: InjurySide };

function BodyDiagram({
  view,
  activeItems,
  onZoneClick,
  selectedZone,
}: {
  view: "front" | "back";
  activeItems: ActiveSummaryItem[];
  onZoneClick: (zone: string, side: InjurySide) => void;
  selectedZone: Selected | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const zones = ZONES.filter((z) => z.view === view);

  // Group active items by zone+side key for bubble rendering
  const bubbleMap = new Map<string, ActiveSummaryItem[]>();
  activeItems.forEach((item) => {
    const key = `${item.zone}:${item.side ?? "mid"}`;
    if (!bubbleMap.has(key)) bubbleMap.set(key, []);
    bubbleMap.get(key)!.push(item);
  });

  return (
    <svg viewBox="0 0 100 240" className="w-full h-full" style={{ maxHeight: 320 }}>
      {view === "front" ? <BodySilhouetteFront /> : <BodySilhouetteBack />}

      {zones.map((z) => {
        const key = `${z.slug}:${z.view}:${z.side ?? "mid"}`;
        const selKey = `${z.slug}:${z.side ?? "mid"}`;
        const isSelected =
          selectedZone?.zone === z.slug && selectedZone?.side === z.side;
        const isHovered = hovered === key;
        const bubbles = bubbleMap.get(`${z.slug}:${z.side ?? "mid"}`) ?? [];
        const hasInjury = bubbles.length > 0;

        const commonProps = {
          key,
          onClick: () => onZoneClick(z.slug, z.side),
          onMouseEnter: () => setHovered(key),
          onMouseLeave: () => setHovered(null),
          style: { cursor: "pointer" },
          fill: isSelected
            ? "rgba(59,130,246,0.35)"
            : hasInjury
            ? "rgba(249,115,22,0.15)"
            : isHovered
            ? "rgba(255,255,255,0.08)"
            : "transparent",
          stroke: isSelected ? "#3B82F6" : hasInjury ? "#F97316" : isHovered ? "#71717A" : "transparent",
          strokeWidth: 0.6,
        };

        return z.shape === "rect" ? (
          <rect
            {...commonProps}
            x={z.coords[0]}
            y={z.coords[1]}
            width={z.coords[2]}
            height={z.coords[3]}
            rx={2}
          />
        ) : (
          <ellipse
            {...commonProps}
            cx={z.coords[0]}
            cy={z.coords[1]}
            rx={z.coords[2]}
            ry={z.coords[3]}
          />
        );
      })}

      {/* Injury bubbles */}
      {zones.map((z) => {
        const bubbles = bubbleMap.get(`${z.slug}:${z.side ?? "mid"}`) ?? [];
        if (bubbles.length === 0) return null;
        const top = bubbles[0];
        const color = STATUS_COLOR[top.status as InjuryStatus] ?? "#F97316";
        const label = bubbles.length > 1 ? String(bubbles.length) : String(top.pain_scale);
        return (
          <g
            key={`bubble-${z.slug}-${z.view}-${z.side}`}
            onClick={() => onZoneClick(z.slug, z.side)}
            style={{ cursor: "pointer" }}
            pointerEvents="none"
          >
            <circle cx={z.cx} cy={z.cy} r={7} fill={color} opacity={0.9} />
            <text
              x={z.cx}
              y={z.cy + 3.5}
              textAnchor="middle"
              fontSize={7}
              fontWeight="bold"
              fill="white"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

type FormState = {
  zone: string;
  side: InjurySide;
  pain_scale: number;
  status: InjuryStatus;
  onset_date: string;
  mechanism: string;
  activity_id: string;
  activity_type: string;
  notes: string;
};

type RecentActivity = {
  id: string;
  name: string | null;
  activity_type: string | null;
  start_time: string | null;
  distance_meters: number | null;
};

function InjuryForm({
  initial,
  editingId,
  onSave,
  onCancel,
}: {
  initial: Partial<FormState>;
  editingId?: number;
  onSave: (data: InjuryCreate | InjuryPatch, id?: number) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    zone: initial.zone ?? "",
    side: initial.side ?? null,
    pain_scale: initial.pain_scale ?? 5,
    status: initial.status ?? "active",
    onset_date: initial.onset_date ?? format(new Date(), "yyyy-MM-dd"),
    mechanism: initial.mechanism ?? "",
    activity_id: initial.activity_id ?? "",
    activity_type: initial.activity_type ?? "",
    notes: initial.notes ?? "",
  });

  const { data: recentActivities } = useQuery<RecentActivity[]>({
    queryKey: ["recent-activities-injuries"],
    queryFn: () =>
      fetch(`${BASE}/injuries/recent-activities?limit=30`).then((r) => r.json()),
  });

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function handleActivitySelect(actId: string) {
    const act = recentActivities?.find((a) => a.id === actId);
    set("activity_id", actId);
    if (act?.activity_type) set("activity_type", act.activity_type);
  }

  function handleSubmit() {
    const payload: InjuryCreate = {
      zone: form.zone,
      side: form.side,
      pain_scale: form.pain_scale,
      status: form.status,
      onset_date: form.onset_date,
      mechanism: (form.mechanism || undefined) as InjuryCreate["mechanism"],
      activity_type: form.activity_type || undefined,
      activity_id: form.activity_id || undefined,
      notes: form.notes || undefined,
    };
    if (editingId !== undefined) {
      const patch: InjuryPatch = {
        pain_scale: payload.pain_scale,
        status: payload.status,
        mechanism: payload.mechanism,
        activity_type: payload.activity_type,
        activity_id: payload.activity_id,
        notes: payload.notes,
      };
      onSave(patch, editingId);
    } else {
      onSave(payload);
    }
  }

  const zoneLabelStr = ZONE_LABELS[form.zone] ?? form.zone;
  const sideStr = form.side ? ` (${form.side})` : "";

  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">
          {editingId !== undefined ? "Edit injury" : "Log injury"} — {zoneLabelStr}{sideStr}
        </span>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white text-xs">
          Cancel
        </button>
      </div>

      {/* Pain scale */}
      <div>
        <label className="text-xs text-zinc-400 mb-1.5 block">Pain scale</label>
        <div className="flex gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => set("pain_scale", n)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                form.pain_scale === n
                  ? n <= 3
                    ? "bg-emerald-500 text-white"
                    : n <= 6
                    ? "bg-amber-500 text-white"
                    : "bg-rose-500 text-white"
                  : "bg-[#27272A] text-zinc-400 hover:text-white"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="text-xs text-zinc-400 mb-1.5 block">Status</label>
        <div className="flex gap-2">
          {(["active", "recovering", "resolved"] as InjuryStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => set("status", s)}
              className={`flex-1 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                form.status === s
                  ? s === "active"
                    ? "bg-orange-500 text-white"
                    : s === "recovering"
                    ? "bg-yellow-500 text-black"
                    : "bg-emerald-500 text-white"
                  : "bg-[#27272A] text-zinc-400 hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Onset date */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Onset date</label>
          <input
            type="date"
            value={form.onset_date}
            onChange={(e) => set("onset_date", e.target.value)}
            disabled={editingId !== undefined}
            className="w-full bg-[#27272A] border border-[#3F3F46] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </div>

        {/* Mechanism */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Mechanism</label>
          <select
            value={form.mechanism}
            onChange={(e) => set("mechanism", e.target.value)}
            className="w-full bg-[#27272A] border border-[#3F3F46] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">— not set —</option>
            <option value="overuse">Overuse</option>
            <option value="acute">Acute</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>

      {/* Triggered by activity */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">Triggered by activity (optional)</label>
        <select
          value={form.activity_id}
          onChange={(e) => handleActivitySelect(e.target.value)}
          className="w-full bg-[#27272A] border border-[#3F3F46] rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">— none / not from a specific activity —</option>
          {recentActivities?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.start_time ? a.start_time.slice(0, 10) : "—"} · {a.name ?? a.activity_type ?? a.id}
              {a.distance_meters ? ` · ${(a.distance_meters / 1000).toFixed(1)} km` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          placeholder="Any extra context..."
          className="w-full bg-[#27272A] border border-[#3F3F46] rounded px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <button
        onClick={handleSubmit}
        className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors"
      >
        {editingId !== undefined ? "Save changes" : "Log injury"}
      </button>
    </div>
  );
}

// ── History list ──────────────────────────────────────────────────────────────

function InjuryCard({
  injury,
  onResolve,
  onEdit,
  onDelete,
}: {
  injury: Injury;
  onResolve: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const zoneLabel = ZONE_LABELS[injury.zone] ?? injury.zone;
  const sideLabel = injury.side ? ` · ${injury.side}` : "";

  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-sm font-medium text-white capitalize">
            {zoneLabel}{sideLabel}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs px-1.5 py-0.5 rounded capitalize font-medium ${STATUS_BG[injury.status as InjuryStatus]}`}>
              {injury.status}
            </span>
            <span className="text-xs text-zinc-500">
              pain {injury.pain_scale}/10
            </span>
            {injury.mechanism && (
              <span className="text-xs text-zinc-600 capitalize">{injury.mechanism}</span>
            )}
          </div>
        </div>
        <div className="text-xs text-zinc-500 text-right shrink-0">
          <div>{injury.onset_date}</div>
          {injury.resolved_date && (
            <div className="text-emerald-600">→ {injury.resolved_date}</div>
          )}
        </div>
      </div>

      {injury.notes && (
        <p className="text-xs text-zinc-500 line-clamp-2">{injury.notes}</p>
      )}

      {injury.activity_id && (
        <Link
          href={`/activity/${injury.activity_id}`}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {injury.activity_type ? `View ${injury.activity_type} →` : "View activity →"}
        </Link>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onEdit}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Edit
        </button>
        {injury.status !== "resolved" && (
          <button
            onClick={onResolve}
            className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Mark resolved
          </button>
        )}
        <div className="ml-auto">
          {confirmDelete ? (
            <span className="text-xs">
              <button onClick={onDelete} className="text-rose-400 hover:text-rose-300 mr-2">
                Confirm delete
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-zinc-500">
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-zinc-600 hover:text-rose-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InjuriesPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"front" | "back">("front");
  const [historyFilter, setHistoryFilter] = useState<"active" | "all">("active");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editingInjury, setEditingInjury] = useState<Injury | null>(null);

  const { data: activeSummary = [] } = useQuery<ActiveSummaryItem[]>({
    queryKey: ["injuries-active-summary"],
    queryFn: injuriesApi.activeSummary,
  });

  const { data: allInjuries = [] } = useQuery<Injury[]>({
    queryKey: ["injuries-list"],
    queryFn: () => injuriesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: InjuryCreate) => injuriesApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["injuries-active-summary"] });
      qc.invalidateQueries({ queryKey: ["injuries-list"] });
      setSelected(null);
      setEditingInjury(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: InjuryPatch }) =>
      injuriesApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["injuries-active-summary"] });
      qc.invalidateQueries({ queryKey: ["injuries-list"] });
      setSelected(null);
      setEditingInjury(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => injuriesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["injuries-active-summary"] });
      qc.invalidateQueries({ queryKey: ["injuries-list"] });
    },
  });

  const handleZoneClick = useCallback(
    (zone: string, side: InjurySide) => {
      // If there's an active injury on this zone, open edit for it
      const existing = activeSummary.find(
        (a) => a.zone === zone && a.side === side,
      );
      if (existing) {
        const full = allInjuries.find((i) => i.id === existing.id);
        if (full) {
          setEditingInjury(full);
          setSelected({ zone, side });
          return;
        }
      }
      setEditingInjury(null);
      setSelected({ zone, side });
    },
    [activeSummary, allInjuries],
  );

  function handleSave(data: InjuryCreate | InjuryPatch, id?: number) {
    if (id !== undefined) {
      updateMutation.mutate({ id, body: data as InjuryPatch });
    } else {
      createMutation.mutate(data as InjuryCreate);
    }
  }

  const displayedInjuries =
    historyFilter === "active"
      ? allInjuries.filter((i) => i.status !== "resolved")
      : allInjuries;

  const activeCount = activeSummary.filter((i) => i.status === "active").length;
  const recoveringCount = activeSummary.filter((i) => i.status === "recovering").length;

  return (
    <div className="min-h-screen bg-[#09090B] text-white px-4 py-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Health
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Injuries</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Tap a zone to log or update pain · Bubble = pain scale</p>

        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <Link href="/health" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Activity size={13} />Overview
          </Link>
          <Link href="/training" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Dumbbell size={13} />Training
          </Link>
          <Link href="/health/sleep" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Moon size={13} />Sleep
          </Link>
          <Link href="/health/streaks" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Flame size={13} />Streaks
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <AlertTriangle size={13} />Injuries
          </span>
        </div>
      </div>

      {/* Summary chips */}
      {(activeCount > 0 || recoveringCount > 0) && (
        <div className="flex gap-3 text-xs">
          {activeCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
              <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
              {activeCount} active
            </span>
          )}
          {recoveringCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
              {recoveringCount} recovering
            </span>
          )}
        </div>
      )}

      {/* Body diagram */}
      <div className="bg-[#111113] border border-[#27272A] rounded-xl p-4">
        {/* Front / Back toggle */}
        <div className="flex gap-2 mb-4 justify-center">
          {(["front", "back"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded text-xs font-medium capitalize transition-colors ${
                view === v
                  ? "bg-[#27272A] text-white"
                  : "text-zinc-500 hover:text-white"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex gap-4 items-start justify-center">
          <div className="w-40">
            <BodyDiagram
              view={view}
              activeItems={activeSummary}
              onZoneClick={handleZoneClick}
              selectedZone={selected}
            />
          </div>

          {/* Legend */}
          <div className="text-xs space-y-2 pt-4 text-zinc-500">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />
              Active
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
              Recovering
            </div>
            <div className="mt-3 text-zinc-600 leading-relaxed">
              Tap any zone<br />to log pain
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      {selected && (
        <InjuryForm
          initial={
            editingInjury
              ? {
                  zone: editingInjury.zone,
                  side: editingInjury.side,
                  pain_scale: editingInjury.pain_scale,
                  status: editingInjury.status as InjuryStatus,
                  onset_date: editingInjury.onset_date,
                  mechanism: editingInjury.mechanism ?? "",
                  activity_id: editingInjury.activity_id ?? "",
                  activity_type: editingInjury.activity_type ?? "",
                  notes: editingInjury.notes ?? "",
                }
              : { zone: selected.zone, side: selected.side }
          }
          editingId={editingInjury?.id}
          onSave={handleSave}
          onCancel={() => {
            setSelected(null);
            setEditingInjury(null);
          }}
        />
      )}

      {/* History list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-200">Injury history</h2>
          <div className="flex gap-1">
            {(["active", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setHistoryFilter(f)}
                className={`text-xs px-2.5 py-1 rounded capitalize transition-colors ${
                  historyFilter === f
                    ? "bg-[#27272A] text-white"
                    : "text-zinc-500 hover:text-white"
                }`}
              >
                {f === "active" ? "Active & recovering" : "All"}
              </button>
            ))}
          </div>
        </div>

        {displayedInjuries.length === 0 ? (
          <p className="text-xs text-zinc-600 py-4 text-center">
            {historyFilter === "active"
              ? "No active injuries — tap a zone on the diagram to log one."
              : "No injuries logged yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {displayedInjuries.map((inj) => (
              <InjuryCard
                key={inj.id}
                injury={inj}
                onResolve={() =>
                  updateMutation.mutate({
                    id: inj.id,
                    body: {
                      status: "resolved",
                      resolved_date: format(new Date(), "yyyy-MM-dd"),
                    },
                  })
                }
                onEdit={() => {
                  setEditingInjury(inj);
                  setSelected({ zone: inj.zone, side: inj.side });
                }}
                onDelete={() => deleteMutation.mutate(inj.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
