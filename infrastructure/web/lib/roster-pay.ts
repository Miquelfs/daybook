// Payslip estimate (CLA II ESP) — mirrors domains/aviation/pay.py

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PerDiemType =
  | "int_no_overnight" | "int_int_overnight" | "int_nat_overnight"
  | "nat_no_overnight" | "nat_nat_overnight";

export const PER_DIEM_LABEL: Record<PerDiemType, string> = {
  int_no_overnight: "Intl, no overnight",
  int_int_overnight: "Intl overnight abroad",
  int_nat_overnight: "Intl, overnight in Spain",
  nat_no_overnight: "National, no overnight",
  nat_nat_overnight: "National overnight",
};

export type DayStatus = "as_planned" | "activated" | "not_flown" | "extra_duty" | "changed";

export interface PayOverride {
  standby_paid?: number | null;
  per_diem?: PerDiemType | "none" | null;
  positioning?: number | null;
  bdo?: number | null;
  note?: string | null;
}

export interface PayDay {
  date: string;
  planned: string | null;
  planned_code: string | null;
  status: DayStatus;
  projected: boolean;
  route: string;
  block_hours: number;
  sectors: number;
  activated: boolean;
  bdo_candidate: boolean;
  sim: boolean;
  vacation: boolean;
  sleeps_at: string | null;
  auto_standby_paid: boolean;
  auto_per_diem: PerDiemType | null;
  auto_positioning: number;
  override: PayOverride;
  standby_paid: boolean;
  per_diem: PerDiemType | null;
  positioning: number;
  bdo: number;
  note: string | null;
}

export interface PayLine {
  code: string;
  key: string;
  label: string;
  amount: number;
  units?: number;
  rate?: number;
  in_kind?: boolean;
  per_diem?: boolean;
}

export interface PayEstimate {
  activity_month: string;
  payslip_month: string;
  category: "FO" | "CPT";
  level: number;
  irpf_pct: number;
  jornada_pct: number;
  jornada_prev_pct: number;
  block_hours: number;
  block_hours_actual: number;
  blh_threshold: number;
  projected_days: number;
  fixed: PayLine[];
  variable: PayLine[];
  gross: number;
  in_kind: number;
  cash_gross: number;
  dietas: number;
  dietas_exempt: number;
  social_security: {
    base: number; cap: number; excess: number;
    common: number; unemployment: number; training: number; solidarity: number; total: number;
  };
  irpf_base: number;
  irpf: number;
  irpf_in_kind: number;
  deductions: number;
  net: number;
  days: PayDay[];
  flags: { activated: string[]; not_flown: string[]; extra_duty: string[]; bdo_unconfirmed: string[] };
}

export interface PaySettings {
  category: "FO" | "CPT";
  level: number;
  irpf_pct: number;
  jornada_pct: number;
}

/** Payslip paid in month+1 for the activity in `month` (YYYY-MM). */
export function usePayEstimate(month: string, opts: { enabled?: boolean } = {}) {
  return useQuery<PayEstimate>({
    queryKey: ["pay-estimate", month],
    queryFn: async () => {
      const res = await fetch(`/api/roster/pay-estimate?month=${month}`);
      if (!res.ok) throw new Error("no estimate");
      return res.json();
    },
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

export function usePaySettings() {
  return useQuery<PaySettings>({
    queryKey: ["pay-settings"],
    queryFn: async () => {
      const res = await fetch("/api/roster/pay-settings");
      if (!res.ok) throw new Error("no settings");
      return res.json();
    },
    staleTime: 300_000,
  });
}

export function useSavePaySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PaySettings>) => {
      const res = await fetch("/api/roster/pay-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      return res.json() as Promise<PaySettings>;
    },
    onSuccess: (s) => {
      qc.setQueryData(["pay-settings"], s);
      qc.invalidateQueries({ queryKey: ["pay-estimate"] });
      qc.invalidateQueries({ queryKey: ["pay-jornada"] });
    },
  });
}

export interface PayJornada {
  default: number;
  months: Record<string, number>;   // YYYY-MM → % (only months that differ from the default)
}

export function usePayJornada() {
  return useQuery<PayJornada>({
    queryKey: ["pay-jornada"],
    queryFn: async () => {
      const res = await fetch("/api/roster/pay-jornada");
      if (!res.ok) throw new Error("no jornada");
      return res.json();
    },
    staleTime: 300_000,
  });
}

/** Set a month's working %; null resets it to the default. */
export function useSaveJornada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ month, pct }: { month: string; pct: number | null }) => {
      const res = await fetch(`/api/roster/pay-jornada/${month}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jornada_pct: pct }),
      });
      if (!res.ok) throw new Error("save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pay-jornada"] });
      qc.invalidateQueries({ queryKey: ["pay-estimate"] });
    },
  });
}

export interface PayOverrideIn {
  standby_paid: boolean | null;
  per_diem: PerDiemType | "none" | null;
  positioning: number | null;
  bdo: number | null;
  note: string | null;
}

export function useSavePayOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ date, body }: { date: string; body: PayOverrideIn }) => {
      const res = await fetch(`/api/roster/pay-overrides/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save failed");
      return res.json() as Promise<PayDay | null>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pay-estimate"] }),
  });
}

export function fmtEur(n: number) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Short badge for a reconciled day — null when it went as planned. */
export function dayBadge(d: PayDay): { label: string; tone: "warn" | "info" | "ok" | "bad" | "mute" } | null {
  if (d.bdo >= 1) return { label: "BDO", tone: "ok" };
  if (d.bdo > 0) return { label: "½ BDO", tone: "ok" };
  if (d.activated) return { label: "Called", tone: "warn" };
  if (d.status === "extra_duty") return { label: "Extra", tone: "warn" };
  if (d.status === "not_flown") return { label: "Not flown", tone: "bad" };
  if (d.status === "changed") return { label: "Changed", tone: "info" };
  if (d.positioning > 0 && !d.route) return { label: "Pos.", tone: "info" };
  if (d.per_diem && !d.route && d.sleeps_at) return { label: "Away", tone: "info" };
  return null;
}
