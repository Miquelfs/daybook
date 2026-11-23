// Bank statements (reconciliation) and vehicles — both called from client components through the
// Next proxies (/api/money/statements/*, /api/vehicles/*), so reads and writes share one path.

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    cache: "no-store",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}),
  });
  if (!res.ok) {
    let msg = `${res.status} ${path}`;
    try { const d = await res.json(); if (typeof d?.detail === "string") msg = d.detail; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

// ── Statements ────────────────────────────────────────────────────────────────

export type StmtTxn = { id: string; date: string; name: string; amount: number; category: string | null; subcategory: string | null };

export type StmtLine = {
  id: number; date: string; description: string; amount: number; balance: number | null; currency: string | null;
  txn?: StmtTxn; how?: "exact" | "near" | "manual"; days_off?: number;
  suggest?: { name: string; category: string | null; subcategory: string | null };
  candidates?: StmtTxn[];
  kind?: StmtKind | null;
  elsewhere?: (StmtTxn & { account: string })[];      // the same thing, logged on another account
};

export type StmtKind = "card" | "transfer" | "investment" | "interest" | "dividend" | "cashback" | "fee" | "tax" | "other";
export const STMT_KIND_LABEL: Record<StmtKind, string> = {
  card: "Card", transfer: "Transfer", investment: "Investment", interest: "Interest", dividend: "Dividend",
  cashback: "Cashback", fee: "Fee", tax: "Tax", other: "Other",
};

export type Reconcile = {
  account: string;
  has_statement: boolean;
  start?: string; end?: string; coverage?: [string, string];
  counts?: { lines: number; matched: number; differs: number; missing: number; only_daybook: number; ignored: number };
  totals?: { missing: number; only_daybook: number; differs: number; bank_out: number; bank_in: number };
  balance?: {
    opening_date: string; bank_opening: number; daybook_opening: number; opening_gap: number;
    closing_date: string; bank_closing: number; daybook_closing: number; closing_gap: number; chain_breaks: number;
  } | null;
  mirror_account?: string | null;                     // where a buy / sell lands (Trade Republic Cash → … Wealth)
  adjustments?: { id: string; date: string; name: string; amount: number }[];
  // settled periods are closed: their leftovers are in the 🚨 adjustment and set aside here
  settled?: { through: string | null; missing: StmtLine[]; only_daybook: StmtTxn[] };
  missing?: StmtLine[]; differs?: StmtLine[]; only_daybook?: StmtTxn[]; matched?: StmtLine[]; ignored?: StmtLine[];
};

export type StmtImport = {
  id: number; account: string; filename: string | null; bank: string | null;
  period_start: string; period_end: string; lines_total: number; lines_new: number; imported_at: string;
};

export type StmtUpload = {
  import_id: number; account: string; bank: string | null; period_start: string; period_end: string;
  lines_total: number; lines_new: number; skipped: number; notes: string[];
};

export type StmtStatus = {
  account: string; coverage: [string, string]; missing: number; only_daybook: number; differs: number;
  closing_gap: number | null; last_import: string;
};

export const statementsApi = {
  upload: (account: string, file: File) => {
    const fd = new FormData();
    fd.append("account", account);
    fd.append("file", file);
    return call<StmtUpload>("/money/statements", { method: "POST", body: fd });
  },
  imports: (account?: string) =>
    call<StmtImport[]>(`/money/statements${account ? `?account=${encodeURIComponent(account)}` : ""}`),
  deleteImport: (id: number) => call<unknown>(`/money/statements/${id}`, { method: "DELETE" }),
  status: () => call<StmtStatus[]>("/money/statements/status"),
  reconcile: (account: string, start?: string, end?: string) => {
    const q = new URLSearchParams({ account });
    if (start) q.set("start", start);
    if (end) q.set("end", end);
    return call<Reconcile>(`/money/statements/reconcile?${q}`);
  },
  add: (lineId: number, body: { name: string; category: string; subcategory?: string; vehicle_id?: number; mirror_account?: string }) =>
    call<{ txn_id: string }>(`/money/statements/lines/${lineId}/add`, { method: "POST", json: body }),
  link: (lineId: number, txnId: string) =>
    call<unknown>(`/money/statements/lines/${lineId}/link`, { method: "POST", json: { txn_id: txnId } }),
  unlink: (lineId: number) => call<unknown>(`/money/statements/lines/${lineId}/unlink`, { method: "POST", json: {} }),
  ignore: (lineId: number, ignored = true) =>
    call<unknown>(`/money/statements/lines/${lineId}/ignore`, { method: "POST", json: { ignored } }),
  move: (lineId: number, txnId: string) =>
    call<unknown>(`/money/statements/lines/${lineId}/move`, { method: "POST", json: { txn_id: txnId } }),
  addAll: (account: string, start?: string, end?: string) =>
    call<{ alert: number; filed: number; left: number }>("/money/statements/add-all", { method: "POST", json: { account, start, end } }),
  settle: (account: string, start?: string, end?: string) =>
    call<{ added: { id: string; date: string; name: string; amount: number }[] }>("/money/statements/settle",
      { method: "POST", json: { account, start, end } }),
  unsettle: (account: string) => call<unknown>("/money/statements/unsettle", { method: "POST", json: { account } }),
  useBankAmount: (lineId: number, txnId: string) =>
    call<unknown>(`/money/statements/lines/${lineId}/use-bank-amount`, { method: "POST", json: { txn_id: txnId } }),
};

// ── Vehicles ──────────────────────────────────────────────────────────────────

export type VehicleKind = "car" | "scooter" | "motorbike" | "other";

export type Vehicle = {
  id: number; name: string; kind: VehicleKind; make_model: string | null; plate: string | null; year: number | null;
  fuel: string | null; bought_on: string | null; bought_km: number | null; bought_price: number | null;
  sold_on: string | null; day_tag: string | null; subcategories: string[]; notes: string | null;
};

export type VehicleOverview = {
  vehicle: Vehicle; odometer: number | null; reading_age_days: number | null; km_period: number;
  cost_period: number; per_km_period: number | null; per_month: number;
  gps: { days: number; km: number; km_period: number };
  days_used_period: number;
  next_reminder?: ({ title: string } & ReminderDue) | null;
};

export type VehicleSummary = VehicleOverview & {
  days_used: number;
  last_reading: { date: string; km: number } | null;
  km_total: number; cost_total: number; per_km: number | null;
  by_subcategory: { subcategory: string; amount: number; count: number }[];
  series: { month: string; km: number; gps_km: number; cost: number }[];
  months: number;
};

export type OdoReading = { id: number; date: string; km: number; note: string | null };
export type VehicleCost = {
  id: string; date: string; name: string; amount: number; account: string | null; subcategory: string | null;
  notes: string | null; vehicle_id: number | null; linked: boolean;
};
export type VehicleDay = {
  date: string; km: number; minutes: number; legs: number; start_place: string | null; end_place: string | null; picked: boolean;
};
export type InboxLeg = {
  date: string; start: string; end: string; km: number; minutes: number; start_place: string | null; end_place: string | null;
  how: "untagged" | "both";
};
export type ReminderDue = {
  date: string | null; by: "date" | "km" | null; km: number | null; km_left: number | null; days_left: number | null;
  odometer: number | null; pace_km_day: number | null;
};
export type Reminder = {
  id: number; vehicle_id: number; title: string; every_months: number | null; every_km: number | null;
  last_date: string | null; last_km: number | null; due_date: string | null; remind_days: number; task_id: number | null;
  notes: string | null; due: ReminderDue;
};
export type ReminderInput = Partial<Pick<Reminder, "title" | "every_months" | "every_km" | "last_date" | "last_km" | "due_date" | "remind_days" | "notes">>;
export type ReminderPreset = { title: string; every_months: number | null; every_km: number | null };
export type VehicleRoute = { date: string; legs: [number, number][][] };
export type VehiclesOnDay = {
  vehicles: { id: number; name: string; kind: VehicleKind }[];
  legs: { start: string; end: string; km: number; vehicle_id: number | null; how: string }[];
};
export type TransportSub = { subcategory: string; count: number; total: number; last: string };

export type VehicleInput = Partial<Omit<Vehicle, "id">>;

export const vehiclesApi = {
  list: () => call<VehicleOverview[]>("/vehicles"),
  create: (body: VehicleInput) => call<Vehicle>("/vehicles", { method: "POST", json: body }),
  get: (id: number, months = 12) => call<VehicleSummary>(`/vehicles/${id}?months=${months}`),
  patch: (id: number, body: VehicleInput) => call<Vehicle>(`/vehicles/${id}`, { method: "PATCH", json: body }),
  remove: (id: number) => call<unknown>(`/vehicles/${id}`, { method: "DELETE" }),
  subcategories: () => call<TransportSub[]>("/vehicles/subcategories"),
  odometer: (id: number) => call<OdoReading[]>(`/vehicles/${id}/odometer`),
  addOdometer: (id: number, body: { date: string; km: number; note?: string }) =>
    call<OdoReading>(`/vehicles/${id}/odometer`, { method: "POST", json: body }),
  deleteOdometer: (id: number, rid: number) => call<unknown>(`/vehicles/${id}/odometer/${rid}`, { method: "DELETE" }),
  costs: (id: number) => call<VehicleCost[]>(`/vehicles/${id}/costs`),
  addCost: (id: number, body: { date: string; name: string; amount: number; subcategory?: string; account?: string; odometer_km?: number }) =>
    call<{ txn_id: string; odometer_error?: string }>(`/vehicles/${id}/costs`, { method: "POST", json: body }),
  days: (id: number, limit = 60) => call<VehicleDay[]>(`/vehicles/${id}/days?limit=${limit}`),
  routes: (id: number, months = 12) => call<VehicleRoute[]>(`/vehicles/${id}/routes?months=${months}`),
  refresh: () => call<{ days: number }>("/vehicles/refresh?all=true", { method: "POST", json: {} }),
  inbox: () => call<InboxLeg[]>("/vehicles/inbox"),
  pickLeg: (date: string, start: string, vehicle_id: number) =>
    call<unknown>("/vehicles/legs/pick", { method: "POST", json: { date, start, vehicle_id } }),
  onDay: (date: string) => call<VehiclesOnDay>(`/vehicles/on/${date}`),
  // a stretch tapped on the day map: whichever drive touches it is this vehicle's (0 = not mine)
  pickStretch: (date: string, start: string, end: string, vehicle_id: number) =>
    call<VehiclesOnDay>("/vehicles/legs/pick", { method: "POST", json: { date, start, end, vehicle_id } }),
  reminders: (id: number) => call<Reminder[]>(`/vehicles/${id}/reminders`),
  presets: () => call<Record<string, ReminderPreset[]>>("/vehicles/reminders/presets"),
  addReminder: (id: number, body: ReminderInput) => call<unknown>(`/vehicles/${id}/reminders`, { method: "POST", json: body }),
  patchReminder: (rid: number, body: ReminderInput) => call<unknown>(`/vehicles/reminders/${rid}`, { method: "PATCH", json: body }),
  deleteReminder: (rid: number) => call<unknown>(`/vehicles/reminders/${rid}`, { method: "DELETE" }),
  reminderDone: (rid: number, body: { date: string; km?: number; cost?: { amount: number; account?: string; name?: string } }) =>
    call<{ odometer_error?: string }>(`/vehicles/reminders/${rid}/done`, { method: "POST", json: body }),
};

export const KIND_LABEL: Record<VehicleKind, string> = { car: "Car", scooter: "Scooter", motorbike: "Motorbike", other: "Other" };
export const DEFAULT_TAG: Partial<Record<VehicleKind, string>> = { car: "car_drive", scooter: "motorcycle", motorbike: "motorcycle" };
