"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Trash2, Upload } from "lucide-react";
import { ActionButton, Empty, Panel } from "@/components/ui/kit";
import { collApi, COLL_KEYS, type CollSyncSession } from "@/lib/coll-api";
import { ago, field, fmtDate, quiet } from "./parts";

const KIND_NAME: Record<string, string> = {
  sync: "Sync", settings: "Settings", pack: "Route", ride: "Ride", device: "Report", firmware: "Firmware", auth: "Token",
};

function kb(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Firmware over Wi-Fi: upload a build; Coll installs the newest at its next sync and reports its version back. */
export function FirmwarePanel({ running }: { running: string | null }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: COLL_KEYS.firmware, queryFn: collApi.firmware });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      qc.setQueryData(COLL_KEYS.firmware, await collApi.uploadFirmware(version.trim(), file, notes.trim() || undefined));
      qc.invalidateQueries({ queryKey: COLL_KEYS.device });
      setFile(null); setVersion(""); setNotes("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const newest = data?.builds[0];
  const state = data?.state ?? "none";
  return (
    <Panel className="p-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{running ? `Coll runs ${running}` : "Coll hasn't reported a version yet"}</p>
          <p className="text-xs text-[#71717A] mt-0.5">
            {state === "update offered" && newest ? `${newest.version} offered — Coll installs it at its next sync, then reports back.`
              : state === "up to date" ? "Up to date with the newest build here."
              : state === "newer on Coll" ? "Coll runs a newer build than any here (flashed by cable?)."
              : "No build uploaded: Coll keeps what it runs."}
          </p>
        </div>
        {state === "update offered" && <span className="text-[10px] uppercase tracking-widest text-[#F59E0B] shrink-0">update</span>}
      </div>

      {!!data?.builds.length && (
        <div className="rounded-xl border border-[#18181B] divide-y divide-[#18181B]">
          {data.builds.map((b) => (
            <div key={b.version} className="px-3 py-2 flex items-center gap-3 text-xs">
              <span className="w-14 font-medium text-sm tabular-nums">{b.version}</span>
              <span className="flex-1 min-w-0 truncate text-[#A1A1AA]">{b.notes ?? "—"}</span>
              <span className="text-[#71717A] tabular-nums">{kb(b.bytes)} · {fmtDate(b.uploaded_at.slice(0, 10))}</span>
              {b.version === running && <span className="text-[10px] uppercase tracking-widest text-[#52525B]">on Coll</span>}
              <button className={`${quiet} hover:text-rose-400`} title="Remove this build"
                      onClick={async () => { if (confirm(`Remove firmware ${b.version}?`)) { await collApi.removeFirmware(b.version); qc.invalidateQueries({ queryKey: ["coll"] }); } }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" accept=".bin" className="hidden"
             onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); e.target.value = "";
               const m = f?.name.match(/(\d+\.\d+\.\d+)/); if (m && !version) setVersion(m[1]); }} />
      {file ? (
        <div className="space-y-2">
          <p className="text-xs text-[#A1A1AA]">{file.name} · {kb(file.size)}</p>
          <div className="flex gap-2">
            <input className={`${field} w-28`} placeholder="0.2.0" value={version} onChange={(e) => setVersion(e.target.value)} />
            <input className={field} placeholder="What changed (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center gap-4">
            <ActionButton icon={Upload} onClick={() => { if (!busy && version.trim()) upload(); }}>{busy ? "Uploading…" : "Offer to Coll"}</ActionButton>
            <button className={quiet} onClick={() => setFile(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className={quiet} onClick={() => fileRef.current?.click()}><Upload size={12} />Upload a build (.bin from the firmware build)</button>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
    </Panel>
  );
}

function Session({ s, open, onToggle }: { s: CollSyncSession; open: boolean; onToggle: () => void }) {
  const kinds = s.steps.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {});
  const rides = s.steps.filter((x) => x.kind === "ride" && x.status === 201).length;
  const routes = s.steps.filter((x) => x.kind === "pack" && x.status === 200).length;
  const summary = [
    routes ? `${routes} route${routes > 1 ? "s" : ""} down` : null,
    rides ? `${rides} ride${rides > 1 ? "s" : ""} up` : null,
    s.steps.some((x) => x.kind === "firmware" && x.status === 200) ? "firmware down" : null,
    kinds.settings ? "settings" : null,
  ].filter(Boolean).join(" · ") || (kinds.sync ? "nothing new" : "refused");
  return (
    <div>
      <button onClick={onToggle} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[#18181B] transition-colors">
        {open ? <ChevronDown size={13} className="text-[#52525B]" /> : <ChevronRight size={13} className="text-[#52525B]" />}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.errors ? "bg-rose-400" : "bg-[#3F3F46]"}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{fmtDate(s.started.slice(0, 10))} · {time(s.started)}
            <span className="text-xs font-normal text-[#71717A]"> · {ago(s.started)}</span></p>
          <p className="text-xs text-[#71717A] truncate">{summary}{s.errors ? <span className="text-rose-400"> · {s.errors} error{s.errors > 1 ? "s" : ""}</span> : null}</p>
        </div>
        <span className="text-xs text-[#52525B] tabular-nums shrink-0">
          {s.down_bytes ? `↓ ${kb(s.down_bytes)}` : ""}{s.up_bytes ? ` ↑ ${kb(s.up_bytes)}` : ""}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 pl-11 space-y-1">
          {s.steps.map((x, i) => (
            <div key={i} className="flex items-start gap-3 text-xs tabular-nums">
              <span className="w-16 shrink-0 text-[#52525B]">{time(x.at)}</span>
              <span className="w-16 shrink-0 text-[#A1A1AA]">{KIND_NAME[x.kind] ?? x.kind}</span>
              <span className={`w-8 shrink-0 ${x.status >= 400 ? "text-rose-400" : "text-[#71717A]"}`}>{x.status}</span>
              <span className={`flex-1 min-w-0 break-words ${x.status >= 400 ? "text-rose-400" : "text-[#D4D4D8]"}`}>{x.detail}</span>
              {x.bytes ? <span className="shrink-0 text-[#52525B]">{kb(x.bytes)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every request Coll made, grouped into syncs: what went out, what came back, what failed. */
export function SyncLog() {
  const { data } = useQuery({ queryKey: COLL_KEYS.syncLog, queryFn: collApi.syncLog, refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!data) return null;
  if (!data.length) return <Empty>No syncs yet. Each request Coll makes shows here — refused tokens too.</Empty>;
  const shown = all ? data : data.slice(0, 8);
  return (
    <div>
      <Panel className="divide-y divide-[#18181B] overflow-hidden">
        {shown.map((s, i) => {
          const k = s.started + i;
          return <Session key={k} s={s} open={open === k || (open === null && i === 0 && s.errors > 0)}
                          onToggle={() => setOpen(open === k ? "" : k)} />;
        })}
      </Panel>
      {data.length > 8 && (
        <button className={`${quiet} mt-2`} onClick={() => setAll(!all)}>{all ? "Fewer" : `All ${data.length} syncs`}</button>
      )}
    </div>
  );
}
