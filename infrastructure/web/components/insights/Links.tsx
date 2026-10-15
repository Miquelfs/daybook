"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Link = {
  metric_a: string; metric_b: string; driver: string; outcome: string; outcome_label: string;
  sentence: string; effect: string | null; r: number; n: number; lag: number; q: number | null;
  strength: "strong" | "moderate" | "weak"; good: boolean | null; is_new: boolean;
  consistent: boolean | null; category: string;
};
type Resp = {
  computed_at: string | null; window: number; other_window: number | null;
  links: Link[]; outcomes: { key: string; label: string; count: number }[];
};

const STRENGTH_BARS = { weak: 1, moderate: 2, strong: 3 } as const;

/** Discover feed: what moves your outcomes, in plain language with real units. */
export function Links({ onPick }: { onPick: (a: string, b: string) => void }) {
  const [windowDays, setWindowDays] = useState(90);
  const [outcome, setOutcome] = useState("");
  const [visible, setVisible] = useState(8);
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["corr-links", windowDays, outcome],
    queryFn: () =>
      fetch(`${BASE}/correlations/links?window=${windowDays}&outcome=${outcome}`, { cache: "no-store" }).then((r) => r.json()),
  });
  const links = data?.links ?? [];

  return (
    <section className="rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#71717A] flex items-center gap-1.5">
            <Sparkles size={12} className="text-[#F59E0B]" /> Links in your data
          </p>
          <p className="text-xs text-[#71717A] mt-1">
            Only links that pass a false-discovery check are shown, and pairs that measure the same thing twice are
            left out. Tap one to see the chart.
          </p>
        </div>
        <div className="flex rounded-lg border border-[#27272A] p-0.5 shrink-0">
          {[90, 180].map((w) => (
            <button key={w} onClick={() => { setWindowDays(w); setVisible(8); }}
              className={`px-2.5 py-1 text-[11px] rounded-md ${windowDays === w ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A]"}`}>
              {w}d
            </button>
          ))}
        </div>
      </div>

      {(data?.outcomes.length ?? 0) > 0 && (
        <div className="flex gap-1.5 mt-3 mb-1 overflow-x-auto pb-1 -mx-1 px-1">
          {[{ key: "", label: "All", count: 0 }, ...data!.outcomes].map((o) => (
            <button key={o.key} onClick={() => { setOutcome(o.key); setVisible(8); }}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                outcome === o.key ? "bg-[#F59E0B]/15 border-[#F59E0B]/40 text-[#F59E0B]"
                  : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"}`}>
              {o.label}{o.key ? <span className="opacity-60"> {o.count}</span> : null}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="h-32 rounded-xl bg-[#18181B] animate-pulse mt-3" />
      ) : !data?.computed_at ? (
        <p className="text-sm text-[#71717A] mt-3">The daily analysis hasn't run yet. It runs once a day overnight.</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-[#71717A] mt-3">
          Nothing passed the check in the last {windowDays} days. That's the check working: with less data only strong
          patterns survive.{windowDays === 90 ? " Try 180 days." : ""}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[#18181B]">
          {links.slice(0, visible).map((l) => (
            <li key={`${l.metric_a}|${l.metric_b}|${l.lag}`}>
              <button onClick={() => onPick(l.metric_a, l.metric_b)} className="w-full text-left py-3 flex items-start gap-3 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#E4E4E7] group-hover:text-[#FAFAFA]">{l.sentence}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[10px] text-[#71717A]">
                    {l.consistent && (
                      <span className="inline-flex items-center gap-0.5 text-[#4ADE80]"><Check size={10} /> holds in 90 & 180 days</span>
                    )}
                    {l.consistent === false && <span>only in {windowDays} days</span>}
                    {l.is_new && <span className="text-[#F59E0B]">new</span>}
                    <span className="tabular-nums">{l.n} days</span>
                    <span className="tabular-nums">r {l.r > 0 ? "+" : ""}{l.r.toFixed(2)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {l.effect ? (
                    <p className={`text-base font-semibold tabular-nums ${
                      l.good == null ? "text-[#A1A1AA]" : l.good ? "text-[#4ADE80]" : "text-[#F87171]"}`}>{l.effect}</p>
                  ) : (
                    <p className="text-xs text-[#71717A] mt-1">{l.r > 0 ? "move together" : "move opposite"}</p>
                  )}
                  <div className="flex gap-0.5 justify-end mt-1.5" title={l.strength}>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className="w-3 h-1 rounded-full" style={{
                        background: i <= STRENGTH_BARS[l.strength]
                          ? (l.good == null ? "#A1A1AA" : l.good ? "#4ADE80" : "#F87171") : "#27272A",
                      }} />
                    ))}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {links.length > visible && (
        <button onClick={() => setVisible((v) => v + 10)}
          className="w-full mt-2 py-2 text-xs text-[#71717A] hover:text-[#A1A1AA] border border-dashed border-[#27272A] rounded-xl">
          Show {Math.min(10, links.length - visible)} more
        </button>
      )}
    </section>
  );
}
