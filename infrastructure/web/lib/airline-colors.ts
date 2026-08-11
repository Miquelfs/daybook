// Route / airline colours keyed by canonical airline name. Vueling yellow,
// Ryanair blue, Norwegian red — the rest fill in as more airlines are flown.
export const AIRLINE_COLORS: Record<string, string> = {
  Vueling: "#FACC15",             // yellow
  Ryanair: "#3B82F6",             // blue
  Norwegian: "#EF4444",           // red
  Iberia: "#EAB308",              // gold
  "American Airlines": "#60A5FA", // light blue
  Lufthansa: "#F5C518",           // Lufthansa yellow
  "TAP Air Portugal": "#22C55E",  // green
  "Air Europa": "#38BDF8",        // sky
  "Wizz Air": "#D946EF",          // magenta
  LEVEL: "#14B8A6",               // teal
  Transavia: "#22D3EE",           // cyan
  Joon: "#FB923C",                // orange
  "Air China": "#F43F5E",         // rose
  "Air Berlin": "#F97316",        // orange
};

export const DEFAULT_AIRLINE_COLOR = "#71717A";

export function airlineColor(name: string | null | undefined): string {
  if (!name) return DEFAULT_AIRLINE_COLOR;
  if (name in AIRLINE_COLORS) return AIRLINE_COLORS[name];
  const low = name.toLowerCase();
  for (const [key, color] of Object.entries(AIRLINE_COLORS)) {
    if (low.includes(key.toLowerCase())) return color;
  }
  return DEFAULT_AIRLINE_COLOR;
}
