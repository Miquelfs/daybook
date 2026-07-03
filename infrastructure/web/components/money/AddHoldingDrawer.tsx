"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneyApi, type AssetClass } from "@/lib/money-api";

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "equity_etf", label: "Equity ETF" },
  { value: "stock", label: "Stock" },
  { value: "crypto", label: "Crypto" },
  { value: "bond_etf", label: "Bond ETF" },
  { value: "commodity", label: "Commodity" },
  { value: "cash", label: "Cash / MMF" },
];

const INVESTMENT_ACCOUNTS = [
  "Trade Republic Wealth",
  "BBVA Investment",
  "Accions",
  "Binance",
  "Mapfre Inversió",
];

interface Props {
  accounts?: string[];
}

export function AddHoldingDrawer({ accounts = INVESTMENT_ACCOUNTS }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const [form, setForm] = useState({
    account: accounts[0] ?? "",
    ticker: "",
    isin: "",
    name: "",
    asset_class: "equity_etf" as AssetClass,
    currency: "EUR",
    quantity: "",
    cost_basis_eur: "",
    first_bought_at: "",
    notes: "",
  });
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  async function onIsinLookup() {
    const isin = form.isin.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
      setLookupMsg("Invalid ISIN format (12 chars, letters + digits)");
      return;
    }
    setLookupMsg(null);
    setLookupPending(true);
    try {
      const res = await moneyApi.isinLookup(isin);
      if (res.candidates.length === 0) {
        setLookupMsg("No ticker found — you can still enter one manually");
      } else {
        const best = res.candidates[0];
        setForm(f => ({
          ...f,
          ticker: best.ticker,
          name: best.name || f.name,
          currency: best.currency || f.currency,
          isin: isin,
        }));
        setLookupMsg(`Matched ${best.ticker}${res.candidates.length > 1 ? ` (+${res.candidates.length - 1} other listings)` : ""}`);
      }
    } catch {
      setLookupMsg("Lookup failed — enter ticker manually");
    } finally {
      setLookupPending(false);
    }
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    try {
      await moneyApi.createHolding({
        account: form.account,
        ticker: form.ticker.trim().toUpperCase(),
        isin: form.isin.trim() ? form.isin.trim().toUpperCase() : null,
        name: form.name.trim(),
        asset_class: form.asset_class,
        currency: form.currency.trim().toUpperCase() || "EUR",
        quantity: Number(form.quantity),
        cost_basis_eur: form.cost_basis_eur ? Number(form.cost_basis_eur) : null,
        first_bought_at: form.first_bought_at || null,
        notes: form.notes || null,
      });
      setOpen(false);
      setForm({
        account: accounts[0] ?? "",
        ticker: "",
        isin: "",
        name: "",
        asset_class: "equity_etf",
        currency: "EUR",
        quantity: "",
        cost_basis_eur: "",
        first_bought_at: "",
        notes: "",
      });
      setLookupMsg(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add holding");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#22C55E]/10 text-[#22C55E] hover:bg-[#22C55E]/20 transition-colors"
      >
        + Add holding
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add holding</h2>
              <button onClick={() => setOpen(false)} className="text-[#71717A] hover:text-[#FAFAFA]">✕</button>
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Account</label>
                <select
                  required
                  value={form.account}
                  onChange={e => update("account", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                >
                  {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">ISIN (recommended for ETFs/funds)</label>
                <div className="mt-1 flex gap-2">
                  <input
                    placeholder="IE00BK5BQT80"
                    value={form.isin}
                    onChange={e => update("isin", e.target.value.toUpperCase())}
                    maxLength={12}
                    className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm font-mono uppercase"
                  />
                  <button
                    type="button"
                    onClick={onIsinLookup}
                    disabled={lookupPending || !form.isin.trim()}
                    className="text-xs font-medium px-3 py-2 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 transition-colors disabled:opacity-40"
                  >
                    {lookupPending ? "…" : "Lookup"}
                  </button>
                </div>
                {lookupMsg && <p className="text-xs text-[#71717A] mt-1">{lookupMsg}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Ticker</label>
                  <input
                    required
                    placeholder="VWCE.DE"
                    value={form.ticker}
                    onChange={e => update("ticker", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Currency</label>
                  <input
                    value={form.currency}
                    onChange={e => update("currency", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Name</label>
                <input
                  required
                  placeholder="Vanguard FTSE All-World UCITS"
                  value={form.name}
                  onChange={e => update("name", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Asset class</label>
                <select
                  value={form.asset_class}
                  onChange={e => update("asset_class", e.target.value as AssetClass)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                >
                  {ASSET_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Quantity</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={form.quantity}
                    onChange={e => update("quantity", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#71717A] uppercase tracking-widest">Cost basis €</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="optional"
                    value={form.cost_basis_eur}
                    onChange={e => update("cost_basis_eur", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">First bought</label>
                <input
                  type="date"
                  value={form.first_bought_at}
                  onChange={e => update("first_bought_at", e.target.value)}
                  className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                />
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
                className="w-full py-2.5 rounded-lg bg-[#22C55E] text-black font-semibold text-sm disabled:opacity-50"
              >
                {pending ? "Adding…" : "Add holding"}
              </button>
              <p className="text-xs text-[#52525B] text-center">Price will be fetched on next sync (~05:30 daily)</p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
