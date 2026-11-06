"use client";

import { ChevronDown } from "lucide-react";
import type { CollBrief, CollCourse } from "@/lib/coll-api";

// Small shared pieces of the Coll tab. Colours only from the kit's token set (they re-map on paper).

export const field = "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] " +
  "placeholder:text-[#52525B] focus:outline-none focus:border-[#52525B] transition-colors";
export const quiet = "inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors disabled:opacity-40";

export function fmtDate(d: string, long = false) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-GB",
    long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
}

export function fmtDur(min: number) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}` : `${m} min`;
}

export function fmtKm(km: number) {
  return km >= 100 ? Math.round(km).toLocaleString("en-GB") : km.toFixed(1);
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function daysTo(d: string) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  return Math.round((new Date(`${d}T12:00:00`).getTime() - t.getTime()) / 86400000);
}

export function whenText(d: string) {
  const n = daysTo(d);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : fmtDate(d);
}

/** "112 km · +1,840 m · ≈ 4h 50" */
export function routeLine(b: CollBrief | null | undefined) {
  if (!b) return null;
  return `${fmtKm(b.km)} km · +${b.climb_m.toLocaleString("en-GB")} m · ≈ ${fmtDur(b.est_minutes)}`;
}

/** Where the route is on its way to Coll and back. */
export type Step = { key: string; label: string; state: "done" | "now" | "todo" | "bad" };

export function routeSteps(c: CollCourse): Step[] {
  const ridden = c.rides?.[0];
  return [
    { key: "import", label: "Imported", state: "done" },
    c.status === "ready" ? { key: "convert", label: "Converted", state: "done" }
      : c.status === "failed" ? { key: "convert", label: "Conversion failed", state: "bad" }
      : { key: "convert", label: c.status === "building" ? "Converting" : "Queued", state: "now" },
    c.on_coll === "yes" ? { key: "coll", label: "On Coll", state: "done" }
      : c.on_coll === "next sync" ? { key: "coll", label: "Next sync", state: c.status === "ready" ? "now" : "todo" }
      : c.on_coll === "old version" ? { key: "coll", label: "Update at next sync", state: "now" }
      : { key: "coll", label: c.on_device ? "Not on Coll yet" : "Off Coll", state: "todo" },
    ridden ? { key: "ride", label: "Ridden", state: "done" } : { key: "ride", label: "Ride", state: "todo" },
  ];
}

/** The one word for a route's state, for the list: the furthest step reached or in progress. */
export function routeState(c: CollCourse): Step {
  const s = routeSteps(c);
  return [...s].reverse().find((x) => x.state === "done" || x.state === "now" || x.state === "bad") ?? s[0];
}

const DOT = {
  done: "bg-[#D4D4D8] border-transparent",
  now: "bg-[#F59E0B]/20 border-[#F59E0B]",
  bad: "bg-[#EF4444]/15 border-[#EF4444]/40",
  todo: "bg-[#0D0D0F] border-[#3F3F46]",
};
const TXT = { done: "text-[#A1A1AA]", now: "text-[#F59E0B]", bad: "text-rose-400", todo: "text-[#52525B]" };

/** Imported ── Converted ── On Coll ── Ridden, as a stepper. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex flex-col items-center text-center">
          {i > 0 && (
            <span className={`absolute top-[5px] right-1/2 w-full h-px ${
              s.state === "todo" ? "bg-[#27272A]" : "bg-[#3F3F46]"}`} />
          )}
          <span className={`relative z-10 w-[11px] h-[11px] rounded-full border-2 ${DOT[s.state]}`} />
          <span className={`mt-1.5 text-[11px] leading-tight ${TXT[s.state]}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** A small state tag for lists: "On Coll" / "Next sync" / "Converting" … */
export function StateTag({ step }: { step: Step }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${TXT[step.state]}`}>
      <span className={`w-1.5 h-1.5 rounded-full border ${DOT[step.state]}`} />{step.label}
    </span>
  );
}

/** Coll's fuel string as readable chips: "Gel · every 25 min · 25 g". */
export function FuelChips({ plan }: { plan: string | null }) {
  if (!plan) return <span className="text-xs text-[#52525B]">No reminders</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {plan.split(",").map((p, i) => {
        const [name, every, g] = p.trim().split(":");
        return (
          <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-[#18181B] border border-[#27272A] rounded-lg px-2.5 py-1">
            <span className="font-medium text-[#FAFAFA]">{name}</span>
            <span className="text-[#71717A]">every {every} min{g ? ` · ${g} g` : ""}</span>
          </span>
        );
      })}
    </div>
  );
}

/** A native select styled like the fields, with the kit's chevron. */
export function Select({ value, onChange, children }: {
  value: string | number; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${field} appearance-none pr-8`}>
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#52525B] pointer-events-none" />
    </div>
  );
}

/** A labelled group inside a panel. */
export function Group({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}
