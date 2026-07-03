"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { TransactionList } from "@/components/money/TransactionList";
import { accountBadgeClass } from "@/components/money/CategoryPills";

export default function AccountTransactionsPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const badge = accountBadgeClass(name);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <Link
        href="/money/portfolio"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Portfolio
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.bg} ${badge.text}`}>
          account
        </span>
      </div>

      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">All transactions</p>
      <TransactionList account={name} limit={200} showDate />
    </main>
  );
}
