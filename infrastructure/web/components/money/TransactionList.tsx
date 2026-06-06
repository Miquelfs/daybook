"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { moneyApi, fmtAmount, type Transaction, type TransactionPatch } from "@/lib/money-api";
import { CATEGORY_EMOJI, EXPENSE_CATEGORIES, accountBadgeClass } from "./CategoryPills";

const ALL_CATEGORIES = [
  ...EXPENSE_CATEGORIES,
  "Income", "OMYRA", "Finance", "Transfer", "Other",
];

interface Props {
  start?: string;
  end?: string;
  category?: string;
  limit?: number;
  showDate?: boolean;
}

export function TransactionList({ start, end, category, limit = 50, showDate = true }: Props) {
  const qc = useQueryClient();

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["money", "transactions", start, end, category, limit],
    queryFn: () => moneyApi.transactions({ start, end, category, limit }),
  });

  const { data: meta } = useQuery({
    queryKey: ["money", "meta"],
    queryFn: () => moneyApi.meta(),
    staleTime: Infinity,
  });

  const accounts = meta?.accounts ?? [];

  if (isLoading) return <p className="text-sm text-[#52525B] py-4 text-center">Loading…</p>;
  if (transactions.length === 0) return (
    <p className="text-sm text-[#52525B] py-4 text-center">No transactions</p>
  );

  return (
    <div className="flex flex-col divide-y divide-[#18181B]">
      {transactions.map((t) => (
        <TransactionRow key={t.id} t={t} showDate={showDate} qc={qc} accounts={accounts} />
      ))}
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
    <div className="group flex items-center gap-3 py-2">
      <span className="text-base w-6 text-center shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#D4D4D8] truncate">{t.name}</p>
        <p className="text-xs text-[#52525B] truncate">
          {[showDate ? t.date : null, t.subcategory].filter(Boolean).join(" · ")}
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
      <span className={`text-sm tabular-nums shrink-0 ${isPositive ? "text-[#22C55E]" : "text-[#A1A1AA]"}`}>
        {isPositive ? "+" : "-"}{fmtAmount(t.amount)}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="text-[#52525B] hover:text-[#A1A1AA] transition-colors p-1"
        >
          <Pencil size={13} />
        </button>
        {confirming ? (
          <>
            <button
              onClick={() => del.mutate()}
              className="text-[#EF4444] hover:text-[#FCA5A5] transition-colors p-1"
              disabled={del.isPending}
            >
              <Check size={13} />
            </button>
            <button onClick={() => setConfirming(false)} className="text-[#52525B] hover:text-[#A1A1AA] transition-colors p-1">
              <X size={13} />
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-[#52525B] hover:text-[#EF4444] transition-colors p-1"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
