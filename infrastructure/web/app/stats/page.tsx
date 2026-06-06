"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { activityIcon } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const YEAR = new Date().getFullYear();

function StatCard({ label, value, sub, href }: { label: string; value: string; sub?: string; href: string }) {
  return (
    <Link href={href} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-[#3F3F46] transition-colors block">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </Link>
  );
}

export default function StatsHub() {
  const { data: year } = useQuery({
    queryKey: ["year-stats", YEAR],
    queryFn: () => fetch(`${BASE}/stats/year/${YEAR}`).then(r => r.json()),
  });

  const { data: effort } = useQuery({
    queryKey: ["relative-effort"],
    queryFn: () => fetch(`${BASE}/stats/relative-effort?weeks=6`).then(r => r.json()),
  });

  const { data: prs = [] } = useQuery({
    queryKey: ["best-efforts"],
    queryFn: () => fetch(`${BASE}/stats/best-efforts`).then(r => r.json()),
  });

  const verdictColor: Record<string, string> = {
    "trending higher": "text-emerald-400",
    "steady": "text-blue-400",
    "trending lower": "text-amber-400",
    "detraining": "text-red-400",
  };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Your Strava Premium replacement</p>
      </div>

      {/* Year totals */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">{YEAR} year to date</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Distance" value={`${year?.totals?.km ?? "—"} km`} sub={`${year?.totals?.activities ?? 0} activities`} href={`/stats/year/${YEAR}`} />
          <StatCard label="Time" value={`${year?.totals?.hours ?? "—"}h`} sub="moving time" href={`/stats/year/${YEAR}`} />
          <StatCard label="PRs" value={`${year?.totals?.personal_records ?? "—"}`} sub="personal records set" href="/stats/best-efforts" />
          <StatCard label="Volume chart" value="→" sub="weekly / monthly" href="/stats/volume" />
        </div>
      </section>

      {/* Training status */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Training status</h2>
        <Link href="/stats/relative-effort" className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 hover:border-[#3F3F46] transition-colors block">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">This week vs trailing avg</p>
              <p className={`text-lg font-semibold capitalize ${verdictColor[effort?.verdict ?? ""] ?? "text-[#FAFAFA]"}`}>
                {effort?.verdict ?? "—"}
              </p>
            </div>
            <div className="flex gap-1 items-end h-12">
              {(effort?.weeks ?? []).map((w: { week: string; load: number }, i: number) => {
                const max = Math.max(...(effort?.weeks ?? []).map((x: { load: number }) => x.load || 0), 1);
                const h = Math.round(((w.load || 0) / max) * 40);
                const isLast = i === (effort?.weeks?.length ?? 0) - 1;
                return (
                  <div key={w.week} className="w-5 rounded-t" style={{
                    height: `${h}px`,
                    background: isLast ? "#F59E0B" : "#27272A",
                    minHeight: "2px",
                  }} />
                );
              })}
            </div>
          </div>
        </Link>
      </section>

      {/* Best efforts preview */}
      {prs.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Best efforts</h2>
            <Link href="/stats/best-efforts" className="text-xs text-[#F59E0B] hover:text-[#FCD34D] uppercase tracking-widest">
              All →
            </Link>
          </div>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
            {prs.slice(0, 5).map((pr: { target_label: string; duration_seconds: number; date: string; activity_name: string | null }) => {
              const s = Math.round(pr.duration_seconds);
              const h = Math.floor(s / 3600);
              const m = Math.floor((s % 3600) / 60);
              const sec = s % 60;
              const time = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
              return (
                <div key={pr.target_label} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm text-[#FAFAFA]">{pr.target_label}</p>
                    <p className="text-xs text-[#52525B]">{format(new Date(pr.date), "d MMM yyyy")} · {pr.activity_name ?? "Run"}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-[#FAFAFA]">{time}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Navigation links */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Views</h2>
        <div className="flex flex-col divide-y divide-[#18181B]">
          {[
            { href: "/stats/volume", label: "Volume chart", sub: "Weekly & monthly distance/time/elevation" },
            { href: "/stats/best-efforts", label: "Best efforts", sub: "All-time PRs across standard distances" },
            { href: `/stats/year/${YEAR}`, label: "Year calendar", sub: `${YEAR} training calendar` },
            { href: "/stats/relative-effort", label: "Relative effort", sub: "Training load trend last 6 weeks" },
            { href: "/stats/heatmap", label: "Activity heatmap", sub: "GitHub-style training calendar" },
            { href: "/stats/fitness-curve", label: "Fitness curve", sub: "CTL · ATL · TSB — form & fatigue" },
            { href: "/stats/performance-trend", label: "Performance trend", sub: "Are you getting faster?" },
            { href: "/health/correlation", label: "Recovery & performance", sub: "HRV and sleep vs running pace" },
            { href: "/training", label: "Training dashboard", sub: "Load, segments, activity log" },
            { href: "/explore", label: "Route map", sub: "All GPS tracks on a map" },
          ].map(({ href, label, sub }) => (
            <Link key={href} href={href} className="flex items-center justify-between py-3 hover:bg-[#0D0D0F] rounded-lg px-2 -mx-2 transition-colors">
              <div>
                <p className="text-sm text-[#FAFAFA]">{label}</p>
                <p className="text-xs text-[#52525B]">{sub}</p>
              </div>
              <span className="text-[#52525B]">→</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
