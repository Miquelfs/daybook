import { redirect } from "next/navigation";

// The race cockpit now lives inside Omyra (first tab). Keep old links working,
// including the weekend nudge (/race?plan=next).
export default async function RacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  redirect(`/omyra${q.size ? `?${q}` : ""}`);
}
