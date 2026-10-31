"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// Daybook's UI kit — the visual language of Omyra / Training / Health / Plan, for every page.
// Plain panels, tiny grey uppercase labels, neutral numbers, one amber accent. Rules: DESIGN.md.

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#0D0D0F] border border-[#27272A] rounded-2xl ${className}`}>{children}</div>;
}

export function Block({ title, note, action, tone, children }: {
  title: React.ReactNode;
  note?: string;
  action?: React.ReactNode;
  /** Only for state that needs attention (overdue). */
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className={`text-xs uppercase tracking-widest ${tone === "warn" ? "text-rose-400" : "text-[#52525B]"}`}>{title}</h2>
        {action}
      </div>
      {note && <p className="text-xs text-[#52525B] mb-3">{note}</p>}
      {children}
    </section>
  );
}

/** Small uppercase label above a number, as in the Omyra hero. */
export function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{children}</p>;
}

/** Omyra's pill tab bar. */
export function TabBar<T extends string>({ tabs, value, onChange }: {
  tabs: readonly { key: T; label: string; icon: LucideIcon }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-xl p-1 w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onChange(key)}
          className={`shrink-0 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            value === key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
          <Icon size={13} />{label}
        </button>
      ))}
    </div>
  );
}

/** The amber-outline action button Omyra uses for "Log". */
export function ActionButton({ onClick, icon: Icon, children }: {
  onClick: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors">
      {Icon && <Icon size={13} />}{children}
    </button>
  );
}

/** Filter / choice pills (amber outline when on), as on the habit list sort. */
export function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${
        on ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
      {children}
    </button>
  );
}

/** The page's one big number, in its top card (Omyra's race countdown, Plan's goals on track…).
 *  At most one per page; everything else is a Stat. */
export function Hero({ eyebrow, value, unit, sub, right, children, className = "" }: {
  eyebrow: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel className={`p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">{eyebrow}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{value}</span>
            {unit && <span className="text-sm text-[#A1A1AA]">{unit}</span>}
          </p>
          {sub && <p className="text-xs text-[#A1A1AA] mt-1">{sub}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </Panel>
  );
}

/** A number with its label — the tile used everywhere (Planned vs actual, Health, Omyra).
 *  `plain` drops the inset background, for a row of figures inside a Panel. */
export function Stat({ label, value, unit, sub, href, plain = false }: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  plain?: boolean;
}) {
  const body = (
    <>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums truncate">
        {value}{unit && <span className="text-xs font-normal text-[#71717A] ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-xs text-[#71717A] truncate">{sub}</p>}
    </>
  );
  const cls = plain ? "min-w-0" : "bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0";
  return href
    ? <Link href={href} className={`${cls} block hover:opacity-80 transition-opacity`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

/** A row of Stats: 2 across on a phone, up to `cols` on wider screens. */
export function Stats({ cols = 3, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) {
  const wide = cols === 4 ? "sm:grid-cols-4" : cols === 3 ? "sm:grid-cols-3" : "";
  return <div className={`grid grid-cols-2 ${wide} gap-2`}>{children}</div>;
}

/** A small rounded tag. `accent` (amber) marks what's new / selected — the app's only accent. */
export function Chip({ children, href, accent = false, title }: {
  children: React.ReactNode;
  href?: string;
  accent?: boolean;
  title?: string;
}) {
  const cls = `inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
    accent ? "bg-[#F59E0B]/10 text-[#F59E0B]" : "bg-[#18181B] text-[#A1A1AA]"}${href ? " hover:text-[#FAFAFA]" : ""}`;
  return href
    ? <Link href={href} title={title} className={cls}>{children}</Link>
    : <span title={title} className={cls}>{children}</span>;
}
