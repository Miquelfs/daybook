"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { moneyApi, fmtAmount, type Transaction, type TransactionPatch } from "@/lib/money-api";
import { CATEGORY_EMOJI, EXPENSE_CATEGORIES, accountBadgeClass } from "./CategoryPills";

const ALL_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  "Income", "OMYRA", "Finance", "Transfer", "Other",
];

// Server caps limit at 500 — the explorer pages up to that in `limit` steps
const MAX_ROWS = 500;

interface Props {
  start?: string;
  end?: string;
  category?: string;
  account?: string;
  limit?: number;
  showDate?: boolean;
  // Explorer mode: filter bar (range/category/account), running totals and a
  // "Load older" button. Fixed props above act as the base scope.
  filterable?: boolean;
}

export function TransactionList({ start, end, category, account, limit = 50, showDate = true, filterable = false }: Props) {
  const qc = useQueryClient();

  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [pages, setPages] = useState(1);

  // Back to page 1 whenever the filter scope changes
  useEffect(() => { setPages(1); }, [fStart, fEnd, fCategory, fAccount]);

  const effStart = filterable ? (fStart || undefined) : start;
  const effEnd = filterable ? (fEnd || undefined) : end;
  const effCategory = filterable ? (fCategory || undefined) : category;
  const effAccount = filterable ? (fAccount || undefined) : account;
  const visible = Math.min(limit * pages, MAX_ROWS);

  const { data: transactions = [], isLoading, isFetching } = useQuery({
    queryKey: ["money", "transactions", effStart, effEnd, effCategory, effAccount, visible],
    queryFn: () => moneyApi.transactions({
      start: effStart, end: effEnd, category: effCategory, account: effAccount, limit: visible,
    }),
    placeholderData: (prev) => prev, // keep the list up while loading more
  });

  const { data: meta } = useQuery({
    queryKey: ["money", "meta"],
    queryFn: () => moneyApi.meta(),
    staleTime: Infinity,
  });

  const accounts = meta?.accounts ?? [];
  const hasFilters = !!(fStart || fEnd || fCategory || fAccount);
  const maybeMore = transactions.length >= visible && visible < MAX_ROWS;

  // Transfers and Finance rows (sells, DCA buys) move money between pockets —
  // they're not spending or income, so keep them out of the running totals.
  const counted = (t: Transaction) => t.transaction_type !== "Transfer" && t.transaction_type !== "Finance";
  const spent = transactions.reduce((s, t) => t.amount < 0 && counted(t) ? s - t.amount : s, 0);
  const received = transactions.reduce((s, t) => t.amount > 0 && counted(t) ? s + t.amount : s, 0);

  const inputCls = "bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-xs text-[#D4D4D8] focus:outline-none focus:border-[#F59E0B]";

  return (
    <div>
      {filterable && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input type="date" value={fStart} onChange={e => setFStart(e.target.value)} className={inputCls} aria-label="From date" />
          <span className="text-[10px] text-[#3F3F46]">→</span>
          <input type="date" value={fEnd} onChange={e => setFEnd(e.target.value)} className={inputCls} aria-label="To date" />
          <select value={fCategory} onChange={e => setFCategory(e.target.value)} className={inputCls}>
            <option value="">All categories</option>
            {ALL_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_EMOJI[c] ?? ""} {c}</option>)}
          </select>
          <select value={fAccount} onChange={e => setFAccount(e.target.value)} className={inputCls}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setFStart(""); setFEnd(""); setFCategory(""); setFAccount(""); }}
              className="text-xs px-2 py-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA] border border-[#27272A] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {filterable && transactions.length > 0 && (
        <p className="text-[11px] text-[#52525B] mb-2 tabular-nums">
          {transactions.length}{maybeMore ? "+" : ""} transactions ·{" "}
          <span className="text-[#EF4444]/80">−{fmtAmount(spent)}</span> spent ·{" "}
          <span className="text-[#22C55E]/80">+{fmtAmount(received)}</span> received
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-[#52525B] py-4 text-center">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="text-sm text-[#52525B] py-4 text-center">No transactions{hasFilters ? " match these filters" : ""}</p>
      ) : (
        <>
          <div className="flex flex-col divide-y divide-[#18181B]">
            {transactions.map((t) => (
              <TransactionRow key={t.id} t={t} showDate={showDate} qc={qc} accounts={accounts} />
            ))}
          </div>
          {maybeMore && (
            <button
              onClick={() => setPages(p => p + 1)}
              disabled={isFetching}
              className="w-full mt-3 py-2 rounded-lg border border-[#27272A] text-xs text-[#71717A] hover:text-[#FAFAFA] hover:bg-[#131316] transition-colors disabled:opacity-50"
            >
              {isFetching ? "Loading…" : "Load older"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TransactionRow({
  t,
  showDate,
  qc,
  accounts,
}: {
  t: Transaction;
  showDate: boolean;
  qc: ReturnType<typeof useQueryClient>;
  accounts: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: t.name,
    amount: Math.abs(t.amount),
    sign: t.amount >= 0 ? "+" as const : "-" as const,
    account: t.account ?? "",
    category: t.category ?? "",
  });
  const [confirming, setConfirming] = useState(false);

  const patch = useMutation({
    mutationFn: (body: TransactionPatch) => moneyApi.patchTransaction(t.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["money"] });
      setEditing(false);
    },
  });

  const del = useMutation({
    mutationFn: () => moneyApi.deleteTransaction(t.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["money"] }); },
  });

  const emoji = CATEGORY_EMOJI[t.category ?? ""] ?? "💳";
  const isPositive = t.amount >= 0;
  // Both render muted: cash conversions, not gains or spending
  const isTransfer = t.transaction_type === "Transfer" || t.transaction_type === "Finance";

  if (editing) {
    return (
      <div className="flex flex-col gap-3 py-3">
        {/* Row 1: name + amount + sign */}
        <div className="flex items-center gap-2">
          <span className="text-base w-6 text-center shrink-0">{emoji}</span>
          <input
            className="flex-1 min-w-0 bg-[#18181B] border border-[#27272A] rounded px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          {/* Sign toggle */}
          <div className="flex rounded border border-[#27272A] overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, sign: "-" }))}
              className={`px-2 py-1.5 text-xs font-bold transition-colors ${draft.sign === "-" ? "bg-[#EF4444] text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
            >−</button>
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, sign: "+" }))}
              className={`px-2 py-1.5 text-xs font-bold transition-colors ${draft.sign === "+" ? "bg-[#22C55E] text-white" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
            >+</button>
          </div>
          <input
            type="number"
            step="0.01"
            className="w-20 bg-[#18181B] border border-[#27272A] rounded px-2 py-1.5 text-sm text-[#FAFAFA] tabular-nums focus:outline-none focus:border-[#F59E0B]"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: parseFloat(e.target.value) || 0 }))}
          />
          <button
            onClick={() => patch.mutate({
              name: draft.name,
              amount: draft.amount,
              sign: draft.sign,
              account: draft.account || undefined,
              category: draft.category || undefined,
            })}
            className="text-[#22C55E] hover:text-[#86EFAC] transition-colors shrink-0"
            disabled={patch.isPending}
          >
            <Check size={15} />
          </button>
          <button onClick={() => setEditing(false)} className="text-[#52525B] hover:text-[#A1A1AA] transition-colors shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Row 2: category pills */}
        <div className="flex flex-wrap gap-1.5 pl-8">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, category: cat }))}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                draft.category === cat
                  ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]"
                  : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <span>{CATEGORY_EMOJI[cat] ?? "💳"}</span>
              <span>{cat}</span>
            </button>
          ))}
        </div>

        {/* Row 3: account pills */}
        {accounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-8">
            {accounts.map((acc) => {
              const { bg, text } = accountBadgeClass(acc);
              const isSelected = draft.account === acc;
              return (
                <button
                  key={acc}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, account: acc }))}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isSelected
                      ? `${bg} ${text} border-transparent ring-1 ring-white/20`
                      : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                  }`}
                >
                  {acc}
                </button>
              );
            })}
            {draft.account && (
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, account: "" }))}
                className="text-xs px-2 py-1 rounded-full border border-[#27272A] text-[#3F3F46] hover:text-[#52525B]"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-3 py-2 ${isTransfer ? "opacity-50" : ""}`}>
      <span className="text-base w-6 text-center shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isTransfer ? "text-[#71717A]" : "text-[#D4D4D8]"}`}>{t.name}</p>
        <p className="text-xs text-[#52525B] truncate">
          {[showDate ? t.date : null, t.subcategory, isTransfer ? (t.transaction_type === "Finance" ? "portfolio" : "internal transfer") : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      {/* Account pill */}
      {t.account && (() => {
        const { bg, text } = accountBadgeClass(t.account);
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 hidden sm:inline ${bg} ${text}`}>
            {t.account}
          </span>
        );
      })()}
      <span className={`text-sm tabular-nums shrink-0 ${
        isTransfer ? "text-[#3F3F46]" : isPositive ? "text-[#22C55E]" : "text-[#A1A1AA]"
      }`}>
        {isPositive ? "+" : "-"}{fmtAmount(t.amount)}
      </span>
      <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="text-[#3F3F46] hover:text-[#A1A1AA] transition-colors p-1.5 rounded-lg active:bg-[#27272A]"
          aria-label="Edit"
        >
          <Pencil size={14} />
        </button>
        {confirming ? (
          <>
            <button
              onClick={() => del.mutate()}
              className="text-[#EF4444] hover:text-[#FCA5A5] transition-colors p-1.5 rounded-lg active:bg-[#27272A]"
              disabled={del.isPending}
              aria-label="Confirm delete"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-[#52525B] hover:text-[#A1A1AA] transition-colors p-1.5 rounded-lg active:bg-[#27272A]"
              aria-label="Cancel"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-[#3F3F46] hover:text-[#EF4444] transition-colors p-1.5 rounded-lg active:bg-[#27272A]"
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
