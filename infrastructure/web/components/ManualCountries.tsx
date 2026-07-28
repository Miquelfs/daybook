"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

interface Props {
  allCountries: Record<string, { iso2: string; continent: string }>;
  visitedIso2: string[];               // every visited iso2 (tracked + manual)
  manual: { country: string; iso2: string | null }[]; // only the hand-added ones
}

export function ManualCountries({ allCountries, visitedIso2, manual }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);

  const visited = useMemo(() => new Set(visitedIso2.map((c) => c.toUpperCase())), [visitedIso2]);

  // Countries not yet visited, alphabetical, for the add dropdown.
  const options = useMemo(
    () =>
      Object.entries(allCountries)
        .filter(([, m]) => !visited.has((m.iso2 || "").toUpperCase()))
        .sort(([a], [b]) => a.localeCompare(b)),
    [allCountries, visited]
  );

  async function add() {
    if (!selected) return;
    setBusy(true);
    const res = await fetch("/api/locations/manual-countries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: selected, first_visit: year.trim() || null }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) {
      setSelected("");
      setYear("");
      router.refresh();
    }
  }

  async function remove(iso2: string) {
    setBusy(true);
    const res = await fetch(`/api/locations/manual-countries/${iso2}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res && res.ok) router.refresh();
  }

  return (
    <div className="mt-3">
      {manual.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {manual.map((m) => (
            <span
              key={m.iso2 ?? m.country}
              className="inline-flex items-center gap-1 bg-[#18181B] border border-[#27272A] rounded-full pl-2.5 pr-1.5 py-0.5 text-xs text-[#A1A1AA]"
            >
              {m.country}
              {m.iso2 && (
                <button
                  onClick={() => remove(m.iso2!)}
                  disabled={busy}
                  className="text-[#52525B] hover:text-red-400 disabled:opacity-40"
                  aria-label={`Remove ${m.country}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {open ? (
        <div className="flex flex-wrap items-center gap-2 bg-[#0D0D0F] border border-[#27272A] rounded-lg px-3 py-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 min-w-[140px] bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
          >
            <option value="">Select a country…</option>
            {options.map(([name]) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Year (opt.)"
            className="w-24 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
          />
          <button
            onClick={add}
            disabled={busy || !selected}
            className="bg-[#F59E0B] text-[#0D0D0F] rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Add
          </button>
          <button onClick={() => setOpen(false)} className="text-[#52525B] hover:text-[#A1A1AA] px-1"><X size={16} /></button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors"
        >
          <Plus size={13} /> Add a country you visited before tracking
        </button>
      )}
    </div>
  );
}
