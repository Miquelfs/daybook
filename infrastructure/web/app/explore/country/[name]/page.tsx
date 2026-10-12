"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronDown, Luggage } from "lucide-react";
import { api } from "@/lib/api";
import type { CountryStay } from "@/lib/api";
import { FLAG } from "@/lib/flags";

const DAYS_PREVIEW = 14; // day chips shown before "show all" on long stays

const moodEmoji = (m: number | null) => {
  if (!m) return null;
  if (m >= 9) return "🌟";
  if (m >= 7) return "😊";
  if (m >= 5) return "😐";
  if (m >= 3) return "😕";
  return "😔";
};

const d12 = (d: string) => new Date(d + "T12:00:00");

function formatDate(d: string) {
  return d12(d).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function formatRange(start: string, end: string) {
  const a = d12(start);
  const b = d12(end);
  if (start === end) return a.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" });
  const right = b.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const yearSuffix = a.getFullYear() !== b.getFullYear() ? ` ${b.getFullYear()}` : "";
  return `${left} – ${right}${yearSuffix}`;
}

export default function CountryPage() {
  const { name } = useParams<{ name: string }>();
  const country = decodeURIComponent(name);
  const [year, setYear] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["country-visits", country],
    queryFn: () => api.countryVisits(country),
  });

  const stays = data?.stays ?? [];
  const years = useMemo(
    () => Array.from(new Set(stays.map((s) => s.start.slice(0, 4)))),
    [stays],
  );
  const shown = year ? stays.filter((s) => s.start.slice(0, 4) === year) : stays;

  // Group by the year each stay started in (stays are newest first already)
  const groups = useMemo(() => {
    const g: { year: string; stays: CountryStay[] }[] = [];
    for (const s of shown) {
      const y = s.start.slice(0, 4);
      if (g.length === 0 || g[g.length - 1].year !== y) g.push({ year: y, stays: [] });
      g[g.length - 1].stays.push(s);
    }
    return g;
  }, [shown]);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/explore"
        className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-6"
      >
        <ChevronLeft size={12} /> Explore
      </Link>

      <h1 className="text-2xl font-semibold text-[#FAFAFA] mb-6 flex items-center gap-2">
        <span>{FLAG[country] ?? "🌍"}</span>
        <span>{country}</span>
      </h1>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-[#52525B]">Loading…</div>
      ) : !data || data.total_days === 0 ? (
        <p className="text-sm text-[#52525B]">No recorded days here yet.</p>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Days</p>
              <p className="text-2xl font-semibold text-[#F59E0B] tabular-nums">{data.total_days}</p>
              <p className="text-xs text-[#52525B] mt-0.5">{data.total_days === 1 ? "day" : "days"} recorded</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Times</p>
              <p className="text-2xl font-semibold text-[#F59E0B] tabular-nums">{stays.length}</p>
              <p className="text-xs text-[#52525B] mt-0.5">separate {stays.length === 1 ? "stay" : "stays"}</p>
            </div>
          </div>

          {/* First / last visit */}
          {data.first_visit && data.last_visit && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              {[["First visit", data.first_visit], ["Last visit", data.last_visit]].map(([label, d]) => (
                <Link
                  key={label}
                  href={`/day/${d}`}
                  className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 hover:border-[#3F3F46] transition-colors group"
                >
                  <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
                  <p className="text-sm text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">
                    {formatDate(d)} →
                  </p>
                </Link>
              ))}
            </div>
          )}

          {/* Year filter */}
          {years.length > 1 && (
            <div className="flex gap-1.5 flex-wrap mb-6">
              {[null, ...years].map((y) => (
                <button
                  key={y ?? "all"}
                  onClick={() => setYear(y)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    year === y
                      ? "border-[#F59E0B]/50 bg-[#F59E0B]/10 text-[#F59E0B]"
                      : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
                  }`}
                >
                  {y ?? "All"}
                </button>
              ))}
            </div>
          )}

          {/* Stays, grouped by year */}
          <div className="flex flex-col gap-8">
            {groups.map((g) => (
              <section key={g.year}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-xs text-[#52525B] uppercase tracking-widest">{g.year}</h2>
                  <span className="text-xs text-[#3F3F46] tabular-nums">
                    {g.stays.reduce((n, s) => n + s.n_days, 0)}d
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {g.stays.map((s) => <StayCard key={s.start} stay={s} />)}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function StayCard({ stay }: { stay: CountryStay }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  // Days come newest first from the API; show them chronologically in the card.
  const days = [...stay.days].reverse();
  const visible = all ? days : days.slice(0, DAYS_PREVIEW);

  return (
    <div className="rounded-xl bg-[#0D0D0F] border border-[#27272A] overflow-hidden">
      <div className="flex items-stretch">
        {/* Single-day stays jump straight to the day; longer ones expand */}
        {stay.n_days === 1 ? (
          <Link
            href={`/day/${stay.start}`}
            className="flex-1 min-w-0 px-4 py-3 hover:bg-[#18181B] transition-colors group"
          >
            <StayHeader stay={stay} />
          </Link>
        ) : (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex-1 min-w-0 px-4 py-3 text-left hover:bg-[#18181B] transition-colors flex items-start gap-2 group"
            aria-expanded={open}
          >
            <div className="flex-1 min-w-0"><StayHeader stay={stay} /></div>
            <ChevronDown
              size={14}
              className={`mt-1 shrink-0 text-[#52525B] transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-[#1F1F23]">
          {stay.trip && (
            <Link
              href={`/explore/trip/${stay.trip.start_date}/${stay.trip.end_date}`}
              className="inline-flex items-center gap-1.5 text-xs text-[#38BDF8] hover:underline mb-2.5 mt-1.5"
            >
              <Luggage size={12} /> {stay.trip.name} →
            </Link>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {visible.map((d) => (
              <Link
                key={d.date}
                href={`/day/${d.date}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#27272A] text-xs text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors tabular-nums"
              >
                {d12(d.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                {d.mood ? <span>{moodEmoji(d.mood)}</span> : null}
              </Link>
            ))}
            {!all && days.length > DAYS_PREVIEW && (
              <button
                onClick={() => setAll(true)}
                className="px-2.5 py-1 rounded-lg text-xs text-[#71717A] hover:text-[#FAFAFA]"
              >
                +{days.length - DAYS_PREVIEW} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StayHeader({ stay }: { stay: CountryStay }) {
  return (
    <>
      <div className="flex items-baseline gap-2">
        <p className="text-sm text-[#D4D4D8] group-hover:text-[#FAFAFA] transition-colors">
          {formatRange(stay.start, stay.end)}
        </p>
        <span className="text-xs text-[#52525B] tabular-nums">
          {stay.n_days} {stay.n_days === 1 ? "day" : "days"}
        </span>
        {stay.trip && <Luggage size={11} className="text-[#38BDF8] self-center" />}
      </div>
      {stay.cities.length > 0 && (
        <p className="text-xs text-[#71717A] mt-0.5 truncate">{stay.cities.join(" · ")}</p>
      )}
    </>
  );
}
