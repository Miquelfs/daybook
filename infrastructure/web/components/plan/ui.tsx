"use client";

import type { LucideIcon } from "lucide-react";

// The visual language of Omyra / Training / Health, so Plan reads as part of
// the same app: plain panels, tiny grey uppercase labels, one amber accent.

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
