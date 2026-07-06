const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Mutations go through the Next.js API proxy to avoid CORS issues from the browser.
// Reads go directly to the backend (GET requests are not CORS-preflight blocked for simple requests).
const PROXY_BASE = typeof window === "undefined" ? BASE : "";

// FastAPI error bodies are {"detail": "..."} — surface that instead of a bare
// status code, since `detail` is often the only actionable part of the message
// (e.g. "You already hold AMZN in ... — use Buy more instead").
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.detail === "string") return data.detail;
  } catch {
    // Body wasn't JSON — fall back to the generic message below.
  }
  return fallback;
}

async function get<T>(path: string): Promise<T> {
  // Timeout so one slow endpoint can never hang a server-rendered page.
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(await errorMessage(res, `${res.status} ${path}`));
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await errorMessage(res, `POST ${path} failed ${res.status}`));
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await errorMessage(res, `PATCH ${path} failed ${res.status}`));
  return res.json();
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res, `DELETE ${path} failed ${res.status}`));
}

// Proxy variants — mutations routed through Next.js /api/* to avoid browser CORS blocks.
async function proxyPost<T>(proxyPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await errorMessage(res, `POST ${proxyPath} failed ${res.status}`));
  return res.json();
}

async function proxyPatch<T>(proxyPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await errorMessage(res, `PATCH ${proxyPath} failed ${res.status}`));
  return res.json();
}

async function proxyDel(proxyPath: string): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${proxyPath}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res, `DELETE ${proxyPath} failed ${res.status}`));
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
  is_fixed: boolean;
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
  // Adjusted (discretionary-only) metrics — fixed bills amortised over the month
  adjusted_velocity: number;
  fixed_spent: number;
  fixed_budget: number;
  discretionary_spent: number;
  discretionary_budget: number;
  projected_month_end_adjusted: number;
  projected_savings_adjusted: number;
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

export type SubcategoryBreakdown = {
  subcategory: string;
  total: number;
  count: number;
  variance_flag: boolean;
};

export type CategoryStats = {
  category: string;
  total: number;
  avg_per_month: number;
  count: number;
  min_tx: number;
  max_tx: number;
  pct_of_total: number;
  subcategories: SubcategoryBreakdown[];
  variance_flag: boolean;
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

// ── Money intelligence (Track A-II) ───────────────────────────────────────────

export type WaterfallItem = {
  name: string;
  amount: number;
};

export type WaterfallData = {
  month: string;
  income: number;
  categories: WaterfallItem[];
  savings: number;
  savings_rate: number;
};

export type EfficiencyRow = {
  category: string;
  avg_actual: number;
  budget: number;
  aggressive_cap: number;
  recoverable_per_month: number;
  flag: "over_budget" | "recoverable" | "efficient";
};

export type EfficiencyData = {
  window_months: number;
  rows: EfficiencyRow[];
  total_recoverable: number;
};

export type MonthlyAnomaly = {
  month: string;
  metric: "expenses" | "income" | "savings";
  value: number;
  mean: number;
  std: number;
  z_score: number;
  severity: "high" | "medium";
};

export type MonthlySeriesPoint = {
  month: string;
  expenses: number;
  income: number;
  savings: number;
};

export type MonthlyAnomalyReport = {
  window_months: number;
  series: MonthlySeriesPoint[];
  anomalies: MonthlyAnomaly[];
};

export type SeasonalMonth = {
  month_num: number;
  label: string;
  avg_expenses: number;
  avg_income: number;
  avg_savings: number;
  n_years: number;
};

export type SeasonalData = {
  months: SeasonalMonth[];
  most_expensive: string | null;
  cheapest: string | null;
};

export type DailyTotal = {
  date: string;
  total_spend: number;
  by_category: Record<string, number>;
};

// ── Investment portfolio (Track A-I) ─────────────────────────────────────────

export type AssetClass =
  | "equity_etf" | "stock" | "crypto" | "bond_etf" | "cash" | "commodity";

export type HoldingCreate = {
  account: string;
  ticker: string;
  isin?: string | null;
  name: string;
  asset_class: AssetClass;
  currency?: string;
  quantity: number;
  cost_basis_eur?: number | null;
  first_bought_at?: string | null;
  notes?: string | null;
};

export type HoldingPatch = Partial<{
  quantity: number;
  cost_basis_eur: number | null;
  name: string;
  ticker: string;
  isin: string | null;
  asset_class: AssetClass;
  account: string;
  notes: string | null;
  is_active: boolean;
}>;

export type Holding = {
  id: string;
  account: string;
  ticker: string;
  isin: string | null;
  name: string;
  asset_class: AssetClass;
  currency: string;
  quantity: number;
  cost_basis_eur: number | null;
  first_bought_at: string | null;
  notes: string | null;
  is_active: boolean;
  current_price_eur: number | null;
  market_value_eur: number | null;
  unrealized_pnl_eur: number | null;
  unrealized_pnl_pct: number | null;
  day_change_eur: number | null;
  day_change_pct: number | null;
  ytd_change_pct: number | null;
  price_as_of: string | null;
  allocation_pct: number | null;
};

export type AllocationSlice = {
  label: string;
  value_eur: number;
  pct: number;
};

export type Mover = {
  holding_id: string;
  ticker: string;
  name: string;
  day_change_eur: number;
  day_change_pct: number;
};

export type PortfolioOverview = {
  as_of: string;
  total_value_eur: number;
  total_cost_basis_eur: number;
  total_pnl_eur: number;
  total_pnl_pct: number;
  day_change_eur: number;
  day_change_pct: number;
  ytd_pnl_eur: number;
  ytd_pnl_pct: number;
  allocation_by_class: AllocationSlice[];
  allocation_by_account: AllocationSlice[];
  allocation_by_currency: AllocationSlice[];
  top_movers_up: Mover[];
  top_movers_down: Mover[];
  top_holdings: Holding[];
  holdings_count: number;
  liquid_accounts: AccountBalance[];
};

export type PortfolioHistoryPoint = {
  date: string;
  total_value_eur: number;
  invested_eur: number;
};

export type HoldingHistoryPoint = {
  date: string;
  quantity: number;
  price_eur: number;
  value_eur: number;
};

export type PortfolioRange = "1M" | "3M" | "YTD" | "1Y" | "ALL";

export type SellHoldingBody = {
  to_account: string;
  quantity?: number;    // omit = sell everything
  price_eur?: number;   // omit = latest cached close
  date?: string;
  notes?: string;
};

export type SellResult = {
  holding: Holding;
  transaction_id: string;
  quantity_sold: number;
  price_eur: number;
  proceeds_eur: number;
};

export type BuyHoldingBody = {
  from_account: string;
  quantity: number;
  price_eur?: number;   // omit = fetch today's live price
  date?: string;
  notes?: string;
};

export type BuyResult = {
  holding: Holding;
  transaction_id: string;
  quantity_bought: number;
  price_eur: number;
  cost_eur: number;
};

export type IsinCandidate = {
  ticker: string;
  name: string | null;
  exchange: string | null;
  exchange_code: string | null;
  currency: string | null;
};

export type IsinLookupResult = {
  isin: string;
  candidates: IsinCandidate[];
};

// ── Recurring Investment Plans (DCA) ─────────────────────────────────────────

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export type InvestmentPlanCreate = {
  holding_id: string;
  source_account: string;
  amount_eur: number;
  cadence: Cadence;
  day_of_month?: number | null;
  day_of_week?: number | null;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
};

export type InvestmentPlanPatch = Partial<{
  amount_eur: number;
  cadence: Cadence;
  day_of_month: number | null;
  day_of_week: number | null;
  source_account: string;
  end_date: string | null;
  next_execution_date: string;
  is_active: boolean;
  notes: string | null;
}>;

export type InvestmentPlan = {
  id: number;
  holding_id: string;
  ticker: string;
  holding_name: string;
  holding_account: string;
  source_account: string;
  amount_eur: number;
  cadence: Cadence;
  day_of_month: number | null;
  day_of_week: number | null;
  start_date: string;
  end_date: string | null;
  next_execution_date: string;
  last_executed_at: string | null;
  is_active: boolean;
  notes: string | null;
  total_contributed_eur: number;
  total_quantity_added: number;
  executions_count: number;
  monthly_equivalent_eur: number;
};

export type PlanExecution = {
  id: number;
  plan_id: number;
  execution_date: string;
  amount_eur: number;
  price_eur: number;
  quantity_added: number;
  transaction_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

export type PlanRunResult = {
  executed: PlanExecution[];
  dry_run: boolean;
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

  portfolioOverview: () =>
    get<PortfolioOverview>("/money/portfolio/overview"),

  portfolioHoldings: (opts?: { account?: string; asset_class?: AssetClass; include_inactive?: boolean }) => {
    const p = new URLSearchParams();
    if (opts?.account) p.set("account", opts.account);
    if (opts?.asset_class) p.set("asset_class", opts.asset_class);
    if (opts?.include_inactive) p.set("include_inactive", "true");
    const qs = p.toString();
    return get<Holding[]>(`/money/portfolio/holdings${qs ? `?${qs}` : ""}`);
  },

  portfolioHistory: (range: PortfolioRange = "1Y") =>
    get<PortfolioHistoryPoint[]>(`/money/portfolio/history?range=${range}`),

  holdingHistory: (id: string, range: PortfolioRange = "1Y") =>
    get<HoldingHistoryPoint[]>(`/money/portfolio/holding/${encodeURIComponent(id)}/history?range=${range}`),

  createHolding: (body: HoldingCreate) =>
    proxyPost<Holding>("/api/money/portfolio/holdings", body),

  patchHolding: (id: string, body: HoldingPatch) =>
    proxyPatch<Holding>(`/api/money/portfolio/holdings/${encodeURIComponent(id)}`, body),

  deleteHolding: (id: string) =>
    proxyDel(`/api/money/portfolio/holdings/${encodeURIComponent(id)}`),

  sellHolding: (id: string, body: SellHoldingBody) =>
    proxyPost<SellResult>(`/api/money/portfolio/holdings/${encodeURIComponent(id)}/sell`, body),

  buyHolding: (id: string, body: BuyHoldingBody) =>
    proxyPost<BuyResult>(`/api/money/portfolio/holdings/${encodeURIComponent(id)}/buy`, body),

  isinLookup: (isin: string) =>
    get<IsinLookupResult>(`/money/portfolio/isin-lookup?isin=${encodeURIComponent(isin)}`),

  // Recurring plans
  listPlans: (include_inactive = false) =>
    get<InvestmentPlan[]>(`/money/portfolio/plans${include_inactive ? "?include_inactive=true" : ""}`),

  planExecutions: (planId: number, limit = 100) =>
    get<PlanExecution[]>(`/money/portfolio/plans/${planId}/executions?limit=${limit}`),

  createPlan: (body: InvestmentPlanCreate) =>
    proxyPost<InvestmentPlan>("/api/money/portfolio/plans", body),

  patchPlan: (id: number, body: InvestmentPlanPatch) =>
    proxyPatch<InvestmentPlan>(`/api/money/portfolio/plans/${id}`, body),

  deletePlan: (id: number) =>
    proxyDel(`/api/money/portfolio/plans/${id}`),

  runDuePlans: (dry_run = false) =>
    proxyPost<PlanRunResult>(`/api/money/portfolio/plans/run-due${dry_run ? "?dry_run=true" : ""}`, {}),


  spendingPatterns: (month?: string) =>
    get<SpendingPatterns>(`/money/spending/patterns${month ? `?month=${month}` : ""}`),

  categoryStats: () =>
    get<CategoryStats[]>("/money/categories/stats"),

  anomalies: (month?: string) =>
    get<AnomalyReport>(`/money/anomalies${month ? `?month=${month}` : ""}`),

  // Intelligence layer (Track A-II)
  waterfall: (month?: string) =>
    get<WaterfallData>(`/money/waterfall${month ? `?month=${month}` : ""}`),

  efficiency: (window = 12) =>
    get<EfficiencyData>(`/money/efficiency?window=${window}`),

  monthlyAnomalies: (window = 24) =>
    get<MonthlyAnomalyReport>(`/money/anomalies/monthly?window=${window}`),

  seasonal: () =>
    get<SeasonalData>("/money/seasonal"),

  dailyTotals: (start: string, end: string) =>
    get<DailyTotal[]>(`/money/daily-totals?start=${start}&end=${end}`),

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
