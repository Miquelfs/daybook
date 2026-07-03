"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneyApi, type Cadence, type Holding } from "@/lib/money-api";

const DEFAULT_LIQUID_ACCOUNTS = [
  "BBVA Diaria", "Revolut", "Sabadell", "BBVA Estalvis", "Trade Republic Cash", "Cash",
];

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  holdings: Holding[];
  accounts?: string[];
}

export function AddPlanDrawer({ holdings, accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const sourceAccounts = accounts?.length ? accounts : DEFAULT_LIQUID_ACCOUNTS;
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    holding_id: holdings[0]?.id ?? "",
    source_account: sourceAccounts[0] ?? "",
    amount_eur: "",
    cadence: "monthly" as Cadence,
    day_of_month: "1",
    day_of_week: "0",
    start_date: today,
    end_date: "",
    notes: "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  const usesWeekday = form.cadence === "weekly" || form.cadence === "biweekly";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.holding_id) {
      setErr("Add a holding first, then create a plan for it.");
      return;
    }
    setPending(true);
    setErr(null);
    try {
      await moneyApi.createPlan({
        holding_id: form.holding_id,
        source_account: form.source_account,
        amount_eur: Number(form.amount_eur),
        cadence: form.cadence,
        day_of_month: usesWeekday ? null : Number(form.day_of_month),
        day_of_week: usesWeekday ? Number(form.day_of_week) : null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes || null,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create plan");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#F59E0B]/10 text-[#F59E0B] hover:bg-[#F59E0B]/20 transition-colors"
      >
        + New plan
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">New DCA plan</h2>
              <button onClick={() => setOpen(false)} className="text-[#71717A] hover:text-[#FAFAFA]">✕</button>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Holding</label>
                <select
                  required
                  value={form.holding_id}
                  onChange={e => update("holding_id", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                >
                  {holdings.length === 0 && <option value="">— add a holding first —</option>}
                  {holdings.map(h => (
                    <option key={h.id} value={h.id}>
                      {h.ticker} — {h.name} ({h.account})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">From account</label>
                <select
                  required
                  value={form.source_account}
                  onChange={e => update("source_account", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                >
                  {sourceAccounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Amount €</label>
                  <input
                    required type="number" step="any" min="0"
                    placeholder="500"
                    value={form.amount_eur}
                    onChange={e => update("amount_eur", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Cadence</label>
                  <select
                    value={form.cadence}
                    onChange={e => update("cadence", e.target.value as Cadence)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  >
                    {CADENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {usesWeekday ? (
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Day of week</label>
                  <select
                    value={form.day_of_week}
                    onChange={e => update("day_of_week", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  >
                    {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Day of month</label>
                  <input
                    type="number" min="1" max="31"
                    value={form.day_of_month}
                    onChange={e => update("day_of_month", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                  <p className="text-[10px] text-[#52525B] mt-1">Day 31 in short months auto-clamps to last day.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">First execution</label>
                  <input
                    required type="date"
                    value={form.start_date}
                    onChange={e => update("start_date", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">End date (opt)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={e => update("end_date", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Notes</label>
                <input
                  value={form.notes}
                  onChange={e => update("notes", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {err && <p className="text-sm text-[#EF4444]">{err}</p>}

              <button
                type="submit"
                disabled={pending}
                className="w-full py-2.5 rounded-lg bg-[#F59E0B] text-black font-semibold text-sm disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create plan"}
              </button>
              <p className="text-[10px] text-[#52525B] text-center">Executes automatically each nightly sync (~05:30). Idempotent — safe to run twice.</p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
