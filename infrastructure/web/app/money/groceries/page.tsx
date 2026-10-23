import Link from "next/link";
import { GroceriesDashboard } from "@/components/money/GroceriesDashboard";

export default function GroceriesPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <div className="mb-6">
        <Link
          href="/money/category/Groceries"
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
        >
          ← Groceries
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-3xl">🛒</span>
          <h1 className="text-2xl font-semibold tracking-tight">Groceries</h1>
        </div>
        <p className="text-xs text-[#52525B] mt-1">What&apos;s in the basket, from your Mercadona tickets.</p>
      </div>
      <GroceriesDashboard />
    </main>
  );
}
