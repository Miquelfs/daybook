"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { TransactionList } from "@/components/money/TransactionList";
import { AddExpenseSheet } from "@/components/money/AddExpenseSheet";
import { accountBadgeClass } from "@/components/money/CategoryPills";

// One account's transactions and Daybook's balance for it — check it against the
// bank app every few weeks and add whatever is missing right here.
export default function AccountTransactionsPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const badge = accountBadgeClass(name);
  const [adding, setAdding] = useState(false);

  const { data: meta } = useQuery({ queryKey: ["money", "meta"], queryFn: () => moneyApi.meta() });
  const { data: bal } = useQuery({
    queryKey: ["money", "account-balance", name],
    queryFn: () => moneyApi.accountBalance(name),
  });

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <Link
        href="/money/portfolio"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Portfolio
      </Link>

      <div className="flex items-center justify-between gap-3 mb-6">
        <span className={`text-base px-3 py-1 rounded-full font-medium ${badge.bg} ${badge.text}`}>{name}</span>
        {meta && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Plus size={13} />
            Add transaction
          </button>
        )}
      </div>

      {bal?.balance != null && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 mb-6">
          <p className="text-[11px] text-[#52525B] uppercase tracking-widest mb-1">Balance in Daybook</p>
          <p className={`text-2xl font-semibold tabular-nums ${bal.balance < 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"}`}>
            {bal.balance < 0 ? "−" : ""}{fmtAmount(bal.balance)}
          </p>
          <p className="text-xs text-[#52525B] mt-1">
            Compare with your bank app — add anything missing so the two match.
          </p>
        </div>
      )}

      <p className="text-xs text-[#71717A] uppercase tracking-widest mb-3">All transactions</p>
      <TransactionList account={name} limit={200} showDate />

      {meta && (
        <AddExpenseSheet
          date={format(new Date(), "yyyy-MM-dd")}
          isOpen={adding}
          onClose={() => setAdding(false)}
          meta={meta}
          account={name}
        />
      )}
    </main>
  );
}
