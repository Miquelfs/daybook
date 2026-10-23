"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FitImport } from "@/lib/api";

const mmss = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.round(Math.abs(s) % 60)).padStart(2, "0")}`;

function alignText(f: FitImport) {
  if (f.align_method === "hr")
    return `Lined up by heart rate (match ${Math.round((f.align_corr ?? 0) * 100)}%)` +
      (f.clock_skew_s && Math.abs(f.clock_skew_s) > 60 ? ` — the file's clock was ${mmss(f.clock_skew_s)} off` : "");
  if (f.align_method === "clock") return "Lined up by the device clocks (no heart rate to match)";
  return "Assumed both started together — no heart rate or clock overlap to line them up";
}

/**
 * Trainer rides: the watch records heart rate, the trainer app (MyWhoosh…) records
 * power/cadence/distance. Upload its .fit here and both merge into this one activity.
 */
export function FitFileCard({ activityId, date, fit, isTest, sessionId }: {
  activityId: string; date: string; fit: FitImport | null; isTest: boolean; sessionId: number | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy("upload"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/fit`, { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.detail ?? "Upload failed");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); if (input.current) input.current.value = ""; }
  }

  async function remove() {
    if (!confirm("Remove the .fit file and go back to the watch's own recording?")) return;
    setBusy("remove"); setErr(null);
    try {
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/fit`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch { setErr("Couldn't remove — try again."); }
    finally { setBusy(null); }
  }

  const b20 = fit?.best_20min;
  const newFtp = b20 ? Math.round(b20.avg_power_w * 0.95) : null;
  const ftpSet = newFtp != null && fit?.ftp_w != null && Math.round(fit.ftp_w) === newFtp;

  async function setFtp() {
    if (!b20) return;
    setBusy("ftp"); setErr(null);
    try {
      const r = await fetch(`/api/race-plans/benchmarks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, sport: "ride", test_type: "bike_20min", session_id: sessionId,
                               result: { avg_power_w: b20.avg_power_w, avg_hr: b20.avg_hr ?? 0 } }),
      });
      if (!r.ok) throw new Error();
      // TSS / intensity / power zones follow the new FTP
      await fetch(`/api/activities/${encodeURIComponent(activityId)}/fit`, { method: "PUT" });
      router.refresh();
    } catch { setErr("Couldn't save the FTP — try again."); }
    finally { setBusy(null); }
  }

  return (
    <section className="mb-8">
      <span className="text-xs text-[#52525B] uppercase tracking-widest">Trainer file</span>
      <div className="mt-2 bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <input ref={input} type="file" accept=".fit,application/octet-stream" className="hidden"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        {fit ? (
          <>
            <p className="text-sm">
              <span className="font-medium">{fit.device ?? "Trainer app"}</span>
              <span className="text-[#71717A]"> merged · {fit.channels.filter((c) => c !== "hr" && c !== "altitude").join(", ")}</span>
            </p>
            <p className="text-xs text-[#71717A] mt-1">{alignText(fit)}</p>
            <p className="text-xs text-[#A1A1AA] mt-2 tabular-nums">
              {[
                fit.avg_power_w != null ? `${fit.avg_power_w} W avg` : null,
                fit.max_power_w != null ? `${fit.max_power_w} W max` : null,
                fit.avg_cadence ? `${fit.avg_cadence} rpm` : null,
                fit.distance_m ? `${(fit.distance_m / 1000).toFixed(2)} km` : null,
                fit.ascent_m ? `↑ ${fit.ascent_m} m virtual` : null,
              ].filter(Boolean).join(" · ")}
            </p>
            {b20 && (
              <div className="mt-3 pt-3 border-t border-[#18181B] flex items-center gap-3 flex-wrap">
                <p className="text-sm tabular-nums flex-1 min-w-0">
                  Best 20 min <b>{b20.avg_power_w} W</b>{b20.avg_hr ? ` at ${b20.avg_hr} bpm` : ""}
                  <span className="text-[#71717A]"> → FTP {newFtp} W</span>
                </p>
                {isTest && (ftpSet
                  ? <span className="text-xs text-emerald-400">✓ FTP set to {newFtp} W</span>
                  : <button onClick={setFtp} disabled={!!busy}
                            className="text-xs px-3 py-1.5 rounded-full bg-white text-black font-medium disabled:opacity-50">
                      {busy === "ftp" ? "Saving…" : `Set FTP ${newFtp} W`}
                    </button>)}
              </div>
            )}
            <div className="mt-3 flex gap-4 text-xs">
              <button onClick={() => input.current?.click()} disabled={!!busy} className="text-[#A1A1AA] hover:text-white disabled:opacity-50">
                {busy === "upload" ? "Merging…" : "Replace file"}
              </button>
              <button onClick={remove} disabled={!!busy} className="text-[#71717A] hover:text-red-400 disabled:opacity-50">
                {busy === "remove" ? "Removing…" : "Remove"}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-xs text-[#71717A] flex-1">
              Rode in MyWhoosh or Zwift? Add its .fit file to merge power, cadence and distance into this ride — no duplicate activity.
            </p>
            <button onClick={() => input.current?.click()} disabled={!!busy}
                    className="text-xs px-3 py-1.5 rounded-full border border-[#3F3F46] hover:border-white shrink-0 disabled:opacity-50">
              {busy === "upload" ? "Merging…" : "Add .fit"}
            </button>
          </div>
        )}
        {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      </div>
    </section>
  );
}
