"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { moneyApi, fmtAmount, isExpense, type Transaction, type TransactionPatch } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

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

  if (isLoading) return <p className="text-sm text-[#52525B] py-4 text-center">Loading…</p>;
  if (transactions.length === 0) return (
    <p className="text-sm text-[#52525B] py-4 text-center">No transactions</p>
  );

  return (
    <div className="flex flex-col divide-y divide-[#18181B]">
      {transactions.map((t) => (
        <TransactionRow key={t.id} t={t} showDate={showDate} qc={qc} />
      ))}
    </div>
  );
}

function TransactionRow({
  t,
  showDate,
  qc,
}: {
  t: Transaction;
  showDate: boolean;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: t.name, amount: Math.abs(t.amount) });
  const [confirming, setConfirming] = useState(false);

  const patch = useMutation({
    mutationFn: (body: TransactionPatch) => moneyApi.patchTransaction(t.id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["money"] }); setEditing(false); },
  });

  const del = useMutation({
    mutationFn: () => moneyApi.deleteTransaction(t.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["money"] }); },
  });

  const emoji = CATEGORY_EMOJI[t.category ?? ""] ?? "💳";
  const expense = isExpense(t);

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="text-base w-6 text-center shrink-0">{emoji}</span>
        <input
          className="flex-1 min-w-0 bg-[#18181B] border border-[#27272A] rounded px-2 py-1 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <input
          type="number"
          step="0.01"
          className="w-20 bg-[#18181B] border border-[#27272A] rounded px-2 py-1 text-sm text-[#FAFAFA] tabular-nums focus:outline-none focus:border-[#F59E0B]"
          value={draft.amount}
          onChange={(e) => setDraft((d) => ({ ...d, amount: parseFloat(e.target.value) || 0 }))}
        />
        <button
          onClick={() => patch.mutate({ name: draft.name, amount: draft.amount })}
          className="text-[#22C55E] hover:text-[#86EFAC] transition-colors"
          disabled={patch.isPending}
        >
          <Check size={15} />
        </button>
        <button onClick={() => setEditing(false)} className="text-[#52525B] hover:text-[#A1A1AA] transition-colors">
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 py-2">
      <span className="text-base w-6 text-center shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#D4D4D8] truncate">{t.name}</p>
        {showDate && <p className="text-xs text-[#52525B]">{t.date}</p>}
      </div>
      <span className={`text-sm tabular-nums shrink-0 ${expense ? "text-[#A1A1AA]" : "text-[#22C55E]"}`}>
        {expense ? "-" : "+"}{fmtAmount(t.amount)}
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
