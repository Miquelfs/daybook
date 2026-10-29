"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, getDaysInMonth, getDay, addMonths, subMonths } from "date-fns";
import { Upload, ChevronLeft, ChevronRight, Loader2, X, ExternalLink } from "lucide-react";
import Link from "next/link";
import { RosterPayEstimate } from "@/components/RosterPayEstimate";
import { AviationTabs } from "@/components/aviation/AviationTabs";
import {
  usePayEstimate, usePayJornada, useSavePayOverride, dayBadge, PER_DIEM_LABEL,
  type PayDay, type PerDiemType, type PayOverrideIn,
} from "@/lib/roster-pay";
import { localISODate } from "@/lib/dates";

interface RosterDay {
  date: string;
  duty_type: string;
  report_time: string | null;
  end_time: string | null;
  raw_code: string;
  edited_at: string | null;            // set by hand (a swap) — survives PDF re-imports
  imported_duty_type: string | null;   // what the PDF said
  imported_raw_code: string | null;
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

// Tile classes (duty-*) are defined in globals.css with a tuned pair per theme.
const DUTY_STYLE: Record<string, { cls: string; label: string; dot: string }> = {
  flying_duty: { cls: "duty-fly", label: "Flying Duty", dot: "bg-[#4ADE80]" },
  standby:     { cls: "duty-sby", label: "Standby",     dot: "bg-[#FACC15]" },
  day_off:     { cls: "duty-off", label: "Day Off",     dot: "bg-[#3F3F46]" },
  ground_duty: { cls: "duty-gnd", label: "Ground Duty", dot: "bg-[#818CF8]" },
  vacation:    { cls: "duty-vac", label: "Vacation",    dot: "bg-[#2DD4BF]" },
  unknown:     { cls: "duty-unk", label: "?",           dot: "bg-[#71717A]" },
};

const TODAY = localISODate();

function toYYYYMM(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Day Detail Sheet ───────────────────────────────────────────────────────────

// ── Pay corrections for one day ───────────────────────────────────────────────

const STATUS_TEXT: Record<string, string> = {
  activated: "Called out from standby — paid as flying, not as SBY.",
  not_flown: "Planned flying but nothing logged — swapped or cancelled?",
  extra_duty: "Flew on a day that wasn't planned as duty — swap, or a BDO?",
  changed: "Flew on a planned ground duty.",
};

function Choice<T extends string | number | null>({ label, value, auto, options, onChange }: {
  label: string;
  value: T | undefined;          // undefined = auto
  auto: string;
  options: { v: T; label: string }[];
  onChange: (v: T | undefined) => void;
}) {
  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-medium transition-colors ${active ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-[#71717A]">{label}</p>
      <div className="flex flex-wrap gap-1 bg-[#111113] border border-[#27272A] rounded-lg p-1">
        <button className={btn(value === undefined)} onClick={() => onChange(undefined)}>Auto · {auto}</button>
        {options.map(o => (
          <button key={String(o.v)} className={btn(value === o.v)} onClick={() => onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function PaySection({ day }: { day: PayDay }) {
  const save = useSavePayOverride();
  const o = day.override;
  const current: PayOverrideIn = {
    standby_paid: o.standby_paid == null ? null : !!o.standby_paid,
    per_diem: o.per_diem ?? null,
    positioning: o.positioning ?? null,
    bdo: o.bdo ?? null,
    note: o.note ?? null,
  };
  const [note, setNote] = useState(current.note ?? "");
  const put = (patch: Partial<PayOverrideIn>) => save.mutate({ date: day.date, body: { ...current, note: note || null, ...patch } });
  const und = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);
  const badge = dayBadge(day);
  const showStandby = day.planned === "standby" || day.activated || day.auto_standby_paid;
  const autoPd = day.auto_per_diem ? PER_DIEM_LABEL[day.auto_per_diem] : "none";

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-[#52525B] uppercase tracking-wider">Pay</p>
        {badge && <span className={`pay-badge pay-badge-${badge.tone} text-[10px] px-1.5 py-0.5`}>{badge.label}</span>}
        {day.projected && <span className="pay-badge pay-badge-mute text-[10px] px-1.5 py-0.5">Projected</span>}
        {save.isPending && <Loader2 size={12} className="animate-spin text-[#52525B]" />}
      </div>

      <div className="bg-[#18181B] rounded-xl px-4 py-3 space-y-1 text-xs">
        <p className="text-[#A1A1AA]">
          <span className="text-[#52525B]">Planned</span> {day.planned_code ?? "nothing"}
          <span className="text-[#52525B] mx-2">·</span>
          <span className="text-[#52525B]">{day.projected ? "Roster legs" : "Logged"}</span>{" "}
          {day.route ? `${day.route} (${day.block_hours.toFixed(2)} h)` : "no flights"}
        </p>
        {STATUS_TEXT[day.status] && <p className="text-[#71717A]">{STATUS_TEXT[day.status]}</p>}
        {day.sleeps_at && <p className="text-[#71717A]">Night away at {day.sleeps_at}.</p>}
      </div>

      {showStandby && (
        <Choice label="Standby (Guardia en base)" auto={day.auto_standby_paid ? "paid" : "not paid"}
          value={und(current.standby_paid === null ? null : current.standby_paid ? 1 : 0)}
          options={[{ v: 1, label: "Paid" }, { v: 0, label: "Not paid" }]}
          onChange={v => put({ standby_paid: v === undefined ? null : v === 1 })} />
      )}
      <Choice label="Dieta" auto={autoPd}
        value={und(current.per_diem)}
        options={[
          { v: "none" as const, label: "None" },
          ...(Object.keys(PER_DIEM_LABEL) as PerDiemType[]).map(k => ({ v: k, label: PER_DIEM_LABEL[k] })),
        ]}
        onChange={v => put({ per_diem: v ?? null })} />
      <Choice label="Positioning (Posicionamiento vuelo)" auto={String(day.auto_positioning)}
        value={und(current.positioning)}
        options={[{ v: 0, label: "0" }, { v: 1, label: "1" }, { v: 2, label: "2" }]}
        onChange={v => put({ positioning: v ?? null })} />
      <Choice label={`Bought day off${day.bdo_candidate ? " — worked a planned day off" : ""}`} auto="none"
        value={und(current.bdo)}
        options={[{ v: 1, label: "BDO" }, { v: 0.5, label: "½ BDO" }]}
        onChange={v => put({ bdo: v ?? null })} />

      <input value={note} onChange={e => setNote(e.target.value)} onBlur={() => note !== (current.note ?? "") && put({ note: note || null })}
        placeholder="Note (e.g. swapped with …)"
        className="w-full bg-[#111113] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B]" />
    </div>
  );
}

// The kinds a day can be set to by hand, with the raw code it gets.
const EDIT_KINDS: { duty: string; code: string; label: string; timed: boolean }[] = [
  { duty: "flying_duty", code: "FlD", label: "Flying",   timed: true },
  { duty: "standby",     code: "Sby", label: "Standby",  timed: true },
  { duty: "day_off",     code: "Off", label: "Day off",  timed: false },
  { duty: "vacation",    code: "VAC", label: "Vacation", timed: false },
  { duty: "ground_duty", code: "Dty", label: "Ground",   timed: true },
];
const KNOWN_CODES = new Set(["fld", "sby", "sbm", "sbs", "off", "do", "dty", "cbt", "grd", "sim", "trg", "vac"]);

const invalidateRoster = (qc: ReturnType<typeof useQueryClient>) =>
  ["roster", "roster-day", "roster-months", "roster-brief", "pay-estimate", "day-tags"]
    .forEach(k => qc.invalidateQueries({ queryKey: [k] }));

/** Change a day by hand — a swap (flight ↔ off ↔ standby), a vacation the PDF missed.
 *  Pay and Today follow at once; a later PDF import keeps the edit. */
function DutyEditor({ date, day }: { date: string; day: RosterDay | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rep, setRep] = useState(day?.report_time ?? "");
  const [end, setEnd] = useState(day?.end_time ?? "");
  // A code the parser didn't know (or one that came in wrong): offer to remember it.
  const code = day?.imported_raw_code ?? (day && !day.edited_at ? day.raw_code : null);
  const teachable = !!code && !KNOWN_CODES.has(code.trim().toLowerCase());
  const [teach, setTeach] = useState(teachable);

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(String(res.status));
      invalidateRoster(qc);
    } catch {
      setErr("Couldn't save — is the Pi reachable?");
    } finally {
      setBusy(null);
    }
  }
  const json = (method: string, body: unknown): RequestInit =>
    ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const set = (k: typeof EDIT_KINDS[number]) => {
    const keepTimes = k.timed && k.duty === day?.duty_type;
    return teachable && teach
      ? call(k.duty, `/api/roster/code-map/${encodeURIComponent(code!.trim())}`, json("PUT", { duty_type: k.duty }))
      : call(k.duty, "/api/roster/entry", json("POST", {
          date, duty_type: k.duty, raw_code: k.code,
          report_time: keepTimes ? rep || null : null, end_time: keepTimes ? end || null : null,
        }));
  };
  const saveTimes = () => day && call("times", "/api/roster/entry", json("POST", {
    date, duty_type: day.duty_type, raw_code: day.raw_code, report_time: rep || null, end_time: end || null,
  }));

  const current = day?.duty_type;
  const timed = EDIT_KINDS.find(k => k.duty === current)?.timed;
  const timeCls = "w-20 bg-[#111113] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm tabular-nums text-[#E4E4E7] focus:outline-none focus:border-[#F59E0B]";

  return (
    <div className="space-y-2.5 pt-4">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-[#52525B] uppercase tracking-wider">Duty</p>
        {busy && <Loader2 size={12} className="animate-spin text-[#52525B]" />}
      </div>
      {day?.edited_at ? (
        <p className="text-xs text-[#71717A]">
          Changed by hand{day.imported_raw_code ? <> — the PDF says <span className="font-mono">{day.imported_raw_code}</span></> : " — not on the PDF"}.{" "}
          <button className="text-[#F59E0B] hover:underline" disabled={!!busy}
                  onClick={() => call("revert", `/api/roster/revert/${date}`, { method: "POST" })}>
            {day.imported_raw_code ? "Revert" : "Remove"}
          </button>
        </p>
      ) : (
        <p className="text-xs text-[#71717A]">
          {!day ? "Not on the imported roster." : current === "unknown" ? <>Imported as <span className="font-mono">{day.raw_code}</span> — not a code Daybook knows.</> : "Swapped? Set what it really is:"}
        </p>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {EDIT_KINDS.map(k => {
          const s = DUTY_STYLE[k.duty];
          const on = current === k.duty;
          return (
            <button key={k.duty} disabled={!!busy} onClick={() => !on && set(k)}
                    className={`${s.cls} flex items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-medium border transition-[filter] hover:brightness-110 disabled:opacity-60 ${on ? "border-current" : "border-transparent opacity-70"}`}>
              {busy === k.duty && <Loader2 size={11} className="animate-spin" />}{k.label}
            </button>
          );
        })}
      </div>
      {teachable && (
        <label className="flex items-center gap-2 text-xs text-[#A1A1AA]">
          <input type="checkbox" checked={teach} onChange={e => setTeach(e.target.checked)} className="accent-[#F59E0B]" />
          Always read <span className="font-mono">{code}</span> this way (every day with it, and future imports)
        </label>
      )}
      {timed && (
        <div className="flex items-center gap-2 text-xs text-[#71717A]">
          C/I <input value={rep} onChange={e => setRep(e.target.value)} placeholder="HH:MM" className={timeCls} />
          C/O <input value={end} onChange={e => setEnd(e.target.value)} placeholder="HH:MM" className={timeCls} />
          {(rep !== (day?.report_time ?? "") || end !== (day?.end_time ?? "")) && (
            <button onClick={saveTimes} disabled={!!busy} className="text-xs font-medium text-[#F59E0B]">Save</button>
          )}
        </div>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
    </div>
  );
}

function DayDetailSheet({
  date,
  payDay,
  onClose,
}: {
  date: string;
  payDay?: PayDay;
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
          <div className={`px-5 py-4 ${style.cls} border-b border-[#27272A]`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs duty-sub mb-0.5">{dateLabel}</p>
                <p className="text-lg font-semibold">
                  {detail ? style.label : "Not on the roster"}
                  {detail?.edited_at && <span className="ml-2 text-xs font-normal duty-sub">⇄ swapped</span>}
                </p>
                {detail && (detail.report_time || detail.end_time) && (
                  <p className="text-sm duty-sub mt-1 tabular-nums">
                    {detail.report_time && <>C/I {detail.report_time}</>}
                    {detail.report_time && detail.end_time && <span className="mx-2">·</span>}
                    {detail.end_time && <>C/O {detail.end_time}</>}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-black/20 transition-colors"
              >
                <X size={16} className="duty-sub" />
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

            {!isLoading && detail && detail.legs.length > 0 && detail.duty_type !== "flying_duty" && (
              <p className="pt-4 text-xs text-[#71717A]">
                {detail.legs.length} planned leg{detail.legs.length > 1 ? "s" : ""} ({detail.legs.map(l => `${l.dep_iata}→${l.arr_iata}`).join(", ")}) — not flown under this duty.
              </p>
            )}

            {!isLoading && detail && detail.legs.length > 0 && detail.duty_type === "flying_duty" && (
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
                          <span className="text-sm font-semibold text-[#E4E4E7] tabular-nums">
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

            {!isLoading && <DutyEditor key={JSON.stringify(detail)} date={date} day={detail ?? null} />}

            {payDay && <PaySection key={JSON.stringify(payDay.override)} day={payDay} />}

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
  payDays,
  onSelectDate,
}: {
  month: string;
  days: RosterDay[];
  payDays: Record<string, PayDay>;
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
          const style = row ? DUTY_STYLE[row.duty_type] ?? DUTY_STYLE.unknown : null;   // not on the roster ≠ off
          const isToday = dateStr === TODAY;
          const pd = payDays[dateStr];
          const badge = pd ? dayBadge(pd) : null;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              className={`
                relative rounded-lg p-1.5 min-h-[64px] flex flex-col gap-0.5 transition-[filter,transform] text-left
                ${style ? style.cls : "border border-dashed border-[#27272A] text-[#52525B]"}
                ${isToday ? "ring-2 ring-[#F59E0B]" : ""}
                ${pd?.status === "not_flown" ? "opacity-60" : ""}
                hover:brightness-110 active:scale-95
              `}
            >
              <span className="text-xs font-medium tabular-nums">{day}</span>
              {row ? (
                <>
                  <span className={`text-[10px] font-semibold leading-tight ${pd?.status === "not_flown" ? "line-through" : ""}`}>
                    {row.raw_code}{row.edited_at && <span title={`Changed by hand${row.imported_raw_code ? ` — PDF: ${row.imported_raw_code}` : ""}`}> ⇄</span>}
                  </span>
                  {row.report_time && (
                    <span className="text-[9px] duty-sub leading-tight tabular-nums">{row.report_time}</span>
                  )}
                </>
              ) : (
                <span className="text-[10px] duty-sub">—</span>
              )}
              {badge && (
                <span className={`pay-badge pay-badge-${badge.tone} text-[9px] px-1 py-px mt-auto self-start`}>{badge.label}</span>
              )}
              {pd && Object.keys(pd.override).length > 0 && (
                <span className="absolute top-1 right-1.5 text-[9px] text-[#F59E0B]" title="Pay edited">✎</span>
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
    <div className={`grid ${counts.vacation ? "grid-cols-5" : "grid-cols-4"} gap-2`}>
      {(["flying_duty", "standby", "day_off", "ground_duty", "vacation"] as const).filter(dt => dt !== "vacation" || counts.vacation).map((dt) => {
        const s = DUTY_STYLE[dt];
        return (
          <div key={dt} className={`${s.cls} rounded-xl p-3 text-center`}>
            <p className="text-2xl font-bold tabular-nums">{counts[dt] ?? 0}</p>
            <p className="text-xs duty-sub mt-0.5">{s.label}</p>
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

  const payQuery = usePayEstimate(currentMonth, { enabled: hasData });
  const { data: jornada } = usePayJornada();
  const monthPct = jornada ? (jornada.months[currentMonth] ?? jornada.default) : null;
  const payDays = Object.fromEntries((payQuery.data?.days ?? []).map((d) => [d.date, d]));

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
        <AviationTabs active="roster" />

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
              <p className="text-xs text-[#52525B]">
                {rosterDays.length} days{monthPct != null && monthPct < 100 ? ` · ${monthPct}% jornada` : ""}
              </p>
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
            payDays={payDays}
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
            data={payQuery.data}
            isLoading={payQuery.isLoading}
            error={payQuery.error}
            onSelectDate={setSelectedDate}
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
        <DayDetailSheet date={selectedDate} payDay={payDays[selectedDate]} onClose={closeSheet} />
      )}
    </div>
  );
}
