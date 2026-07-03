import Link from "next/link";
import { api } from "@/lib/api";
import { PantryPanel } from "@/components/groceries/PantryPanel";

export default async function GroceriesPage() {
  const [items, purchases] = await Promise.all([
    api.pantryItems().catch(() => []),
    api.groceryPurchases().catch(() => []),
  ]);

  const recentPurchases = purchases.slice(0, 5);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
            ← Finance
          </Link>
          <div className="flex gap-4">
            <Link href="/money/groceries/prices" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
              Price history →
            </Link>
            <Link href="/money/groceries/meal-plan" className="text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors uppercase tracking-widest">
              Meal plan →
            </Link>
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Groceries</h1>
        <p className="text-sm text-[#52525B] mt-1">Pantry, prices, and purchase history</p>
      </div>

      {/* Pantry panel — client component for add/delete/sync */}
      <PantryPanel initialItems={items} />

      {/* Recent purchases */}
      {recentPurchases.length > 0 && (
        <section className="mt-10">
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">Recent purchases</p>
          <div className="space-y-2">
            {recentPurchases.map((p) => (
              <div
                key={p.id}
                className="bg-[#18181B] rounded-xl border border-[#27272A] px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-[#E4E4E7]">{p.date}</p>
                  <p className="text-xs text-[#52525B] mt-0.5">
                    {p.store} · {p.item_count} items · {p.source}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[#A1A1AA]">
                  {p.total_eur != null ? `€${p.total_eur.toFixed(2)}` : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {recentPurchases.length === 0 && items.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-sm text-[#52525B]">No pantry items yet. Add your first item above.</p>
          <p className="text-xs text-[#3F3F46] mt-2">Receipts scanned on iOS will appear here once parsed.</p>
        </div>
      )}
    </main>
  );
}
