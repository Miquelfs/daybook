import { redirect } from "next/navigation";

// Training is its own home now: Omyra (top bar). Old links and tabs land in the right place.
const TAB: Record<string, string> = { overview: "", omyra: "plan", fuel: "fuel", load: "load", log: "log", progress: "progress", map: "map" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  const t = q.get("tab");
  if (t !== null) {
    const mapped = TAB[t] ?? t;
    if (mapped) q.set("tab", mapped); else q.delete("tab");
  }
  redirect(`/omyra${q.size ? `?${q}` : ""}`);
}
