// IATA codes for ~150 major world airlines, keyed by the short common name
// someone would actually type into a free-text "Airline" field. Used both to
// fetch a small logo from a public airline-logo CDN and (in PassengerFlightForm)
// to auto-fill a real `airline_code` when the typed name matches one of these —
// after that, matching is exact on the stored code, so it isn't limited to
// this list forever. An airline typed that isn't here (or given no code)
// simply won't have a logo until it's added.
export const AIRLINE_IATA: Record<string, string> = {
  // Europe
  Ryanair: "FR",
  Vueling: "VY",
  Iberia: "IB",
  "Iberia Express": "I2",
  "Air Europa": "UX",
  "TAP Air Portugal": "TP",
  Lufthansa: "LH",
  Swiss: "LX",
  Austrian: "OS",
  "Brussels Airlines": "SN",
  KLM: "KL",
  "Air France": "AF",
  "British Airways": "BA",
  easyJet: "U2",
  "Wizz Air": "W6",
  Norwegian: "DY",
  SAS: "SK",
  Finnair: "AY",
  Icelandair: "FI",
  PLAY: "OG",
  "Turkish Airlines": "TK",
  "Pegasus Airlines": "PC",
  "Aegean Airlines": "A3",
  "ITA Airways": "AZ",
  Alitalia: "AZ",
  "LOT Polish Airlines": "LO",
  "Czech Airlines": "OK",
  "Air Serbia": "JU",
  "Croatia Airlines": "OU",
  airBaltic: "BT",
  Eurowings: "EW",
  Condor: "DE",
  "TUI fly": "X3",
  Jet2: "LS",
  Loganair: "LM",
  "Aer Lingus": "EI",
  Volotea: "V7",
  Transavia: "HV",
  LEVEL: "LV",
  Joon: "JN",
  "Air Berlin": "AB",
  "Norse Atlantic": "N0",

  // Middle East
  Emirates: "EK",
  Etihad: "EY",
  "Qatar Airways": "QR",
  "Oman Air": "WY",
  Saudia: "SV",
  "Royal Jordanian": "RJ",
  "El Al": "LY",
  "Kuwait Airways": "KU",
  "Gulf Air": "GF",
  flydubai: "FZ",
  "Air Arabia": "G9",

  // Asia
  "Singapore Airlines": "SQ",
  "Cathay Pacific": "CX",
  ANA: "NH",
  "Japan Airlines": "JL",
  "Korean Air": "KE",
  "Asiana Airlines": "OZ",
  "Thai Airways": "TG",
  "China Airlines": "CI",
  "EVA Air": "BR",
  "Air China": "CA",
  "China Eastern": "MU",
  "China Southern": "CZ",
  "Hainan Airlines": "HU",
  "Vietnam Airlines": "VN",
  "Malaysia Airlines": "MH",
  AirAsia: "AK",
  "Garuda Indonesia": "GA",
  "Philippine Airlines": "PR",
  "Cebu Pacific": "5J",
  IndiGo: "6E",
  "Air India": "AI",
  Vistara: "UK",
  SpiceJet: "SG",
  Jetstar: "JQ",
  "Jetstar Asia": "3K",

  // Oceania
  Qantas: "QF",
  "Virgin Australia": "VA",
  "Air New Zealand": "NZ",

  // Americas
  "American Airlines": "AA",
  "Delta Air Lines": "DL",
  Delta: "DL",
  "United Airlines": "UA",
  "Southwest Airlines": "WN",
  JetBlue: "B6",
  "Alaska Airlines": "AS",
  "Spirit Airlines": "NK",
  "Frontier Airlines": "F9",
  "Air Canada": "AC",
  WestJet: "WS",
  LATAM: "LA",
  Avianca: "AV",
  "Copa Airlines": "CM",
  Aeromexico: "AM",
  Volaris: "Y4",
  "GOL Linhas Aéreas": "G3",
  "Azul Brazilian Airlines": "AD",

  // Africa
  "Ethiopian Airlines": "ET",
  "Kenya Airways": "KQ",
  "South African Airways": "SA",
  EgyptAir: "MS",
  "Royal Air Maroc": "AT",
};

/** Best-effort IATA code for a logo lookup: prefers an explicit code already
 * on the flight, falls back to matching the airline name (exact, then a
 * loose two-way substring match for partial/extended names). */
export function airlineIataCode(name: string | null | undefined, code?: string | null): string | null {
  if (code && /^[A-Z0-9]{2,3}$/.test(code)) return code;
  if (!name) return null;
  if (name in AIRLINE_IATA) return AIRLINE_IATA[name];
  const low = name.toLowerCase().trim();
  for (const [key, iata] of Object.entries(AIRLINE_IATA)) {
    const k = key.toLowerCase();
    if (low.includes(k) || k.includes(low)) return iata;
  }
  return null;
}

export function airlineLogoUrl(name: string | null | undefined, code?: string | null): string | null {
  const iata = airlineIataCode(name, code);
  return iata ? `https://images.kiwi.com/airlines/64/${iata}.png` : null;
}
