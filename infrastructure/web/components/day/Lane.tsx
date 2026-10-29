"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";

// The day-plan section is four lanes — Duty, Training, Learning, Tasks — that all
// open the same way: a line icon, a small grey label, and a quiet link on the right,
// then one rounded-xl card. Each lane renders its own header so it can disappear
// when empty. A lane can fold away (`collapsible`); the choice is remembered per device.

export function LaneHeader({ icon: Icon, label, action, open, onToggle, summary }: {
  icon: LucideIcon;
  label: string;
  action?: React.ReactNode;
  /** Collapsible lanes: current state + toggle. */
  open?: boolean;
  onToggle?: () => void;
  /** Shown next to the label while folded. */
  summary?: React.ReactNode;
}) {
  const title = (
    <>
      <Icon size={14} strokeWidth={1.75} className="text-[#71717A] shrink-0" />
      <h3 className="text-[11px] leading-4 uppercase tracking-[0.18em] text-[#71717A]">{label}</h3>
      {onToggle && (
        <ChevronDown size={13} className={`text-[#71717A] transition-transform ${open ? "" : "-rotate-90"}`} />
      )}
      {onToggle && !open && summary && (
        <span className="text-[11px] leading-4 text-[#71717A] normal-case truncate">· {summary}</span>
      )}
    </>
  );
  return (
    <div className="flex items-center gap-2 h-4 mb-3 px-0.5">
      {onToggle ? (
        <button onClick={onToggle} aria-expanded={open} className="flex items-center gap-2 min-w-0 hover:opacity-80">
          {title}
        </button>
      ) : title}
      {action && <div className="ml-auto pl-3 min-w-0 flex items-center">{action}</div>}
    </div>
  );
}

export function LaneLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[11px] leading-4 text-[#71717A] hover:text-[#F59E0B] transition-colors truncate">
      {children}
    </Link>
  );
}

/** Open/closed state for a collapsible lane, kept in this browser (open by default). */
export function useLaneOpen(key: string): [boolean, () => void] {
  const storageKey = `daybook.lane.${key}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey) === "closed") setOpen(false);
    } catch { /* storage blocked — stay open */ }
  }, [storageKey]);
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem(storageKey, o ? "closed" : "open"); } catch { /* ignore */ }
    return !o;
  });
  return [open, toggle];
}
