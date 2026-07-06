"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Trash2, X, Check } from "lucide-react";
import { moneyApi, fmtAmount, type Holding } from "@/lib/money-api";

// Per-holding actions: sell (books proceeds into a liquid account) or delete.
export function HoldingActions({ holding, accounts }: { holding: Holding; accounts: string[] }) {
  const router = useRouter();
  const [sellOpen, setSellOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [qty, setQty] = useState(String(holding.quantity));
  const [price, setPrice] = useState(
    holding.current_price_eur != null ? String(holding.current_price_eur) : ""
  );
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const qtyNum = parseFloat(qty);
  const priceNum = parseFloat(price);
  const valid = !isNaN(qtyNum) && qtyNum > 0 && !isNaN(priceNum) && priceNum > 0 && !!account;
  const proceeds = valid ? qtyNum * priceNum : null;
  const sellingAll = valid && qtyNum >= holding.quantity - 1e-9;

  async function sell() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await moneyApi.sellHolding(holding.id, {
        to_account: account,
        quantity: Math.min(qtyNum, holding.quantity),
        price_eur: priceNum,
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
        <button
          type="button"
          title={`Sell ${holding.ticker}`}
          onClick={(e) => { e.stopPropagation(); setSellOpen(true); }}
          className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#22C55E] hover:bg-[#18181B] transition-colors"
        >
          <Banknote size={14} />
        </button>
        {confirmDelete ? (
          <span className="flex items-center">
            <button
              type="button"
              title={`Delete ${holding.ticker} — removes it and its history`}
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

      {sellOpen && (
        <div className="fixed inset-0 z-50" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setSellOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#0D0D0F] border border-[#27272A] border-b-0 rounded-t-2xl px-5 pb-8 pt-4">
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-[#FAFAFA]">Sell {holding.ticker}</p>
                <p className="text-xs text-[#52525B]">{holding.name} · holding {holding.quantity.toLocaleString()} units</p>
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
