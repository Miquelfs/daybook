"use client";

import { X } from "lucide-react";

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[88dvh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#FAFAFA]">{title}</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} className="text-[#52525B]" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-[#71717A] mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function Chips<T extends string | number | null>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
            o.value === value ? "bg-[#F59E0B] text-black font-medium" : "bg-[#18181B] text-[#A1A1AA] hover:bg-[#27272A]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
