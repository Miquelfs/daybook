import { FLAG } from "@/lib/flags";

/** A place's flag emoji — none for Spain (home: neither the Spanish nor the Catalan flag), the
 *  `fallback` when the country isn't known. `region` is accepted for callers that pass it. */
export function Flag({ country, fallback = "🌍" }: {
  country: string | null | undefined;
  region?: string | null;
  size?: number;
  fallback?: string;
}) {
  if (country === "Spain" || country === "España") return null;
  return <>{FLAG[country ?? ""] ?? fallback}</>;
}
