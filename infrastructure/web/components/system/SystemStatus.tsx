"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export type Level = "ok" | "warn" | "fail";
type Check = { key: string; label: string; level: Level; detail: string; group: string };
type Job = {
  job: string; label: string; last_run: string; last_ok: string | null; status: string;
  consecutive_failures: number; level: Level; message: string | null;
};
export type SystemStatusData = { overall: Level; checked_at: string; checks: Check[]; jobs: Job[] };

const LEVEL_TEXT: Record<Level, string> = { ok: "text-[#4ADE80]", warn: "text-[#F59E0B]", fail: "text-[#F87171]" };

export function useSystemStatus() {
  return useQuery<SystemStatusData>({
    queryKey: ["system-status"],
    queryFn: () => fetch("/api/system/status", { cache: "no-store" }).then((r) => r.json()),
    staleTime: 5 * 60_000,
  });
}

function LevelIcon({ level, size = 14 }: { level: Level; size?: number }) {
  if (level === "ok") return <CheckCircle2 size={size} className={LEVEL_TEXT.ok} />;
  if (level === "warn") return <AlertTriangle size={size} className={LEVEL_TEXT.warn} />;
  return <XCircle size={size} className={LEVEL_TEXT.fail} />;
}

/** One quiet line on Today — rendered ONLY when something needs attention. */
export function SystemHealthBanner() {
  const { data } = useSystemStatus();
  if (!data || data.overall === "ok") return null;
  const issues = data.checks.filter((c) => c.level !== "ok");
  const worst = issues[0];
  return (
    <Link href="/status"
      className="mt-4 flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#0D0D0F] px-3 py-2 hover:border-[#3F3F46] transition-colors">
      <LevelIcon level={data.overall} />
      <span className="text-xs text-[#D4D4D8] flex-1 min-w-0 truncate">
        {worst.label}: {worst.detail}
        {issues.length > 1 ? <span className="text-[#71717A]"> · +{issues.length - 1} more</span> : null}
      </span>
      <span className="text-xs text-[#71717A] shrink-0">Status →</span>
    </Link>
  );
}

function fmt(ts: string | null) {
  if (!ts) return "never";
  const d = new Date(ts);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SystemStatusPage() {
  const { data, isLoading, refetch, isFetching } = useSystemStatus();
  if (isLoading || !data) return <div className="h-40 rounded-2xl bg-[#18181B] animate-pulse" />;
  const groups: [string, string][] = [["data", "Data freshness"], ["plan", "Plan"], ["system", "System"], ["jobs", "Failing jobs"]];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <LevelIcon level={data.overall} size={22} />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {data.overall === "ok" ? "All systems normal" : data.overall === "warn" ? "Needs a look" : "Something is broken"}
          </h1>
          <p className="text-xs text-[#71717A]">Checked {fmt(data.checked_at)}</p>
        </div>
        <button onClick={() => refetch()} className="text-xs text-[#71717A] hover:text-[#FAFAFA]">
          {isFetching ? "Checking…" : "Re-check"}
        </button>
      </div>

      {groups.map(([g, title]) => {
        const items = data.checks.filter((c) => c.group === g);
        if (items.length === 0) return null;
        return (
          <section key={g} className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-4">
            <p className="text-[10px] uppercase tracking-widest text-[#71717A] mb-2">{title}</p>
            <ul className="divide-y divide-[#18181B]">
              {items.map((c) => (
                <li key={c.key} className="flex items-center gap-3 py-2">
                  <LevelIcon level={c.level} />
                  <span className="text-sm text-[#E4E4E7] w-40 shrink-0 truncate">{c.label}</span>
                  <span className="text-xs text-[#A1A1AA] flex-1 min-w-0">{c.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-4">
        <p className="text-[10px] uppercase tracking-widest text-[#71717A] mb-2">Nightly jobs</p>
        {data.jobs.length === 0 ? (
          <p className="text-xs text-[#71717A]">No runs recorded yet — the next hourly sync fills this in.</p>
        ) : (
          <ul className="divide-y divide-[#18181B]">
            {data.jobs.map((j) => (
              <li key={j.job} className="py-2">
                <div className="flex items-center gap-3">
                  <LevelIcon level={j.level} />
                  <span className="text-sm text-[#E4E4E7] flex-1 min-w-0 truncate">
                    {j.label}{j.job.includes(":") ? <span className="text-[#52525B]"> · {j.job.split(":")[1]}</span> : null}
                  </span>
                  <span className="text-[11px] text-[#71717A] tabular-nums shrink-0">
                    {j.status === "ok" ? `OK ${fmt(j.last_run)}` : `failed ×${j.consecutive_failures} · last OK ${fmt(j.last_ok)}`}
                  </span>
                </div>
                {j.message && <p className="text-[11px] text-[#71717A] mt-1 ml-7 break-words">{j.message}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
