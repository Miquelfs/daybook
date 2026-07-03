"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, getDaysInMonth, getDay, addMonths, subMonths } from "date-fns";
import { Upload, ChevronLeft, ChevronRight, Loader2, X, ExternalLink, List, BarChart2, MapPin, TrendingUp, CalendarDays } from "lucide-react";
import Link from "next/link";
import { RosterPayEstimate } from "@/components/RosterPayEstimate";

interface RosterDay {
  date: string;
  duty_type: string;
  report_time: string | null;
  end_time: string | null;
  raw_code: string;
}

interface RosterLeg {
  flight_number: string;
  dep_iata: string;
  arr_iata: string;
  dep_time: string | null;
  arr_time: string | null;
  aircraft_type: string | null;
  cockpit_crew: string[];
  cabin_crew: string[];
  leg_order: number;
}

interface RosterDayDetail extends RosterDay {
  legs: RosterLeg[];
}

const DUTY_STYLE: Record<string, { bg: string; text: string; label: string; dot: string; sheetBg: string }> = {
  flying_duty: { bg: "bg-[#1a3a2a]", text: "text-[#4ADE80]", label: "Flying Duty",  dot: "bg-[#4ADE80]", sheetBg: "bg-[#1a3a2a]" },
  standby:     { bg: "bg-[#2a2a1a]", text: "text-[#FACC15]", label: "Standby",       dot: "bg-[#FACC15]", sheetBg: "bg-[#2a2a1a]" },
  day_off:     { bg: "bg-[#111113]", text: "text-[#52525B]", label: "Day Off",        dot: "bg-[#3F3F46]", sheetBg: "bg-[#111113]" },
  ground_duty: { bg: "bg-[#1a1a2e]", text: "text-[#818CF8]", label: "Ground Duty",   dot: "bg-[#818CF8]", sheetBg: "bg-[#1a1a2e]" },
  unknown:     { bg: "bg-[#1a1a1a]", text: "text-[#71717A]", label: "?",             dot: "bg-[#71717A]", sheetBg: "bg-[#1a1a1a]" },
};

const TODAY = new Date().toISOString().slice(0, 10);

function toYYYYMM(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Day Detail Sheet ───────────────────────────────────────────────────────────

function DayDetailSheet({
  date,
  onClose,
}: {
  date: string;
  onClose: () => void;
}) {
  const { data: detail, isLoading } = useQuery<RosterDayDetail | null>({
    queryKey: ["roster-day", date],
    queryFn: async () => {
      const res = await fetch(`/api/roster/day/${date}`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });

  const style = detail ? (DUTY_STYLE[detail.duty_type] ?? DUTY_STYLE.unknown) : DUTY_STYLE.unknown;
  const dateLabel = format(parseISO(date), "EEEE, d MMMM");

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto">
        <div className="bg-[#111113] rounded-t-2xl border border-[#27272A] border-b-0 overflow-hidden">

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
          </div>

          {/* Header */}
          <div className={`px-5 py-4 ${style.sheetBg} border-b border-[#27272A]`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[#71717A] mb-0.5">{dateLabel}</p>
                <p className={`text-lg font-semibold ${style.text}`}>{style.label}</p>
                {detail && (detail.report_time || detail.end_time) && (
                  <p className="text-sm text-[#A1A1AA] mt-1 tabular-nums">
                    {detail.report_time && <>C/I {detail.report_time}</>}
                    {detail.report_time && detail.end_time && <span className="mx-2 text-[#52525B]">·</span>}
                    {detail.end_time && <>C/O {detail.end_time}</>}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-black/20 transition-colors"
              >
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-5 pb-6 space-y-5 max-h-[60vh] overflow-y-auto">
            {isLoading && (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#52525B]" />
              </div>
            )}

            {!isLoading && detail && detail.legs.length > 0 && (
              <>
                {/* Flight legs */}
                <div className="pt-4 space-y-2">
                  {detail.legs.map((leg) => (
                    <div
                      key={`${leg.flight_number}-${leg.leg_order}`}
                      className="bg-[#18181B] rounded-xl px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-[#52525B]">{leg.flight_number}</span>
                          <span className={`text-sm font-semibold ${style.text} tabular-nums`}>
                            {leg.dep_iata} → {leg.arr_iata}
                          </span>
                        </div>
                        {leg.aircraft_type && (
                          <span className="text-xs text-[#52525B]">{leg.aircraft_type}</span>
                        )}
                      </div>
                      {(leg.dep_time || leg.arr_time) && (
                        <p className="text-xs text-[#71717A] mt-1 tabular-nums">
                          {leg.dep_time ?? "??"} – {leg.arr_time ?? "??"}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Crew — only from legs that have crew data */}
                {(() => {
                  const crewLeg = detail.legs.find(l => l.cockpit_crew.length > 0 || l.cabin_crew.length > 0);
                  if (!crewLeg) return null;
                  return (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-[#52525B] uppercase tracking-wider">Crew</p>

                      {crewLeg.cockpit_crew.length > 0 && (
                        <div>
                          <p className="text-[10px] text-[#52525B] uppercase tracking-wide mb-1.5">Cockpit</p>
                          <div className="space-y-1">
                            {crewLeg.cockpit_crew.map((name) => (
                              <p key={name} className="text-sm text-[#E4E4E7]">{name}</p>
                            ))}
                          </div>
                        </div>
                      )}

                      {crewLeg.cabin_crew.length > 0 && (
                        <div>
                          <p className="text-[10px] text-[#52525B] uppercase tracking-wide mb-1.5">Cabin</p>
                          <div className="space-y-1">
                            {crewLeg.cabin_crew.map((name) => (
                              <p key={name} className="text-sm text-[#A1A1AA]">{name}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {/* View in day journal link */}
            <div className="pt-2">
              <Link
                href={`/day/${date}`}
                onClick={onClose}
                className="flex items-center justify-between w-full bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded-xl px-4 py-3 transition-colors"
              >
                <span className="text-sm text-[#A1A1AA]">View in Day Journal</span>
                <ExternalLink size={14} className="text-[#52525B]" />
              </Link>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ── Roster Calendar ────────────────────────────────────────────────────────────

function RosterCalendar({
  month,
  days,
  onSelectDate,
}: {
  month: string;
  days: RosterDay[];
  onSelectDate: (date: string) => void;
}) {
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const [year, mon] = month.split("-").map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const totalDays = getDaysInMonth(firstDay);
  const startOffset = (getDay(firstDay) + 6) % 7; // Mon=0

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map((l) => (
          <div key={l} className="text-center text-xs text-[#52525B] py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} />;
          const dateStr = `${month}-${String(day).padStart(2, "0")}`;
          const row = byDate[dateStr];
          const style = row ? DUTY_STYLE[row.duty_type] ?? DUTY_STYLE.unknown : null;
          const isToday = dateStr === TODAY;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`
                relative rounded-lg p-1.5 min-h-[60px] flex flex-col gap-0.5 transition-colors text-left
                ${style ? style.bg : "bg-[#111113]"}
                ${isToday ? "ring-1 ring-[#F59E0B]" : ""}
                hover:brightness-125 active:scale-95
              `}
            >
              <span className={`text-xs font-medium tabular-nums ${style ? style.text : "text-[#3F3F46]"}`}>
                {day}
              </span>
              {row && (
                <>
                  <span className={`text-[10px] font-semibold ${style!.text} leading-tight`}>
                    {row.raw_code}
                  </span>
                  {row.report_time && (
                    <span className="text-[9px] text-[#71717A] leading-tight tabular-nums">
                      {row.report_time}
                    </span>
                  )}
                </>
              )}
              {!row && (
                <span className="text-[10px] text-[#27272A]">—</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3">
      {Object.entries(DUTY_STYLE)
        .filter(([k]) => k !== "unknown")
        .map(([key, s]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
            <span className="text-xs text-[#A1A1AA]">{s.label}</span>
          </div>
        ))}
    </div>
  );
}

function RosterStats({ days }: { days: RosterDay[] }) {
  const counts = days.reduce<Record<string, number>>((acc, d) => {
    acc[d.duty_type] = (acc[d.duty_type] ?? 0) + 1;
    return acc;
  }, {});

  if (days.length === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-2">
      {(["flying_duty", "standby", "day_off", "ground_duty"] as const).map((dt) => {
        const s = DUTY_STYLE[dt];
        return (
          <div key={dt} className={`${s.bg} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-bold tabular-nums ${s.text}`}>{counts[dt] ?? 0}</p>
            <p className="text-xs text-[#71717A] mt-0.5">{s.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RosterPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<string>(() => toYYYYMM(new Date()));

  const { data: months = [] } = useQuery<string[]>({
    queryKey: ["roster-months"],
    queryFn: async () => {
      const res = await fetch("/api/roster/months");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: rosterDays = [], isLoading } = useQuery<RosterDay[]>({
    queryKey: ["roster", currentMonth],
    queryFn: async () => {
      const res = await fetch(`/api/roster?month=${currentMonth}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    retry: 1,
  });

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/roster", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Upload failed");
      setUploadMsg(`Imported ${data.imported} days for ${data.period}`);
      setCurrentMonth(data.period);
      qc.invalidateQueries({ queryKey: ["roster"] });
      qc.invalidateQueries({ queryKey: ["roster-months"] });
    } catch (e: unknown) {
      setUploadMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  const closeSheet = useCallback(() => setSelectedDate(null), []);

  const prevMonth = toYYYYMM(subMonths(new Date(currentMonth + "-01"), 1));
  const nextMonth = toYYYYMM(addMonths(new Date(currentMonth + "-01"), 1));
  const monthLabel = format(new Date(currentMonth + "-01"), "MMMM yyyy");
  const hasData = rosterDays.length > 0;

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <Link href="/aviation" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest transition-colors inline-block mb-2">
              ← Logbook
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Duty Roster</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Monthly duty calendar</p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? "Importing…" : "Import PDF"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Aviation sub-nav */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 overflow-x-auto">
          <Link href="/aviation" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <List size={13} />Overview
          </Link>
          <Link href="/aviation" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <BarChart2 size={13} />Logbook
          </Link>
          <Link href="/aviation" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <MapPin size={13} />Routes
          </Link>
          <Link href="/aviation" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <TrendingUp size={13} />Analytics
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <CalendarDays size={13} />Roster
          </span>
        </div>

        {/* Upload toast */}
        {uploadMsg && (
          <div className={`rounded-xl px-4 py-3 text-sm ${uploadMsg.startsWith("Error") ? "bg-red-950 text-red-300 border border-red-800" : "bg-[#1a3a2a] text-[#4ADE80] border border-[#2d5a3d]"}`}>
            {uploadMsg}
          </div>
        )}

        {/* Month nav */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentMonth(prevMonth)}
            className="p-2 rounded-lg hover:bg-[#18181B] transition-colors"
          >
            <ChevronLeft size={18} className="text-[#A1A1AA]" />
          </button>
          <div className="text-center">
            <p className="font-semibold">{monthLabel}</p>
            {months.includes(currentMonth) && (
              <p className="text-xs text-[#52525B]">{rosterDays.length} days</p>
            )}
          </div>
          <button
            onClick={() => setCurrentMonth(nextMonth)}
            className="p-2 rounded-lg hover:bg-[#18181B] transition-colors"
          >
            <ChevronRight size={18} className="text-[#A1A1AA]" />
          </button>
        </div>

        {/* Stats */}
        {hasData && <RosterStats days={rosterDays} />}

        {/* Calendar */}
        {isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[#52525B]" />
          </div>
        ) : (
          <RosterCalendar
            month={currentMonth}
            days={rosterDays}
            onSelectDate={setSelectedDate}
          />
        )}

        {/* Empty state */}
        {!isLoading && !hasData && (
          <div className="text-center py-12 space-y-3">
            <p className="text-4xl">📋</p>
            <p className="text-[#A1A1AA] text-sm">No roster for {monthLabel}</p>
            <p className="text-[#52525B] text-xs">Tap "Import PDF" to upload your duty plan</p>
          </div>
        )}

        {/* Legend */}
        {hasData && (
          <div className="pt-2">
            <Legend />
          </div>
        )}

        {/* Pay estimate */}
        {hasData && (
          <RosterPayEstimate
            month={currentMonth}
            billedMonth={format(addMonths(new Date(currentMonth + "-01"), 1), "MMMM yyyy")}
          />
        )}

        {/* Month list */}
        {months.length > 0 && (
          <div className="pt-4 border-t border-[#18181B]">
            <p className="text-xs text-[#52525B] mb-2">Available rosters</p>
            <div className="flex flex-wrap gap-2">
              {months.map((m) => (
                <button
                  key={m}
                  onClick={() => setCurrentMonth(m)}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                    m === currentMonth
                      ? "bg-[#F59E0B] text-black font-semibold"
                      : "bg-[#18181B] text-[#A1A1AA] hover:bg-[#27272A]"
                  }`}
                >
                  {format(new Date(m + "-01"), "MMM yy")}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Day detail sheet */}
      {selectedDate && (
        <DayDetailSheet date={selectedDate} onClose={closeSheet} />
      )}
    </div>
  );
}
