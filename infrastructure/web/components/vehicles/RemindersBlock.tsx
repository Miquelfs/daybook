"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { vehiclesApi, type Reminder, type ReminderInput, type Vehicle } from "@/lib/statements-api";
import { ActionButton, Block, Empty, Panel, Pill } from "@/components/ui/kit";

const input = "bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B] min-w-0";
const label = "text-[10px] text-[#52525B] uppercase tracking-widest mb-1 block";
const save = "inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 disabled:opacity-50";
const km = (n: number) => Math.round(n).toLocaleString("en-GB");
const today = () => format(new Date(), "yyyy-MM-dd");
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function when(r: Reminder) {
  const d = r.due;
  if (!d.date) return d.km != null ? `at ${km(d.km)} km` : "—";
  const days = d.days_left ?? 0;
  const rel = days < 0 ? `${-days} days overdue` : days === 0 ? "today" : days <= 60 ? `in ${days} days` : format(parseISO(d.date), "d MMM yyyy");
  return rel + (d.by === "km" && d.km != null ? ` · at ${km(d.km)} km${d.km_left != null && d.km_left > 0 ? `, ${km(d.km_left)} to go` : ""}` : "");
}

function ReminderForm({ initial, presets, onSave, onCancel, saving, error }: {
  initial?: Reminder; presets: { title: string; every_months: number | null; every_km: number | null }[];
  onSave: (b: ReminderInput) => void; onCancel: () => void; saving: boolean; error?: string | null;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [months, setMonths] = useState(initial?.every_months?.toString() ?? "");
  const [everyKm, setEveryKm] = useState(initial?.every_km?.toString() ?? "");
  const [lastDate, setLastDate] = useState(initial?.last_date ?? "");
  const [lastKm, setLastKm] = useState(initial?.last_km?.toString() ?? "");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [remind, setRemind] = useState((initial?.remind_days ?? 30).toString());
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      onSave({ title: title.trim(), every_months: num(months), every_km: num(everyKm), last_date: lastDate || null,
               last_km: num(lastKm), due_date: dueDate || null, remind_days: num(remind) ?? 30 });
    }}>
      {!initial && (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Pill key={p.title} on={title === p.title} onClick={() => {
              setTitle(p.title); setMonths(p.every_months?.toString() ?? ""); setEveryKm(p.every_km?.toString() ?? "");
            }}>{p.title}</Pill>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="col-span-2 sm:col-span-3"><span className={label}>What</span>
          <input className={`${input} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Oil change" /></div>
        <div><span className={label}>Every … months</span>
          <input className={`${input} w-full`} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></div>
        <div><span className={label}>Every … km</span>
          <input className={`${input} w-full`} inputMode="decimal" value={everyKm} onChange={(e) => setEveryKm(e.target.value)} /></div>
        <div><span className={label}>Remind days before</span>
          <input className={`${input} w-full`} inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value)} /></div>
        <div><span className={label}>Last done</span>
          <input type="date" className={`${input} w-full`} value={lastDate} onChange={(e) => setLastDate(e.target.value)} /></div>
        <div><span className={label}>At km</span>
          <input className={`${input} w-full`} inputMode="decimal" value={lastKm} onChange={(e) => setLastKm(e.target.value)} /></div>
        <div><span className={label}>Or next on (renewal)</span>
          <input type="date" className={`${input} w-full`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button className={save} disabled={!title.trim() || saving}><Check size={13} />Save</button>
        <button type="button" onClick={onCancel} className="text-xs text-[#71717A] hover:text-[#FAFAFA] px-2">Cancel</button>
      </div>
    </form>
  );
}

function DoneForm({ r, accounts, defaultAccount, onDone }: {
  r: Reminder; accounts: string[]; defaultAccount?: string; onDone: () => void;
}) {
  const [d, setD] = useState(today());
  const [k, setK] = useState(r.due.odometer != null ? String(r.due.odometer) : "");
  const [cost, setCost] = useState("");
  const [account, setAccount] = useState(defaultAccount ?? accounts[0] ?? "");
  const m = useMutation({
    mutationFn: () => vehiclesApi.reminderDone(r.id, {
      date: d, km: num(k) ?? undefined,
      cost: num(cost) ? { amount: num(cost)!, account: account || undefined } : undefined,
    }),
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 flex flex-wrap gap-2 items-center" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <input type="date" className={input} value={d} onChange={(e) => setD(e.target.value)} />
      <input className={`${input} w-28`} inputMode="decimal" placeholder="km on the dial" value={k} onChange={(e) => setK(e.target.value)} />
      <input className={`${input} w-24`} inputMode="decimal" placeholder="€ (opt.)" value={cost} onChange={(e) => setCost(e.target.value)} />
      {num(cost) ? (
        <select className={input} value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => <option key={a}>{a}</option>)}
        </select>
      ) : null}
      <button className={save} disabled={m.isPending}><Check size={13} />Done</button>
      {m.error && <p className="w-full text-xs text-rose-400">{(m.error as Error).message}</p>}
      {m.data?.odometer_error && <p className="w-full text-xs text-rose-400">Odometer not saved: {m.data.odometer_error}</p>}
    </form>
  );
}

// ITV, insurance, oil change… — each one is a task in Plan (area Vehicles). Ticking it off there or
// here starts the next cycle; a km interval becomes a date from your pace.
export function RemindersBlock({ vehicle, accounts, defaultAccount }: { vehicle: Vehicle; accounts: string[]; defaultAccount?: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [doing, setDoing] = useState<number | null>(null);
  const { data: list = [] } = useQuery({ queryKey: ["vehicles", vehicle.id, "reminders"], queryFn: () => vehiclesApi.reminders(vehicle.id) });
  const { data: presets } = useQuery({ queryKey: ["vehicles", "presets"], queryFn: () => vehiclesApi.presets(), staleTime: Infinity });
  const refresh = () => {
    setAdding(false); setEditing(null); setDoing(null);
    qc.invalidateQueries({ queryKey: ["vehicles"] });
    qc.invalidateQueries({ queryKey: ["money"] });
    qc.invalidateQueries({ queryKey: ["area-plan", "vehicles"] });
  };
  const add = useMutation({ mutationFn: (b: ReminderInput) => vehiclesApi.addReminder(vehicle.id, b), onSuccess: refresh });
  const patch = useMutation({ mutationFn: ({ id, b }: { id: number; b: ReminderInput }) => vehiclesApi.patchReminder(id, b), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: number) => vehiclesApi.deleteReminder(id), onSuccess: refresh });
  const kindPresets = presets?.[vehicle.kind === "motorbike" ? "scooter" : vehicle.kind] ?? presets?.car ?? [];

  return (
    <Block title="Reminders" note="Each one sits in Plan (area Vehicles) and comes up on Today before it's due."
           action={!adding && <ActionButton icon={Plus} onClick={() => setAdding(true)}>Add</ActionButton>}>
      {adding && (
        <Panel className="p-4 mb-3">
          <ReminderForm presets={kindPresets} onSave={(b) => add.mutate(b)} onCancel={() => setAdding(false)}
                        saving={add.isPending} error={add.error ? (add.error as Error).message : null} />
        </Panel>
      )}
      {list.length === 0 ? (!adding && <Empty>None yet — ITV, insurance, oil change…</Empty>) : (
        <Panel className="divide-y divide-[#18181B]">
          {list.map((r) => editing === r.id ? (
            <div key={r.id} className="p-4">
              <ReminderForm initial={r} presets={[]} onSave={(b) => patch.mutate({ id: r.id, b })} onCancel={() => setEditing(null)}
                            saving={patch.isPending} error={patch.error ? (patch.error as Error).message : null} />
            </div>
          ) : (
            <div key={r.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{r.title}</p>
                  <p className={`text-xs ${(r.due.days_left ?? 1) < 0 ? "text-rose-400" : "text-[#71717A]"}`}>{when(r)}</p>
                </div>
                <button onClick={() => setDoing(doing === r.id ? null : r.id)}
                        className="text-xs px-2 py-1 rounded-lg border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]">
                  {doing === r.id ? <X size={12} /> : "Done"}
                </button>
                <button onClick={() => setEditing(r.id)} className="text-[#52525B] hover:text-[#A1A1AA]" title="Edit"><Pencil size={12} /></button>
                <button onClick={() => { if (confirm(`Remove ${r.title}? Its Plan task goes too.`)) del.mutate(r.id); }}
                        className="text-[#52525B] hover:text-rose-400" title="Remove"><Trash2 size={12} /></button>
              </div>
              {doing === r.id && <DoneForm r={r} accounts={accounts} defaultAccount={defaultAccount} onDone={refresh} />}
            </div>
          ))}
        </Panel>
      )}
    </Block>
  );
}
