// IATA codes for the airlines already in AIRLINE_COLORS, used to fetch a
// small logo from a public airline-logo CDN. Flights don't reliably have
// airline_code set (the add form only captures the free-text airline name),
// so we resolve by name the same way airlineColor() does.
const AIRLINE_IATA: Record<string, string> = {
  Vueling: "VY",
  Ryanair: "FR",
  Norwegian: "DY",
  Iberia: "IB",
  "American Airlines": "AA",
  Lufthansa: "LH",
  "TAP Air Portugal": "TP",
  "Air Europa": "UX",
  "Wizz Air": "W6",
  LEVEL: "LV",
  Transavia: "HV",
  Joon: "JN",
  "Air China": "CA",
  "Air Berlin": "AB",
};

/** Best-effort IATA code for a logo lookup: prefers an explicit code already
 * on the flight, falls back to matching the airline name. */
export function airlineIataCode(name: string | null | undefined, code?: string | null): string | null {
  if (code && /^[A-Z0-9]{2,3}$/.test(code)) return code;
  if (!name) return null;
  if (name in AIRLINE_IATA) return AIRLINE_IATA[name];
  const low = name.toLowerCase();
  for (const [key, iata] of Object.entries(AIRLINE_IATA)) {
    if (low.includes(key.toLowerCase())) return iata;
  }
  return null;
}

export function airlineLogoUrl(name: string | null | undefined, code?: string | null): string | null {
  const iata = airlineIataCode(name, code);
  return iata ? `https://images.kiwi.com/airlines/64/${iata}.png` : null;
}
