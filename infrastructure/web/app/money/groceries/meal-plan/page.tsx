import Link from "next/link";
import { MealPlanner } from "@/components/groceries/MealPlanner";
import { api } from "@/lib/api";

export default async function MealPlanPage() {
  const { plan } = await api.latestMealPlan().catch(() => ({ plan: null }));

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <div className="mb-8">
        <Link href="/money/groceries" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
          ← Groceries
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-4">Meal plan</h1>
        <p className="text-sm text-[#52525B] mt-1">AI-generated weekly dinner plan with priced shopping list</p>
      </div>

      <MealPlanner initialPlan={plan} />
    </main>
  );
}
