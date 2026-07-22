"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, PencilLine, Settings2, ShoppingCart, Trash2, X, Check } from "lucide-react";
import { moneyApi, fmtAmount, type Holding, type HoldingPatch } from "@/lib/money-api";

// Per-holding actions: buy more (DCA — updates avg cost basis), sell (books
// proceeds into a liquid account), update value (manual assets), edit the
// position in place (fix quantity/cost after an off-DCA purchase, switch a
// dead ticker), or delete.
export function HoldingActions({ holding, accounts }: { holding: Holding; accounts: string[] }) {
  const router = useRouter();
  const [sellOpen, setSellOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManual = holding.pricing_mode === "manual";

  const avgCost =
    holding.cost_basis_eur != null && holding.quantity > 0
      ? holding.cost_basis_eur / holding.quantity
      : null;
  const [eQty, setEQty] = useState(String(holding.quantity));
  const [eAvg, setEAvg] = useState(avgCost != null ? avgCost.toFixed(4).replace(/\.?0+$/, "") : "");
  const [ePaid, setEPaid] = useState(
    holding.cost_basis_eur != null ? String(holding.cost_basis_eur) : ""
  );
  const [eTicker, setETicker] = useState(holding.ticker);
  const [eName, setEName] = useState(holding.name);
  const [eAccount, setEAccount] = useState(holding.account);
  const [eNotes, setENotes] = useState(holding.notes ?? "");

  const [newValue, setNewValue] = useState(
    holding.market_value_eur != null ? String(Math.round(holding.market_value_eur)) : ""
  );
  const newValueNum = parseFloat(newValue);
  const newValueValid = !isNaN(newValueNum) && newValueNum > 0;

  const [qty, setQty] = useState(String(holding.quantity));
  const [price, setPrice] = useState(
    holding.current_price_eur != null ? String(holding.current_price_eur) : ""
  );
  const [sellFee, setSellFee] = useState("");
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const [buyQty, setBuyQty] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [buyFee, setBuyFee] = useState("");
  const [buyAccount, setBuyAccount] = useState(accounts[0] ?? "");
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10));

  const qtyNum = parseFloat(qty);
  const priceNum = parseFloat(price);
  const sellFeeNum = sellFee.trim() === "" ? 0 : parseFloat(sellFee);
  const valid = !isNaN(qtyNum) && qtyNum > 0 && !isNaN(priceNum) && priceNum > 0 && !!account && !isNaN(sellFeeNum) && sellFeeNum >= 0;
  const grossProceeds = valid ? qtyNum * priceNum : null;
  const proceeds = grossProceeds !== null ? grossProceeds - sellFeeNum : null;
  const sellingAll = valid && qtyNum >= holding.quantity - 1e-9;

  const buyQtyNum = parseFloat(buyQty);
  const buyPriceNum = buyPrice ? parseFloat(buyPrice) : null;
  const buyFeeNum = buyFee.trim() === "" ? 0 : parseFloat(buyFee);
  const buyValid = !isNaN(buyQtyNum) && buyQtyNum > 0 && !!buyAccount &&
    (buyPrice === "" || (buyPriceNum != null && buyPriceNum > 0)) && !isNaN(buyFeeNum) && buyFeeNum >= 0;
  const buyGrossCost = buyValid && buyPriceNum != null ? buyQtyNum * buyPriceNum : null;
  const buyCost = buyGrossCost !== null ? buyGrossCost + buyFeeNum : null;

  async function sell() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await moneyApi.sellHolding(holding.id, {
        to_account: account,
        quantity: Math.min(qtyNum, holding.quantity),
        price_eur: priceNum,
        fee_eur: sellFeeNum || undefined,
        date,
      });
      setSellOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sell failed");
    } finally {
      setBusy(false);
    }
  }

  async function buy() {
    if (!buyValid) return;
    setBusy(true);
    setError(null);
    try {
      await moneyApi.buyHolding(holding.id, {
        from_account: buyAccount,
        quantity: buyQtyNum,
        price_eur: buyPriceNum ?? undefined,
        fee_eur: buyFeeNum || undefined,
        date: buyDate,
      });
      setBuyOpen(false);
      setBuyQty("");
      setBuyPrice("");
      setBuyFee("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Buy failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateValue() {
    if (!newValueValid) return;
    setBusy(true);
    setError(null);
    try {
      await moneyApi.setHoldingValue(holding.id, { value_eur: newValueNum });
      setValueOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const patch: HoldingPatch = {};
    if (!isManual) {
      const q = parseFloat(eQty);
      if (isNaN(q) || q <= 0) { setError("Quantity must be > 0"); return; }
      if (q !== holding.quantity) patch.quantity = q;

      const t = eTicker.trim().toUpperCase();
      if (t && t !== holding.ticker) patch.ticker = t;

      // Avg €/unit → total cost basis (recomputed against the edited quantity)
      const a = eAvg.trim() === "" ? null : parseFloat(eAvg);
      if (a !== null && (isNaN(a) || a < 0)) { setError("Avg buy-in must be a number"); return; }
      const newBasis = a === null ? null : a * q;
      if (newBasis !== holding.cost_basis_eur) patch.cost_basis_eur = newBasis;
    } else {
      const p = ePaid.trim() === "" ? null : parseFloat(ePaid);
      if (p !== null && (isNaN(p) || p < 0)) { setError("Paid must be a number"); return; }
      if (p !== holding.cost_basis_eur) patch.cost_basis_eur = p;
    }
    if (eName.trim() && eName.trim() !== holding.name) patch.name = eName.trim();
    if (eAccount.trim() && eAccount.trim() !== holding.account) patch.account = eAccount.trim();
    if ((eNotes.trim() || null) !== holding.notes) patch.notes = eNotes.trim() || null;

    if (Object.keys(patch).length === 0) { setEditOpen(false); return; }
    setBusy(true);
    setError(null);
    try {
      await moneyApi.patchHolding(holding.id, patch);
      setEditOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await moneyApi.deleteHolding(holding.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-0.5" onClick={(e) => e.preventDefault()}>
        {isManual ? (
          <button
            type="button"
            title={`Update value of ${holding.name}`}
            onClick={(e) => { e.stopPropagation(); setValueOpen(true); }}
            className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#F59E0B] hover:bg-[#18181B] transition-colors"
          >
            <PencilLine size={14} />
          </button>
        ) : (
          <button
            type="button"
            title={`Buy more ${holding.name}`}
            onClick={(e) => { e.stopPropagation(); setBuyOpen(true); }}
            className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#3B82F6] hover:bg-[#18181B] transition-colors"
          >
            <ShoppingCart size={14} />
          </button>
        )}
        <button
          type="button"
          title={`Sell ${holding.name}`}
          onClick={(e) => { e.stopPropagation(); setSellOpen(true); }}
          className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#22C55E] hover:bg-[#18181B] transition-colors"
        >
          <Banknote size={14} />
        </button>
        <button
          type="button"
          title={`Edit ${holding.name} — quantity, cost, ticker, account`}
          onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
          className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#A1A1AA] hover:bg-[#18181B] transition-colors"
        >
          <Settings2 size={14} />
        </button>
        {confirmDelete ? (
          <span className="flex items-center">
            <button
              type="button"
              title={`Delete ${holding.name} — removes it and its history`}
              onClick={(e) => { e.stopPropagation(); remove(); }}
              disabled={busy}
              className="p-1.5 rounded-lg bg-[#EF4444]/15 text-[#EF4444] hover:bg-[#EF4444]/25 transition-colors"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              className="p-1.5 rounded-lg text-[#52525B] hover:text-[#A1A1AA] transition-colors"
            >
              <X size={14} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            title="Delete holding"
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#EF4444] hover:bg-[#18181B] transition-colors"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setEditOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#0D0D0F] border border-[#27272A] border-b-0 rounded-t-2xl px-5 pb-8 pt-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Edit position</p>
                <p className="text-xs text-[#52525B]">
                  Corrects the position in place — no transaction is booked. Use Buy/Sell to also move cash.
                </p>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>

            <div className="space-y-3">
              {!isManual && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Quantity</span>
                    <input
                      value={eQty}
                      onChange={(e) => setEQty(e.target.value)}
                      inputMode="decimal"
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Avg buy-in € / unit</span>
                    <input
                      value={eAvg}
                      onChange={(e) => setEAvg(e.target.value)}
                      inputMode="decimal"
                      placeholder="unknown"
                      className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                    />
                  </label>
                </div>
              )}

              {!isManual && (() => {
                const q = parseFloat(eQty);
                const a = parseFloat(eAvg);
                const total = !isNaN(q) && !isNaN(a) ? q * a : null;
                return total != null ? (
                  <p className="text-xs text-[#52525B]">
                    New total cost basis: <span className="text-[#D4D4D8] tabular-nums">{fmtAmount(total)}</span> — P&amp;L compares against this
                  </p>
                ) : null;
              })()}

              {isManual && (
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Paid € (total)</span>
                  <input
                    value={ePaid}
                    onChange={(e) => setEPaid(e.target.value)}
                    inputMode="decimal"
                    placeholder="unknown"
                    className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                  />
                </label>
              )}

              {!isManual && (
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Ticker</span>
                  <input
                    value={eTicker}
                    onChange={(e) => setETicker(e.target.value.toUpperCase())}
                    className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] font-mono focus:outline-none focus:border-[#F59E0B]"
                  />
                  {eTicker.trim().toUpperCase() !== holding.ticker && (
                    <p className="text-[10px] text-[#F59E0B]/80 mt-1">
                      Price for the new symbol is fetched immediately on save
                    </p>
                  )}
                </label>
              )}

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Name</span>
                <input
                  value={eName}
                  onChange={(e) => setEName(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Account</span>
                <input
                  value={eAccount}
                  onChange={(e) => setEAccount(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Notes</span>
                <input
                  value={eNotes}
                  onChange={(e) => setENotes(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              {error && <p className="text-xs text-[#EF4444]">{error}</p>}

              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {valueOpen && (
        <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setValueOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#0D0D0F] border border-[#27272A] border-b-0 rounded-t-2xl px-5 pb-8 pt-4">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Update value</p>
                <p className="text-xs text-[#52525B]">
                  {holding.name}
                  {holding.market_value_eur != null && ` · currently ${fmtAmount(holding.market_value_eur)}`}
                  {holding.price_as_of && ` (as of ${holding.price_as_of})`}
                </p>
              </div>
              <button onClick={() => setValueOpen(false)} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Current total value €</span>
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              {error && <p className="text-xs text-[#EF4444]">{error}</p>}

              <button
                type="button"
                onClick={updateValue}
                disabled={!newValueValid || busy}
                className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
              >
                {busy ? "Saving…" : newValueValid ? `Set value to ${fmtAmount(newValueNum)}` : "Set value"}
              </button>
            </div>
          </div>
        </div>
      )}

      {buyOpen && (
        <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setBuyOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#0D0D0F] border border-[#27272A] border-b-0 rounded-t-2xl px-5 pb-8 pt-4">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Buy more {holding.name}</p>
                <p className="text-xs text-[#52525B]">
                  currently {holding.quantity.toLocaleString()} units
                  {holding.cost_basis_eur != null && ` · avg €${(holding.cost_basis_eur / holding.quantity).toFixed(2)}/unit`}
                </p>
              </div>
              <button onClick={() => setBuyOpen(false)} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Quantity bought</span>
                  <input
                    value={buyQty}
                    onChange={(e) => setBuyQty(e.target.value)}
                    inputMode="decimal"
                    autoFocus
                    className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Price € / unit</span>
                  <input
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="live price"
                    className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Broker/management fee € (optional)</span>
                <input
                  value={buyFee}
                  onChange={(e) => setBuyFee(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
                <p className="text-[10px] text-[#52525B] mt-1">Folded into the cost basis, so avg. buy-in stays accurate.</p>
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Funding account</span>
                <select
                  value={buyAccount}
                  onChange={(e) => setBuyAccount(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                >
                  {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Date</span>
                <input
                  type="date"
                  value={buyDate}
                  onChange={(e) => setBuyDate(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              <div className="bg-[#18181B] rounded-lg px-3 py-2.5 flex items-center justify-between">
                <span className="text-xs text-[#71717A]">
                  {buyCost != null
                    ? buyFeeNum > 0
                      ? `New avg. buy-in updates automatically (incl. €${buyFeeNum.toFixed(2)} fee)`
                      : "New avg. buy-in updates automatically"
                    : "Leave price blank to use today's live quote"}
                </span>
                {buyCost != null && (
                  <span className="text-sm font-semibold text-[#3B82F6] tabular-nums">−{fmtAmount(buyCost)}</span>
                )}
              </div>

              {error && <p className="text-xs text-[#EF4444]">{error}</p>}

              <button
                type="button"
                onClick={buy}
                disabled={!buyValid || busy}
                className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
              >
                {busy ? "Buying…" : buyCost != null ? `Buy for ${fmtAmount(buyCost)}` : "Buy at live price"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sellOpen && (
        <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setSellOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#0D0D0F] border border-[#27272A] border-b-0 rounded-t-2xl px-5 pb-8 pt-4">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Sell {holding.name}</p>
                <p className="text-xs text-[#52525B]">holding {holding.quantity.toLocaleString()} units</p>
              </div>
              <button onClick={() => setSellOpen(false)} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                <X size={16} className="text-[#71717A]" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Quantity</span>
                  <div className="flex gap-1 mt-1">
                    <input
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      inputMode="decimal"
                      className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                    />
                    <button
                      type="button"
                      onClick={() => setQty(String(holding.quantity))}
                      className="px-2 rounded-lg border border-[#27272A] text-[10px] text-[#71717A] hover:text-[#F59E0B] uppercase"
                    >
                      All
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Price € / unit</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder={holding.current_price_eur == null ? "required" : undefined}
                    className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Broker/management fee € (optional)</span>
                <input
                  value={sellFee}
                  onChange={(e) => setSellFee(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
                <p className="text-[10px] text-[#52525B] mt-1">Subtracted from proceeds — realized P&amp;L reflects the net result.</p>
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Proceeds to account</span>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                >
                  {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>

              <label className="block">
                <span className="text-[10px] text-[#52525B] uppercase tracking-widest">Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full mt-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                />
              </label>

              {proceeds != null && (
                <div className="bg-[#18181B] rounded-lg px-3 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-[#71717A]">
                    {sellingAll ? "Selling everything — holding will close" : `Keeping ${(holding.quantity - qtyNum).toLocaleString()} units`}
                    {sellFeeNum > 0 && ` · net of €${sellFeeNum.toFixed(2)} fee`}
                  </span>
                  <span className="text-sm font-semibold text-[#22C55E] tabular-nums">+{fmtAmount(proceeds)}</span>
                </div>
              )}

              {error && <p className="text-xs text-[#EF4444]">{error}</p>}

              <button
                type="button"
                onClick={sell}
                disabled={!valid || busy}
                className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
              >
                {busy ? "Selling…" : proceeds != null ? `Sell for ${fmtAmount(proceeds)}` : "Sell"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
