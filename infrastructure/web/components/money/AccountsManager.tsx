"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Loader, ArrowRight, Check } from "lucide-react";
import { moneyApi, ACCOUNT_TYPES, INVESTMENT_ACCOUNT_TYPES, type AccountInfo, type AccountType } from "@/lib/money-api";

// Portfolio-side account management: create a new account with an explicit type,
// re-type a legacy "Unknown" account, and transfer ("traspàs") all holdings from
// one investment account to another without booking a sale.
export function AccountsManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Create-account form
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("Checking");

  // Transfer form
  const [fromAcct, setFromAcct] = useState("");
  const [toAcct, setToAcct] = useState("");
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  async function load() {
    try {
      setAccounts(await moneyApi.accounts());
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  const investmentAccounts = accounts.filter((a) => INVESTMENT_ACCOUNT_TYPES.has(a.account_type));

  async function createAccount() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await moneyApi.createAccount({ name: name.trim(), account_type: type });
      setName("");
      setMsg(`Created “${name.trim()}”`);
      await load();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  async function retype(acct: AccountInfo, newType: AccountType) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await moneyApi.patchAccount(acct.name, { account_type: newType });
      await load();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!fromAcct || !toAcct || fromAcct === toAcct) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await moneyApi.transferAccountHoldings(fromAcct, toAcct);
      const parts = [];
      if (res.moved) parts.push(`${res.moved} moved`);
      if (res.merged) parts.push(`${res.merged} merged`);
      setMsg(`Transferred to ${res.to_account} — ${parts.join(", ") || "nothing to move"}`);
      setConfirmTransfer(false);
      setFromAcct("");
      setToAcct("");
      await load();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#27272A] text-[#A1A1AA] hover:bg-[#3F3F46] hover:text-[#FAFAFA] transition-colors"
      >
        Accounts
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Manage accounts</h2>
              <button onClick={() => setOpen(false)} className="text-[#71717A] hover:text-[#FAFAFA]">
                <X size={18} />
              </button>
            </div>

            {/* Create */}
            <section className="mb-6">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">New account</p>
              <div className="flex gap-2">
                <input
                  placeholder="e.g. Interactive Brokers"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && createAccount()}
                  className={inputCls}
                />
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as AccountType)}
                  className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA] shrink-0"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={createAccount}
                disabled={busy || !name.trim()}
                className="mt-2 w-full py-2 rounded-lg bg-[#22C55E] text-black font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {busy ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                Create account
              </button>
            </section>

            {/* Transfer holdings */}
            <section className="mb-6">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Transfer holdings (traspàs)</p>
              <p className="text-[11px] text-[#52525B] mb-2">
                Moves every position from one investment account to another — no sale, no realized P&amp;L. Same-ticker
                positions in the destination are merged.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={fromAcct}
                  onChange={(e) => { setFromAcct(e.target.value); setConfirmTransfer(false); }}
                  className={inputCls}
                >
                  <option value="">From…</option>
                  {investmentAccounts.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <ArrowRight size={16} className="text-[#52525B] shrink-0" />
                <select
                  value={toAcct}
                  onChange={(e) => { setToAcct(e.target.value); setConfirmTransfer(false); }}
                  className={inputCls}
                >
                  <option value="">To…</option>
                  {accounts
                    .filter((a) => a.name !== fromAcct)
                    .map((a) => (
                      <option key={a.name} value={a.name}>{a.name}</option>
                    ))}
                </select>
              </div>
              {confirmTransfer ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={transfer}
                    disabled={busy}
                    className="flex-1 py-2 rounded-lg bg-[#F59E0B] text-black font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {busy ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                    Confirm: move {fromAcct} → {toAcct}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmTransfer(false)}
                    className="px-3 py-2 rounded-lg text-[#71717A] hover:text-[#FAFAFA] text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmTransfer(true)}
                  disabled={!fromAcct || !toAcct || fromAcct === toAcct}
                  className="mt-2 w-full py-2 rounded-lg bg-[#18181B] border border-[#27272A] text-[#D4D4D8] font-medium text-sm disabled:opacity-40 hover:border-[#3F3F46]"
                >
                  Transfer holdings
                </button>
              )}
            </section>

            {/* Existing accounts — re-type inline (useful for legacy "Unknown") */}
            <section>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">All accounts</p>
              <div className="border border-[#27272A] rounded-lg divide-y divide-[#18181B]">
                {accounts.map((a) => (
                  <div key={a.name} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-sm text-[#D4D4D8] flex-1 truncate">{a.name}</span>
                    <select
                      value={ACCOUNT_TYPES.includes(a.account_type as AccountType) ? a.account_type : ""}
                      onChange={(e) => retype(a, e.target.value as AccountType)}
                      className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA] shrink-0"
                    >
                      {!ACCOUNT_TYPES.includes(a.account_type as AccountType) && (
                        <option value="">{a.account_type}</option>
                      )}
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <p className="px-3 py-3 text-xs text-[#52525B]">No accounts yet</p>
                )}
              </div>
            </section>

            {err && <p className="mt-3 text-xs text-[#EF4444]">{err}</p>}
            {msg && <p className="mt-3 text-xs text-[#22C55E]">{msg}</p>}
          </div>
        </div>
      )}
    </>
  );
}
