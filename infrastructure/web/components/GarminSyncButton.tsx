"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

type State = "idle" | "syncing" | "done" | "error";

// Poll cadence / ceiling for the on-demand refresh. The Pi runs three Garmin
// pulls back-to-back (activities → wellness → intraday HR), so give it headroom.
const POLL_MS = 3000;
const MAX_MS = 150_000;

// A small "sync now" control for the day header. Triggers the Pi's on-demand
// Garmin refresh and watches the 'manual' sync_status row until the data has
// actually landed, then refetches the server-rendered day + client widgets.
export function GarminSyncButton({ date }: { date: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [state, setState] = useState<State>("idle");
  const busy = useRef(false);

  const manualRow = async () =>
    (await api.syncStatus().catch(() => [])).find((s) => s.source === "manual");

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setState("syncing");

    // Baseline the 'manual' beacon so we can tell when this run completes.
    const before = await manualRow();
    const baseSuccess = before?.last_success_at ?? "";
    const baseAttempt = before?.last_attempt_at ?? "";

    await api.syncNow(date);

    let outcome: State = "idle"; // 'idle' after the loop means "timed out"
    const started = Date.now();
    while (Date.now() - started < MAX_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const row = await manualRow();
      if (!row) continue;
      const succeeded = row.last_success_at && row.last_success_at !== baseSuccess;
      const attemptMoved = row.last_attempt_at !== baseAttempt;
      if (succeeded) {
        outcome = "done";
        break;
      }
      if (attemptMoved && row.last_error) {
        outcome = "error";
        break;
      }
    }

    if (outcome !== "error") {
      // Success, or timed out — refetch either way; data may have landed.
      router.refresh(); // re-fetch server-rendered activities/movement
      qc.invalidateQueries(); // wellness timeline, training, tags, etc.
    }
    setState(outcome);
    busy.current = false;
    if (outcome !== "error") setTimeout(() => setState("idle"), 2500);
  };

  const { icon, cls, title } =
    state === "syncing"
      ? { icon: <RefreshCw size={16} className="animate-spin" />, cls: "text-[#F59E0B] border-[#F59E0B]/40", title: "Syncing Garmin…" }
      : state === "done"
      ? { icon: <Check size={16} />, cls: "text-[#34D399] border-[#34D399]/40", title: "Synced" }
      : state === "error"
      ? { icon: <AlertCircle size={16} />, cls: "text-[#F87171] border-[#F87171]/40", title: "Sync failed — tap to retry" }
      : { icon: <RefreshCw size={16} />, cls: "text-[#71717A] border-[#27272A] hover:text-[#FAFAFA] hover:border-[#3F3F46]", title: "Sync Garmin now" };

  return (
    <button
      onClick={run}
      disabled={state === "syncing"}
      title={title}
      aria-label={title}
      className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:cursor-wait ${cls}`}
    >
      {icon}
    </button>
  );
}
