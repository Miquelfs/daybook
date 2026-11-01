"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Bike, Check, ExternalLink, MapPin, Moon, Plus, Trash2, Upload, Wallet } from "lucide-react";
import { plansApi, type PlannedTripDetail, type TripBoard as Board, type TripBoardDay, type TripItem } from "@/lib/plans-api";
import { Sheet, Field, inputCls } from "@/components/plan/Sheet";
import { Chip, Label, Panel } from "@/components/ui/kit";
import { GradeProfile, StageStrip, hmLong } from "@/components/training/StageProfile";

const eur = (n: number) => `€${n.toLocaleString("en-GB", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
const localSign = (cur: string | null) => (cur === "NTD" || cur === "TWD" ? "NT$" : cur ? `${cur} ` : "");
const short = (d: string) => format(parseISO(d), "d MMM");
const kinds = (it: TripItem) => (it.kinds ?? "").split(",").map((k) => k.trim()).filter(Boolean);

/** Price as the card shows it: € when known, the local price beside it. */
function price(it: TripItem, cur: string | null) {
  const parts = [];
  if (it.price_eur) parts.push(eur(it.price_eur));
  if (it.price_local) parts.push(`${localSign(cur)}${it.price_local.toLocaleString("en-GB")}`);
  if (!parts.length && it.paid_eur) parts.push(eur(it.paid_eur));
  return parts.join(" · ");
}

function refreshKeys(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: ["trip-board", id] });
  qc.invalidateQueries({ queryKey: ["planned-trip", id] });
}

/** One card on the board — tap to edit, tick to mark booked. */
function Card({ it, trip, onEdit }: { it: TripItem; trip: PlannedTripDetail; onEdit: (it: TripItem) => void }) {
  const qc = useQueryClient();
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    await plansApi.updateTripItem(it.id, { booked: !it.booked });
    refreshKeys(qc, trip.id);
  }
  const p = price(it, trip.currency);
  return (
    <div role="button" tabIndex={0} onClick={() => onEdit(it)} onKeyDown={(e) => { if (e.key === "Enter") onEdit(it); }}
         className="w-full text-left bg-[#18181B] hover:bg-[#1F1F23] rounded-xl px-3 py-2.5 space-y-1.5 cursor-pointer transition-colors">
      <p className="text-sm font-medium text-[#FAFAFA] leading-snug">{it.name}</p>
      <div className="flex flex-wrap items-center gap-1">
        {kinds(it).map((k) => <Chip key={k}>{k}</Chip>)}
        {it.date && (
          <span className="text-xs text-[#71717A] tabular-nums">{short(it.date)}{it.end_date ? ` → ${short(it.end_date)}` : ""}</span>
        )}
      </div>
      {p && <p className="text-xs text-[#A1A1AA] tabular-nums">{p}</p>}
      {it.place && (
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.place)}`} target="_blank" rel="noreferrer"
           onClick={(e) => e.stopPropagation()}
           className="flex items-start gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA]">
          <MapPin size={12} className="shrink-0 mt-0.5" /><span className="line-clamp-2">{it.place}</span>
        </a>
      )}
      {it.notes && <p className="text-xs text-[#71717A] line-clamp-3">{it.notes}</p>}
      <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-[#A1A1AA]">
        <span className={`w-4 h-4 rounded border flex items-center justify-center ${it.booked
          ? "bg-[#F59E0B] border-[#F59E0B] text-black" : "border-[#3F3F46]"}`}>
          {it.booked && <Check size={11} strokeWidth={3} />}
        </span>
        Booked
      </button>
    </div>
  );
}

/** The day's planned ride as a card: stage strip, and what was ridden once it's done. */
function RideCard({ ride }: { ride: NonNullable<TripBoardDay["ride"]> }) {
  const c = ride.planned?.course;
  return (
    <div className="bg-[#18181B] rounded-xl px-3 py-2.5 space-y-1.5">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#52525B]"><Bike size={12} /> Ride</p>
      {c ? <StageStrip course={c} /> : ride.planned && (
        <p className="text-xs text-[#A1A1AA]">{ride.planned.type} · {hmLong(ride.planned.minutes)} · {ride.planned.zone}</p>
      )}
      {ride.ridden && (
        <Link href={`/activity/${ride.ridden.activity_id}`} className="block text-xs text-emerald-400 hover:underline tabular-nums">
          ✓ ridden {ride.ridden.km} km · +{ride.ridden.climb_m} m{c ? ` of ${c.km} km planned` : ""}
        </Link>
      )}
    </div>
  );
}

function Column({ title, sub, href, children, onAdd }: {
  title: string; sub?: string; href?: string; children: React.ReactNode; onAdd?: () => void;
}) {
  return (
    <div className="snap-start shrink-0 w-[17rem] bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-2.5 flex flex-col gap-2 self-start">
      <div className="px-1 pt-0.5">
        {href ? <Link href={href} className="text-xs font-medium text-[#FAFAFA] hover:underline">{title}</Link>
              : <p className="text-xs font-medium text-[#FAFAFA]">{title}</p>}
        {sub && <p className="text-[10px] uppercase tracking-widest text-[#52525B] mt-0.5">{sub}</p>}
      </div>
      {children}
      {onAdd && (
        <button onClick={onAdd} className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA]">
          <Plus size={13} /> New card
        </button>
      )}
    </div>
  );
}

/** Notion-style board: a column per day of the trip, the cards that belong to it. */
export function TripBoardView({ trip, board }: { trip: PlannedTripDetail; board: Board }) {
  const [editing, setEditing] = useState<TripItem | { date: string | null } | null>(null);
  return (
    <>
      <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:thin]">
        {(board.before.length > 0) && (
          <Column title="Before you go" sub={`${board.before.length} cards`} onAdd={() => setEditing({ date: null })}>
            {board.before.map((it) => <Card key={it.id} it={it} trip={trip} onEdit={setEditing} />)}
          </Column>
        )}
        {board.days.map((d, i) => (
          <Column key={d.date} title={`Day ${i + 1}${d.note ? ` · ${d.note}` : ""}`} sub={format(parseISO(d.date), "EEE d MMM")}
                  href={`/day/${d.date}`} onAdd={() => setEditing({ date: d.date })}>
            {d.ride && <RideCard ride={d.ride} />}
            {d.items.map((it) => <Card key={it.id} it={it} trip={trip} onEdit={setEditing} />)}
          </Column>
        ))}
        {board.after.length > 0 && (
          <Column title="After" sub={`${board.after.length} cards`}>
            {board.after.map((it) => <Card key={it.id} it={it} trip={trip} onEdit={setEditing} />)}
          </Column>
        )}
      </div>
      {editing && <ItemSheet trip={trip} item={"id" in editing ? editing : undefined}
                             defaultDate={"id" in editing ? null : editing.date} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Day by day: the cards, the ride (planned → ridden), the night's sleep and what you spent. */
export function TripDaysView({ trip, board }: { trip: PlannedTripDetail; board: Board }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {board.days.map((d, i) => {
        const spent = d.spend.reduce((s, t) => s + t.eur, 0);
        const c = d.ride?.planned?.course;
        return (
          <Panel key={d.date} className="p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/day/${d.date}`} className="min-w-0 hover:underline">
                <span className="text-sm font-medium text-[#FAFAFA]">Day {i + 1}{d.note ? ` · ${d.note}` : ""}</span>
              </Link>
              <span className="text-xs text-[#71717A] tabular-nums shrink-0">{format(parseISO(d.date), "EEE d MMM")}</span>
            </div>
            {c?.profile && c.profile.length > 2 && <GradeProfile profile={c.profile} compact height={40} />}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#18181B] rounded-xl px-3 py-2 min-w-0">
                <Label>Ride</Label>
                {d.ride?.ridden ? (
                  <Link href={`/activity/${d.ride.ridden.activity_id}`} className="block text-sm font-semibold tabular-nums hover:underline truncate">
                    {d.ride.ridden.km} km
                  </Link>
                ) : <p className="text-sm font-semibold tabular-nums truncate">{c ? `${c.km} km` : d.ride?.planned ? hmLong(d.ride.planned.minutes) : "—"}</p>}
                <p className="text-[11px] text-[#71717A] truncate">
                  {d.ride?.ridden && c ? `of ${c.km} planned` : c ? `+${c.climb_m} m planned` : d.ride?.planned?.type ?? "rest"}
                </p>
              </div>
              <div className="bg-[#18181B] rounded-xl px-3 py-2 min-w-0">
                <Label><span className="inline-flex items-center gap-1"><Moon size={10} /> Sleep</span></Label>
                <p className="text-sm font-semibold tabular-nums">{d.sleep ? `${d.sleep.hours} h` : "—"}</p>
                <p className="text-[11px] text-[#71717A]">{d.sleep?.score ? `score ${d.sleep.score}` : " "}</p>
              </div>
              <button onClick={() => setOpen(open === d.date ? null : d.date)} disabled={!d.spend.length}
                      className="text-left bg-[#18181B] rounded-xl px-3 py-2 min-w-0">
                <Label><span className="inline-flex items-center gap-1"><Wallet size={10} /> Spent</span></Label>
                <p className="text-sm font-semibold tabular-nums">{d.spend.length ? eur(spent) : "—"}</p>
                <p className="text-[11px] text-[#71717A]">{d.spend.length ? `${d.spend.length} expense${d.spend.length > 1 ? "s" : ""}` : " "}</p>
              </button>
            </div>
            {open === d.date && (
              <div className="divide-y divide-[#18181B]">
                {d.spend.map((t, k) => (
                  <p key={k} className="flex justify-between gap-3 py-1.5 text-xs">
                    <span className="text-[#A1A1AA] truncate">{t.name}{t.category ? <span className="text-[#52525B]"> · {t.category}</span> : null}</span>
                    <span className="tabular-nums text-[#D4D4D8]">{eur(t.eur)}</span>
                  </p>
                ))}
              </div>
            )}
            {d.items.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.items.map((it) => (
                  <span key={it.id} className={`text-xs px-2 py-0.5 rounded-full ${it.booked ? "bg-[#18181B] text-[#A1A1AA]" : "bg-[#F59E0B]/10 text-[#F59E0B]"}`}>
                    {it.booked ? "✓ " : ""}{it.name}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

/** The board's headline numbers: cost, booked, km, sleep. */
export function TripBoardStats({ board }: { board: Board }) {
  const t = board.totals;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
        <Label>Bookings</Label>
        <p className="text-lg font-semibold tabular-nums">{eur(t.planned_eur)}</p>
        <p className="text-xs text-[#71717A] truncate">{eur(t.paid_eur)} paid · {t.booked}/{t.items} booked</p>
      </div>
      <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
        <Label>Spent there</Label>
        <p className="text-lg font-semibold tabular-nums">{t.spent_eur ? eur(t.spent_eur) : "—"}</p>
        <p className="text-xs text-[#71717A] truncate">from Money, trip days</p>
      </div>
      <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
        <Label>Riding</Label>
        <p className="text-lg font-semibold tabular-nums">{t.ridden_km ? `${t.ridden_km} km` : t.planned_km ? `${t.planned_km} km` : "—"}</p>
        <p className="text-xs text-[#71717A] truncate">
          {t.ridden_km && t.planned_km ? `of ${t.planned_km} planned` : t.climb_m ? `+${t.climb_m.toLocaleString("en-GB")} m planned` : "no routes yet"}
        </p>
      </div>
      <div className="bg-[#18181B] rounded-xl px-3 py-2.5 min-w-0">
        <Label>Sleep</Label>
        <p className="text-lg font-semibold tabular-nums">{t.sleep_avg_h != null ? `${t.sleep_avg_h} h` : "—"}</p>
        <p className="text-xs text-[#71717A] truncate">average a night</p>
      </div>
    </div>
  );
}

/** Load a Notion board export (CSV) into the trip. */
export function ImportBoardButton({ tripId }: { tripId: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  async function pick(file?: File) {
    if (!file) return;
    setMsg("Importing…");
    try {
      const r = await plansApi.importTripBoard(tripId, await file.text());
      setMsg(`${r.added} added, ${r.updated} updated${r.days_named ? ` · ${r.days_named} days named` : ""}`);
      refreshKeys(qc, tripId);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Import failed"); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className="text-xs text-[#71717A]">{msg}</span>}
      <label className="inline-flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA] cursor-pointer">
        <Upload size={12} /> Notion CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
    </span>
  );
}

function ItemSheet({ trip, item, defaultDate, onClose }: {
  trip: PlannedTripDetail; item?: TripItem; defaultDate: string | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const num = (v: number | null | undefined) => (v != null ? String(v) : "");
  const [f, setF] = useState({
    name: item?.name ?? "", kinds: item?.kinds ?? "", date: item?.date ?? defaultDate ?? "", end_date: item?.end_date ?? "",
    place: item?.place ?? "", price_eur: num(item?.price_eur), price_local: num(item?.price_local), paid_eur: num(item?.paid_eur),
    booked: item?.booked ?? false, notes: item?.notes ?? "", url: item?.url ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const toNum = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  async function save() {
    const body = {
      name: f.name.trim(), kinds: f.kinds.trim() || null, date: f.date || null, end_date: f.end_date || null,
      place: f.place.trim() || null, price_eur: toNum(f.price_eur), price_local: toNum(f.price_local),
      paid_eur: toNum(f.paid_eur), booked: f.booked, notes: f.notes.trim() || null, url: f.url.trim() || null,
    };
    try {
      if (item) await plansApi.updateTripItem(item.id, body);
      else await plansApi.addTripItem(trip.id, body);
      refreshKeys(qc, trip.id);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
  }
  async function remove() {
    if (!item || !window.confirm(`Delete "${item.name}"?`)) return;
    await plansApi.deleteTripItem(item.id);
    refreshKeys(qc, trip.id);
    onClose();
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet title={item ? "Edit card" : "New card"} onClose={onClose}>
      <input className={`${inputCls} text-base`} placeholder="Hotel 2: Finders Hualien" autoFocus={!item} value={f.name} onChange={set("name")} />
      <Field label="Type (comma-separated)">
        <input className={inputCls} placeholder="Accomodation · Flights, Transportation · Need to do" value={f.kinds} onChange={set("kinds")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={set("date")} /></Field>
        <Field label="Until (stays)"><input type="date" className={inputCls} value={f.end_date} min={f.date || undefined} onChange={set("end_date")} /></Field>
      </div>
      <Field label="Place"><input className={inputCls} value={f.place} onChange={set("place")} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Price €"><input inputMode="decimal" className={inputCls} value={f.price_eur} onChange={set("price_eur")} /></Field>
        <Field label={`Price ${localSign(trip.currency).trim() || "local"}`}>
          <input inputMode="decimal" className={inputCls} value={f.price_local} onChange={set("price_local")} />
        </Field>
        <Field label="Paid €"><input inputMode="decimal" className={inputCls} value={f.paid_eur} onChange={set("paid_eur")} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-[#D4D4D8]">
        <input type="checkbox" checked={f.booked} onChange={(e) => setF({ ...f, booked: e.target.checked })} /> Booked
      </label>
      <Field label="Notes"><textarea rows={2} className={`${inputCls} resize-none`} value={f.notes} onChange={set("notes")} /></Field>
      <Field label="Link">
        <div className="flex gap-2 items-center">
          <input className={inputCls} value={f.url} onChange={set("url")} placeholder="https://" />
          {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="text-[#52525B] hover:text-[#A1A1AA]"><ExternalLink size={14} /></a>}
        </div>
      </Field>
      {err && <p className="text-rose-400 text-xs">{err}</p>}
      <div className="flex gap-2">
        {item && (
          <button onClick={remove} className="px-3 py-2.5 rounded-xl border border-[#27272A] text-[#71717A] hover:text-rose-400"><Trash2 size={15} /></button>
        )}
        <button onClick={save} disabled={!f.name.trim()}
                className="flex-1 py-2.5 rounded-xl bg-[#F59E0B] text-black text-sm font-semibold disabled:opacity-40">Save</button>
      </div>
    </Sheet>
  );
}
