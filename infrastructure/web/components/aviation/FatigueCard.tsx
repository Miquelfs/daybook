"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Block, Panel, Skeleton } from "@/components/ui/kit";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Group = { n: number; sleep_before: number | null; score_before: number | null; hrv: number | null;
               stress: number | null; sleep_after: number | null; hrv_after: number | null };
type Fatigue = {
  days: number; off: Group; buckets: (Group & { label: string })[]; findings: string[];
  short_rest: { date: string; rest_h: number; report: string; sleep_before: number | null }[];
  ahead: { date: string; text: string }[];
};

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const v = (x: number | null, unit = "") => (x == null ? "—" : `${x}${unit}`);

/** Roster × body: sleep, HRV and stress by report time vs days off; short rests; what's ahead. */
export function FatigueCard() {
  const { data } = useQuery<Fatigue>({
    queryKey: ["roster-fatigue"],
    queryFn: () => fetch(`${BASE}/roster/fatigue`).then((r) => r.json()),
    staleTime: 600_000,
  });
  if (!data) return <Skeleton h={220} />;
  if (!data.days) return null;
  const rows = [...data.buckets, { label: "Day off", ...data.off }];

  return (
    <Block title="Roster & fatigue">
      <Panel className="p-4 space-y-4">
        {data.ahead.length > 0 && (
          <div className="space-y-1.5">
            {data.ahead.map((a) => (
              <Link key={a.date + a.text} href={`/day/${a.date}`} className="flex items-start gap-2 text-sm hover:opacity-80">
                <AlertTriangle size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
                <span><span className="text-[#FAFAFA]">{day(a.date)}</span> <span className="text-[#A1A1AA]">· {a.text}</span></span>
              </Link>
            ))}
          </div>
        )}

        {data.findings.length > 0 && (
          <ul className="space-y-1">
            {data.findings.map((f) => <li key={f} className="text-sm text-[#A1A1AA]">{f}</li>)}
          </ul>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[#52525B] text-left">
                <th className="font-normal py-1.5">Report</th>
                <th className="font-normal text-right">Days</th>
                <th className="font-normal text-right">Sleep before</th>
                <th className="font-normal text-right">HRV</th>
                <th className="font-normal text-right">Stress</th>
                <th className="font-normal text-right">Sleep after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#18181B]">
              {rows.map((r) => {
                const short = r.sleep_before != null && data.off.sleep_before != null && r.sleep_before < data.off.sleep_before - 0.5;
                return (
                  <tr key={r.label} className={r.label === "Day off" ? "text-[#71717A]" : "text-[#D4D4D8]"}>
                    <td className="py-2">{r.label}</td>
                    <td className="text-right">{r.n}</td>
                    <td className={`text-right ${short ? "text-[#F59E0B]" : ""}`}>{v(r.sleep_before, " h")}</td>
                    <td className="text-right">{v(r.hrv)}</td>
                    <td className="text-right">{v(r.stress)}</td>
                    <td className="text-right">{v(r.sleep_after, " h")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data.short_rest.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#52525B] mb-1">Short rests (under 12 h)</p>
            {data.short_rest.map((s) => (
              <Link key={s.date} href={`/day/${s.date}`} className="flex justify-between text-xs py-1 text-[#A1A1AA] hover:text-[#FAFAFA]">
                <span>{day(s.date)} · report {s.report}</span>
                <span className="tabular-nums">{s.rest_h} h rest{ s.sleep_before != null ? ` · slept ${s.sleep_before} h` : ""}</span>
              </Link>
            ))}
          </div>
        )}
        <p className="text-[11px] text-[#52525B]">
          Sleep before = the night ending that morning; HRV = that morning; sleep after = the next night. {data.days} rostered days.
        </p>
      </Panel>
    </Block>
  );
}
