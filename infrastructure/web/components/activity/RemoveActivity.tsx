"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Not yours — a friend borrowed the watch. Two taps (ask, then confirm); it doesn't come back with the next sync. */
export function RemoveActivity({ activityId, name, date }: { activityId: string; name: string; date: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/remove`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "not mine" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Couldn't remove it");
      router.push(`/day/${date}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 pt-4 border-t border-[#18181B] text-xs text-[#52525B]">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} className="hover:text-[#A1A1AA] transition-colors">
          Not your activity? Remove it
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-[#A1A1AA]">
            Remove “{name}”? It goes from your days, training load and records — its Strava copy too — and the next
            sync won&apos;t bring it back.
          </p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={remove} disabled={busy}
                    className="px-3 py-1 rounded-full border border-rose-400/40 text-rose-400 hover:bg-rose-400/10 transition-colors">
              {busy ? "Removing…" : "Remove activity"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="hover:text-[#A1A1AA]">Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-rose-400 mt-2">{err}</p>}
    </section>
  );
}
