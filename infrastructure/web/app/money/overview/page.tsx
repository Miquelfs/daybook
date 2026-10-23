import { redirect } from "next/navigation";

// Overview was merged into Insights (same month, one projection).
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  redirect(month ? `/money/insights?month=${month}` : "/money/insights");
}
