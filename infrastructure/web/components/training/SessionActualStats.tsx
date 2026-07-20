"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import type { SessionActual } from "@/lib/api";

function fmtDur(sec: number | null): string {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDist(m: number | null, activityType: string | null): string | null {
  if (!m) return null;
  const isSwim = (activityType ?? "").toLowerCase().includes("swim");
  return isSwim ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

// Compact "what you actually did" row shown on a plan session that was linked to
// a real activity (auto-matched from Garmin/Strava, or linked manually). Offers
// an unlink action and a jump to the full activity page.
export function SessionActualStats({
  actual,
  autoMatched,
  sessionId,
  onUnlinked,
}: {
  actual: SessionActual;
  autoMatched: boolean;
  sessionId: number;
  onUnlinked: () => void;
}) {
  const [unlinking, setUnlinking] = useState(false);

  async function unlink() {
    setUnlinking(true);
    try {
      await fetch(`/api/race-plans/sessions/${sessionId}/unlink`, { method: "POST" });
      onUnlinked();
    } catch {
      /* non-fatal */
    } finally {
      setUnlinking(false);
    }
  }

  const dist = fmtDist(actual.distance_m, actual.activity_type);
  const dur = fmtDur(actual.moving_time_s ?? actual.duration_s);

  return (
    <div className="bg-[#0D0D0F] border border-[#14532D] rounded-xl px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#4ADE80] uppercase tracking-wider">
          {autoMatched ? "✓ Auto-matched from Garmin" : "✓ Linked activity"}
        </span>
        <button
          onClick={unlink}
          disabled={unlinking}
          className="ml-auto flex items-center gap-1 text-[10px] text-[#52525B] hover:text-[#F87171] disabled:opacity-50"
        >
          <Link2Off size={11} /> {unlinking ? "…" : "Unlink"}
        </button>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {dist && (
          <div>
            <p className="text-[10px] text-[#52525B] uppercase">Distance</p>
            <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{dist}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] text-[#52525B] uppercase">Time</p>
          <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{dur}</p>
        </div>
        {actual.avg_hr != null && (
          <div>
            <p className="text-[10px] text-[#52525B] uppercase">Avg HR</p>
            <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{actual.avg_hr}</p>
          </div>
        )}
        {actual.tss != null && actual.tss > 0 && (
          <div>
            <p className="text-[10px] text-[#52525B] uppercase">TSS</p>
            <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{Math.round(actual.tss)}</p>
          </div>
        )}
        <Link
          href={`/activity/${actual.activity_id}`}
          className="ml-auto text-[11px] text-[#F59E0B] hover:text-[#D97706]"
        >
          View activity →
        </Link>
      </div>
    </div>
  );
}
