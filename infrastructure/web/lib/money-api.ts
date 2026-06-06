const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Mutations go through the Next.js API proxy to avoid CORS issues from the browser.
// Reads go directly to the backend (GET requests are not CORS-preflight blocked for simple requests).
const PROXY_BASE = typeof window === "undefined" ? BASE : "";

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

// Proxy variants — mutations routed through Next.js /api/* to avoid browser CORS blocks.
async function proxyPost<T>(proxyPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`POST ${proxyPath} failed ${res.status}`);
  return res.json();
}

async function proxyPatch<T>(proxyPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PATCH ${proxyPath} failed ${res.status}`);
  return res.json();
}

async function proxyDel(proxyPath: string): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`DELETE ${proxyPath} failed ${res.status}`);
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
  amount: number;        // always positive from UI; API applies sign based on sign field
  sign?: "+" | "-";     // "-" = expense (default), "+" = reimbursement / income
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

export type CategoryMonthSpend = {
  category: string;
  month: string;
  spent: number;
};

export type CategoryTrendsData = {
  items: CategoryMonthSpend[];
  months: string[];
  categories: string[];
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

export type BudgetAlert = {
  category: string;
  velocity: number;
  spent: number;
  budget: number;
  status: string;
};

export type MonthOverview = MonthSummary & {
  daily_burn_rate: number;
  projected_month_end: number;
  projected_savings: number;
  alerts: BudgetAlert[];
};

export type MonthDetail = {
  month: string;
  income: number;
  spent: number;
  savings: number;
  savings_rate: number;
  mom_income_pct: number | null;
  mom_expenses_pct: number | null;
  yoy_income_pct: number | null;
  yoy_expenses_pct: number | null;
};

export type HistoricalData = {
  months: MonthDetail[];
  avg_monthly_income: number;
  avg_monthly_spent: number;
  avg_savings_rate: number;
};

export type ForecastData = {
  predicted_spent: number;
  predicted_income: number;
  predicted_savings: number;
  based_on_months: string[];
};

export type AccountBalance = {
  name: string;
  balance: number;
  account_type: string;
};

export type PortfolioSummary = {
  accounts: AccountBalance[];
  total_net_worth: number;
  total_investments: number;
  total_liquid: number;
  investment_pct: number;
  liquid_pct: number;
};


export type DaySpend = {
  day_name: string;
  total: number;
};

export type WeekSpend = {
  week_num: number;
  total: number;
};

export type SpendingPatterns = {
  by_day: DaySpend[];
  by_week: WeekSpend[];
};

export type CategoryStats = {
  category: string;
  total: number;
  avg_per_month: number;
  count: number;
  min_tx: number;
  max_tx: number;
  pct_of_total: number;
};

export type LargeTxAnomaly = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string | null;
  account: string | null;
  ratio: number;
};

export type CategorySpikeAnomaly = {
  category: string;
  current_spent: number;
  avg_spent: number;
  ratio: number;
};

export type AnomalyReport = {
  month: string;
  large_transactions: LargeTxAnomaly[];
  category_spikes: CategorySpikeAnomaly[];
};

// ── API methods ───────────────────────────────────────────────────────────────

export const moneyApi = {
  addTransaction: (body: TransactionCreate) =>
    proxyPost<Transaction>("/api/money/transactions", body),

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
    proxyPatch<Transaction>(`/api/money/transactions/${id}`, body),

  deleteTransaction: (id: string) =>
    proxyDel(`/api/money/transactions/${id}`),

  merchants: (q: string) =>
    get<MerchantSuggestion[]>(`/money/autocomplete/merchants?q=${encodeURIComponent(q)}`),

  meta: () =>
    get<MoneyMeta>("/money/meta"),

  monthSummary: (month?: string) =>
    get<MonthSummary>(`/money/summary/month${month ? `?month=${month}` : ""}`),

  trends: (months?: number) =>
    get<TrendsData>(`/money/trends${months ? `?months=${months}` : ""}`),

  categoryTrends: (months?: number) =>
    get<CategoryTrendsData>(`/money/trends/categories${months ? `?months=${months}` : ""}`),

  syncNotion: () =>
    post<{ status: string }>("/sync/notion", {}),

  monthOverview: (month?: string) =>
    get<MonthOverview>(`/money/overview${month ? `?month=${month}` : ""}`),

  historicalTrends: (months?: number) =>
    get<HistoricalData>(`/money/trends/historical${months ? `?months=${months}` : ""}`),

  forecast: () =>
    get<ForecastData>("/money/trends/forecast"),

  portfolio: () =>
    get<PortfolioSummary>("/money/portfolio"),


  spendingPatterns: (month?: string) =>
    get<SpendingPatterns>(`/money/spending/patterns${month ? `?month=${month}` : ""}`),

  categoryStats: () =>
    get<CategoryStats[]>("/money/categories/stats"),

  anomalies: (month?: string) =>
    get<AnomalyReport>(`/money/anomalies${month ? `?month=${month}` : ""}`),

  subcategories: (category: string, q?: string) => {
    const params = new URLSearchParams({ category });
    if (q) params.set("q", q);
    return get<string[]>(`/money/autocomplete/subcategories?${params.toString()}`);
  },
};

// ── Display helpers ───────────────────────────────────────────────────────────

export function fmtAmount(amount: number): string {
  return `€${Math.abs(amount).toFixed(2)}`;
}

export function isExpense(t: Transaction): boolean {
  return t.amount < 0;
}

export function isIncome(t: Transaction): boolean {
  return t.amount >= 0;
}
