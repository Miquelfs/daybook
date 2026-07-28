export const dynamic = "force-dynamic";

import { DayView } from "@/components/DayView";
import { notFound } from "next/navigation";

interface Props {
  params: Promise<{ date: string }>;
}

export default async function DayPage({ params }: Props) {
  const { date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <DayView date={date} />
    </main>
  );
}
