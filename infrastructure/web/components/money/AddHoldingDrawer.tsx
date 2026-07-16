"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { moneyApi, type AssetClass, type IsinCandidate } from "@/lib/money-api";

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "equity_etf", label: "Equity ETF" },
  { value: "stock", label: "Stock" },
  { value: "crypto", label: "Crypto" },
  { value: "bond_etf", label: "Bond ETF" },
  { value: "commodity", label: "Commodity" },
  { value: "cash", label: "Cash / MMF" },
];

// Asset classes that have no market ticker — valued by hand
const MANUAL_ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: "fund", label: "Fund (unlisted)" },
  { value: "pension", label: "Pension plan" },
  { value: "real_estate", label: "Real estate" },
  { value: "private", label: "Private equity / business" },
  { value: "other", label: "Other asset" },
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
  const [mode, setMode] = useState<"market" | "manual">("market");
  const router = useRouter();

  const [form, setForm] = useState({
    account: accounts[0] ?? "",
    ticker: "",
    isin: "",
    name: "",
    asset_class: "equity_etf" as AssetClass,
    currency: "EUR",
    quantity: "",
    first_bought_at: "",
    notes: "",
  });
  // Collected separately from `form` because the API stores cost_basis_eur
  // as a TOTAL — asking for that directly reads as "price per unit" to most
  // people and silently produces nonsense P&L (that ambiguity is exactly
  // what caused the wildly-wrong percentages users were seeing).
  const [avgBuyIn, setAvgBuyIn] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<IsinCandidate[]>([]);

  // Manual-asset fields
  const [manualValue, setManualValue] = useState("");   // current total value €
  const [manualCost, setManualCost] = useState("");     // what you paid € (optional)

  const totalCostBasis = (() => {
    const qty = Number(form.quantity);
    const price = Number(avgBuyIn);
    return avgBuyIn && form.quantity && !isNaN(qty) && !isNaN(price) ? qty * price : null;
  })();

  async function onIsinLookup() {
    const isin = form.isin.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
      setLookupMsg("Invalid ISIN format (12 chars, letters + digits)");
      return;
    }
    setLookupMsg(null);
    setCandidates([]);
    setLookupPending(true);
    try {
      const res = await moneyApi.isinLookup(isin);
      if (res.candidates.length === 0) {
        setLookupMsg("No ticker found — you can still enter one manually");
      } else {
        pickCandidate(res.candidates[0], isin);
        setCandidates(res.candidates.slice(0, 6));
        if (res.candidates[0].has_data === false) {
          setLookupMsg("⚠ No listing has recent Yahoo data — prices may not update");
        }
      }
    } catch {
      setLookupMsg("Lookup failed — enter ticker manually");
    } finally {
      setLookupPending(false);
    }
  }

  function pickCandidate(c: IsinCandidate, isin?: string) {
    setForm(f => ({
      ...f,
      ticker: c.ticker,
      name: c.name || f.name,
      currency: c.currency || f.currency,
      isin: isin ?? f.isin,
    }));
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function resetForm() {
    setForm({
      account: accounts[0] ?? "",
      ticker: "",
      isin: "",
      name: "",
      asset_class: "equity_etf",
      currency: "EUR",
      quantity: "",
      first_bought_at: "",
      notes: "",
    });
    setAvgBuyIn("");
    setManualValue("");
    setManualCost("");
    setCandidates([]);
    setLookupMsg(null);
    setMode("market");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    try {
      if (mode === "manual") {
        // Ticker is just an internal identifier for manual assets
        const slug = form.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
        await moneyApi.createHolding({
          account: form.account.trim(),
          ticker: slug || "ASSET",
          isin: null,
          name: form.name.trim(),
          asset_class: form.asset_class,
          currency: "EUR",
          quantity: 1,
          cost_basis_eur: manualCost ? Number(manualCost) : null,
          first_bought_at: form.first_bought_at || null,
          notes: form.notes || null,
          pricing_mode: "manual",
          current_value_eur: Number(manualValue),
        });
      } else {
        await moneyApi.createHolding({
          account: form.account,
          ticker: form.ticker.trim().toUpperCase(),
          isin: form.isin.trim() ? form.isin.trim().toUpperCase() : null,
          name: form.name.trim(),
          asset_class: form.asset_class,
          currency: form.currency.trim().toUpperCase() || "EUR",
          quantity: Number(form.quantity),
          cost_basis_eur: totalCostBasis,
          first_bought_at: form.first_bought_at || null,
          notes: form.notes || null,
        });
      }
      setOpen(false);
      resetForm();
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

            <div className="flex gap-1 mb-4 bg-[#18181B] rounded-lg p-1">
              {([["market", "Stock / ETF / Crypto"], ["manual", "Other asset"]] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    update("asset_class", m === "manual" ? "fund" : "equity_etf");
                  }}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    mode === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Account</label>
                {mode === "manual" ? (
                  <input
                    required
                    placeholder="e.g. Pension BBVA, Pis Barcelona"
                    value={form.account}
                    onChange={e => update("account", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  />
                ) : (
                  <select
                    required
                    value={form.account}
                    onChange={e => update("account", e.target.value)}
                    className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                  >
                    {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
              </div>

              {/* Crypto has no ISIN — Yahoo quotes pairs (BTC-EUR), so the
                  lookup block is hidden and the ticker hint changes instead */}
              {mode === "market" && form.asset_class !== "crypto" && (
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
                    {candidates.length > 1 && (
                      <div className="mt-2 border border-[#27272A] rounded-lg divide-y divide-[#18181B]">
                        {candidates.map(c => {
                          const selected = c.ticker === form.ticker;
                          return (
                            <button
                              key={c.ticker}
                              type="button"
                              onClick={() => pickCandidate(c)}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                                selected ? "bg-[#3B82F6]/10" : "hover:bg-[#131316]"
                              }`}
                            >
                              <span className={`text-xs font-mono ${selected ? "text-[#3B82F6]" : "text-[#D4D4D8]"}`}>{c.ticker}</span>
                              <span className="text-[10px] text-[#52525B] uppercase">{c.currency ?? "?"}</span>
                              <span className="ml-auto text-[10px] tabular-nums">
                                {c.has_data
                                  ? <span className="text-[#22C55E]">✓ {c.last_close_date}</span>
                                  : c.has_data === false
                                    ? <span className="text-[#EF4444]">no data</span>
                                    : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
              )}

              {mode === "market" && (
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#71717A] uppercase tracking-widest">Ticker</label>
                      <input
                        required
                        placeholder={form.asset_class === "crypto" ? "BTC-EUR" : "VWCE.DE"}
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
                  {form.asset_class === "crypto" && (
                    <p className="text-xs text-[#52525B] mt-1">
                      Crypto has no ISIN — use Yahoo pair format: BTC-EUR, ETH-EUR, SOL-EUR
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-[#71717A] uppercase tracking-widest">Name</label>
                <input
                  required
                  placeholder={mode === "manual" ? "e.g. Pla de pensions BBVA" : "Vanguard FTSE All-World UCITS"}
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
                  {(mode === "manual" ? MANUAL_ASSET_CLASSES : ASSET_CLASSES).map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {mode === "manual" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#71717A] uppercase tracking-widest">Current value €</label>
                    <input
                      required
                      type="number"
                      step="any"
                      min="0"
                      value={manualValue}
                      onChange={e => setManualValue(e.target.value)}
                      className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#71717A] uppercase tracking-widest">Paid € (optional)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={manualCost}
                      onChange={e => setManualCost(e.target.value)}
                      className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              ) : (
                <>
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
                    <label className="text-xs text-[#71717A] uppercase tracking-widest">
                      Avg. buy-in price € / unit
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="optional — what you paid per unit, on average"
                      value={avgBuyIn}
                      onChange={e => setAvgBuyIn(e.target.value)}
                      className="mt-1 w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm"
                    />
                    {totalCostBasis != null && (
                      <p className="text-xs text-[#52525B] mt-1">
                        Total cost: €{totalCostBasis.toFixed(2)} · this is what P&amp;L compares against
                      </p>
                    )}
                  </div>
                </>
              )}

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
              <p className="text-xs text-[#52525B] text-center">
                {mode === "manual"
                  ? "Update its value any time from the holdings list"
                  : "Today's price is fetched immediately"}
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
