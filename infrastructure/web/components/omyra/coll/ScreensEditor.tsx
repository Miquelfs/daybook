"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { ActionButton, Panel } from "@/components/ui/kit";
import { screensLine, type CollScreen, type CollScreenKind, type CollSettings } from "@/lib/coll-api";
import { quiet, Select } from "./parts";

const KIND: Record<CollScreenKind, { name: string; what: string }> = {
  list: { name: "Fields", what: "stacked, the first one big" },
  grid: { name: "Grid", what: "two columns, everything at a glance" },
  map: { name: "Map", what: "the route and turn arrows (with a route)" },
  climb: { name: "Climb", what: "the elevation ahead (with a route)" },
  fuel: { name: "Fuel", what: "next reminders and carbs so far (with a plan)" },
};

/** A small portrait sketch of the page, so the order reads like the device. */
function Sketch({ p, label }: { p: CollScreen; label: (id: string) => string }) {
  return (
    <div className="w-[72px] h-[120px] shrink-0 rounded-md border border-[#27272A] bg-[#18181B] p-1.5 overflow-hidden">
      {p.kind === "list" && p.fields.map((f, i) => (
        <p key={i} className={`truncate leading-tight ${i === 0 ? "text-[9px] font-semibold text-[#FAFAFA] mb-1" : "text-[7px] text-[#A1A1AA] mb-0.5"}`}>
          {label(f)}
        </p>
      ))}
      {p.kind === "grid" && (
        <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
          {p.fields.map((f, i) => <p key={i} className="text-[6px] leading-tight text-[#A1A1AA] truncate">{label(f)}</p>)}
        </div>
      )}
      {p.kind !== "list" && p.kind !== "grid" && (
        <div className="h-full flex items-center justify-center text-[8px] uppercase tracking-widest text-[#52525B]">{KIND[p.kind].name}</div>
      )}
    </div>
  );
}

/** Coll's ride pages: which, in which order, with which fields. Saved as settings; Coll takes them at its next sync. */
export function ScreensEditor({ s, onSave }: { s: CollSettings; onSave: (screens: string | null) => Promise<void> }) {
  const [pages, setPages] = useState<CollScreen[]>(s.screens_pages);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPages(s.screens_pages), [s.screens_pages]);
  const label = (id: string) => s.screens_fields.find((f) => f.id === id)?.label ?? id;
  const current = screensLine(pages);
  const saved = s.screens ?? s.screens_default;
  const dirty = current !== saved;

  const set = (i: number, p: CollScreen | null) =>
    setPages((ps) => (p ? ps.map((x, k) => (k === i ? p : x)) : ps.filter((_, k) => k !== i)));
  const move = (i: number, d: -1 | 1) => setPages((ps) => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const out = [...ps];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });
  const moveField = (i: number, k: number, d: -1 | 1) => {
    const f = [...pages[i].fields];
    const j = k + d;
    if (j < 0 || j >= f.length) return;
    [f[k], f[j]] = [f[j], f[k]];
    set(i, { ...pages[i], fields: f });
  };

  async function save(v: string | null) {
    setBusy(true);
    try { await onSave(v); } finally { setBusy(false); }
  }

  return (
    <Panel className="divide-y divide-[#18181B]">
      {pages.map((p, i) => {
        const cap = s.screens_limits[p.kind];
        return (
          <div key={i} className="p-4 flex gap-4">
            <Sketch p={p} label={label} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#52525B] tabular-nums w-4">{i + 1}</span>
                <p className="text-sm font-medium">{KIND[p.kind].name}</p>
                <p className="text-xs text-[#71717A] truncate flex-1">{KIND[p.kind].what}</p>
                <button className={quiet} disabled={i === 0} onClick={() => move(i, -1)} title="Earlier"><ArrowUp size={13} /></button>
                <button className={quiet} disabled={i === pages.length - 1} onClick={() => move(i, 1)} title="Later"><ArrowDown size={13} /></button>
                <button className={`${quiet} hover:text-rose-400`} disabled={pages.length === 1} onClick={() => set(i, null)} title="Remove the page"><X size={13} /></button>
              </div>
              {cap > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {p.fields.map((f, k) => (
                    <span key={`${f}${k}`} className="inline-flex items-center gap-1 text-xs bg-[#18181B] border border-[#27272A] rounded-lg pl-2 pr-1 py-0.5">
                      <button className="text-[#52525B] hover:text-[#A1A1AA] disabled:opacity-30" disabled={k === 0}
                              onClick={() => moveField(i, k, -1)} title="Earlier">‹</button>
                      <span className={k === 0 && p.kind === "list" ? "font-semibold text-[#FAFAFA]" : "text-[#D4D4D8]"}>{label(f)}</span>
                      <button className="text-[#52525B] hover:text-[#A1A1AA] disabled:opacity-30" disabled={k === p.fields.length - 1}
                              onClick={() => moveField(i, k, 1)} title="Later">›</button>
                      <button className="text-[#52525B] hover:text-rose-400 disabled:opacity-30" disabled={p.fields.length === 1}
                              onClick={() => set(i, { ...p, fields: p.fields.filter((_, x) => x !== k) })} title="Remove"><X size={11} /></button>
                    </span>
                  ))}
                  {p.fields.length < cap && (
                    <div className="w-40">
                      <Select value="" onChange={(v) => v && set(i, { ...p, fields: [...p.fields, v] })}>
                        <option value="">+ field ({p.fields.length}/{cap})</option>
                        {s.screens_fields.filter((f) => !p.fields.includes(f.id)).map((f) =>
                          <option key={f.id} value={f.id}>{f.label}{f.note ? ` · ${f.note}` : ""}</option>)}
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="p-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {pages.length < 8 && (
          <div className="w-44">
            <Select value="" onChange={(v) => v && setPages((ps) => [...ps, {
              kind: v as CollScreenKind, fields: v === "list" ? ["speed"] : v === "grid" ? ["distance", "ride_time"] : [] }])}>
              <option value="">+ page</option>
              {(Object.keys(KIND) as CollScreenKind[]).map((k) => <option key={k} value={k}>{KIND[k].name}</option>)}
            </Select>
          </div>
        )}
        {dirty ? (
          <ActionButton icon={Check} onClick={() => { if (!busy) save(current); }}>{busy ? "Saving…" : "Save the pages"}</ActionButton>
        ) : <span className="text-xs text-[#52525B]">{s.screens ? "Your pages" : "Coll's own pages"} · Coll takes changes at its next sync</span>}
        {dirty && <button className={quiet} onClick={() => setPages(s.screens_pages)}>Undo</button>}
        {s.screens && !dirty && <button className={quiet} disabled={busy} onClick={() => save(null)}>Back to Coll&apos;s own</button>}
      </div>
    </Panel>
  );
}
