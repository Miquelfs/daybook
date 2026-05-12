const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST ${path} failed ${res.status}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed ${res.status}`);
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`DELETE ${path} failed ${res.status}`);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Transaction = {
  id: string;
  source: string;
  date: string;
  name: string;
  amount: number;        // raw sign: negative=expense, positive=income
  account: string | null;
  category: string | null;
  subcategory: string | null;
  transaction_type: string;
  notes: string | null;
  created_at: string;
};

export type TransactionCreate = {
  date?: string;         // defaults to today
  name: string;
  amount: number;        // always positive from UI; API applies sign
  category: string;
  subcategory?: string;
  account?: string;
  notes?: string;
};

export type TransactionPatch = Partial<Omit<TransactionCreate, "date"> & { date: string }>;

export type MerchantSuggestion = {
  name: string;
  last_used: string;
  category: string | null;
};

export type CategoryMeta = {
  key: string;
  emoji: string;
};

export type MoneyMeta = {
  categories: CategoryMeta[];
  accounts: string[];
  defaults: { account: string; category: string };
};

export type CategoryBudget = {
  category: string;
  spent: number;
  budget: number;
  remaining: number;
  velocity: number;
  status: string;
};

export type MonthHistory = {
  month: string;
  total_spent: number;
  total_income: number;
  savings: number;
  savings_rate: number;
  total_budget: number;
  on_budget: boolean;
};

export type SavingsStreak = {
  current_streak: number;
  best_streak: number;
  success_rate: number;
};

export type TrendsData = {
  months: MonthHistory[];
  savings_streak: SavingsStreak;
  avg_monthly_spent: number;
  avg_monthly_income: number;
  avg_savings_rate: number;
};

export type MonthSummary = {
  month: string;
  total_spent: number;
  total_income: number;
  total_budget: number;
  days_elapsed: number;
  days_in_month: number;
  velocity: number;
  categories: CategoryBudget[];
};

// ── API methods ───────────────────────────────────────────────────────────────

export const moneyApi = {
  addTransaction: (body: TransactionCreate) =>
    post<Transaction>("/money/transactions", body),

  transactions: (params: {
    start?: string;
    end?: string;
    category?: string;
    account?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const q = new URLSearchParams();
    if (params.start)    q.set("start", params.start);
    if (params.end)      q.set("end", params.end);
    if (params.category) q.set("category", params.category);
    if (params.account)  q.set("account", params.account);
    if (params.limit)    q.set("limit", String(params.limit));
    if (params.offset)   q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<Transaction[]>(`/money/transactions${qs ? `?${qs}` : ""}`);
  },

  patchTransaction: (id: string, body: TransactionPatch) =>
    patch<Transaction>(`/money/transactions/${id}`, body),

  deleteTransaction: (id: string) =>
    del(`/money/transactions/${id}`),

  merchants: (q: string) =>
    get<MerchantSuggestion[]>(`/money/autocomplete/merchants?q=${encodeURIComponent(q)}`),

  meta: () =>
    get<MoneyMeta>("/money/meta"),

  monthSummary: (month?: string) =>
    get<MonthSummary>(`/money/summary/month${month ? `?month=${month}` : ""}`),

  trends: (months?: number) =>
    get<TrendsData>(`/money/trends${months ? `?months=${months}` : ""}`),

  syncNotion: () =>
    post<{ status: string }>("/sync/notion", {}),
};

// ── Display helpers ───────────────────────────────────────────────────────────

export function fmtAmount(amount: number): string {
  return `€${Math.abs(amount).toFixed(2)}`;
}

export function isExpense(t: Transaction): boolean {
  return t.transaction_type === "Expense";
}
