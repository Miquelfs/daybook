// Account badge colors matched to Notion color scheme.
// Plain module (no "use client") so both server components (portfolio page)
// and client components (TransactionList, pills) can import it.
export const ACCOUNT_COLORS: Record<string, { bg: string; text: string }> = {
  "BBVA Diaria":                  { bg: "bg-blue-900/40",   text: "text-blue-300" },
  "BBVA Estalvis":                { bg: "bg-teal-900/40",   text: "text-teal-300" },
  "Trade Republic Cash":          { bg: "bg-amber-900/30",  text: "text-amber-400" },
  "Trade Republic Wealth":        { bg: "bg-zinc-700/40",   text: "text-zinc-300" },
  "Revolut":                      { bg: "bg-violet-900/40", text: "text-violet-300" },
  "Revolut Cripto":               { bg: "bg-orange-900/40", text: "text-orange-300" },
  "Revolut Flexible Cash Funds":  { bg: "bg-pink-900/40",   text: "text-pink-300" },
  "Sabadell":                     { bg: "bg-sky-900/40",    text: "text-sky-300" },
  "Cash":                         { bg: "bg-zinc-800/60",   text: "text-zinc-400" },
  "Mapfre Inversió":              { bg: "bg-yellow-900/40", text: "text-yellow-300" },
  "Accions":                      { bg: "bg-rose-900/40",   text: "text-rose-300" },
  "Binance":                      { bg: "bg-emerald-900/40", text: "text-emerald-300" },
};

export function accountBadgeClass(account: string): { bg: string; text: string } {
  return ACCOUNT_COLORS[account] ?? { bg: "bg-zinc-800/60", text: "text-zinc-400" };
}
