import Link from "next/link";
import { BudgetPlanner } from "@/components/money/BudgetPlanner";

export default function BudgetPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block">
        ← This month
      </Link>
      <h2 className="text-xl font-semibold tracking-tight mb-6">Budget &amp; savings goal</h2>
      <BudgetPlanner />
    </main>
  );
}
