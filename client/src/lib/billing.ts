import type {
  AdminAccountBilling, AdminBillingOverview, AdminPaymentOrder, AdminWalletBalances, ApiUsageReport, BillingAccount, BillingCatalog, BillingSettings, BillingSettingsPatch, CoinId,
  CreditUsageReport, NetworkId, PaymentOrder, PaymentStatus, PlanId, UsageRange,
} from "@shared/billing";
import { api } from "./api";

// The billing API: the catalog (plans, the offer, API prices, payment networks), an account's plan
// and API balance, orders paid in crypto, and usage reports. adminBillingApi is the operator's.

const enc = encodeURIComponent;
const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** months: how many periods of the plan to pay for at once (1 to MAX_PLAN_MONTHS; 1 when left out). */
export type NewOrder = { kind: "plan"; planId: PlanId; months?: number } | { kind: "api"; amountUsd: number };

export const billingApi = {
  /** No sign-in needed (the homepage uses it). */
  catalog: () => api<BillingCatalog>("/api/billing/catalog"),
  account: () => api<BillingAccount>("/api/billing/account"),
  orders: () => api<{ orders: PaymentOrder[] }>("/api/billing/orders"),
  order: (code: string) => api<{ order: PaymentOrder }>(`/api/billing/orders/${enc(code)}`),
  createOrder: (input: NewOrder) => api<{ order: PaymentOrder }>("/api/billing/orders", { method: "POST", json: input }),
  /** Issues the payment details: wallet, exact amount, quote. Locked once issued. */
  chooseMethod: (code: string, network: NetworkId, coin: CoinId) => api<{ order: PaymentOrder }>(`/api/billing/orders/${enc(code)}/method`, { method: "POST", json: { network, coin } }),
  submitHash: (code: string, txHash: string) => api<{ order: PaymentOrder }>(`/api/billing/orders/${enc(code)}/submit`, { method: "POST", json: { txHash } }),
  apiUsage: (range: UsageRange) => api<ApiUsageReport>(`/api/billing/api/usage?range=${range}&tz=${enc(timeZone())}`),
  creditUsage: (range: UsageRange) => api<CreditUsageReport>(`/api/billing/credits/usage?range=${range}&tz=${enc(timeZone())}`),
};

export const adminBillingApi = {
  overview: () => api<AdminBillingOverview>("/api/admin/billing/overview"),
  /** The receiving wallets' balances on each network (read from the chains, about 30 s old at most). */
  wallets: () => api<AdminWalletBalances>("/api/admin/billing/wallets"),
  orders: (opts: { status?: PaymentStatus | "all" | "attention"; q?: string; offset?: number } = {}) =>
    api<{ orders: AdminPaymentOrder[]; more: boolean }>(`/api/admin/billing/orders?status=${enc(opts.status ?? "all")}&q=${enc(opts.q ?? "")}&offset=${opts.offset ?? 0}`),
  order: (code: string) => api<{ order: AdminPaymentOrder }>(`/api/admin/billing/orders/${enc(code)}`),
  /** Checks the transaction on-chain again now. */
  recheck: (code: string) => api<{ order: AdminPaymentOrder }>(`/api/admin/billing/orders/${enc(code)}/recheck`, { method: "POST", json: {} }),
  /** Completes the order and applies it (plan or API balance), whatever the chain check said. */
  approve: (code: string, note: string) => api<{ order: AdminPaymentOrder }>(`/api/admin/billing/orders/${enc(code)}/approve`, { method: "POST", json: { note } }),
  /** Rejects an order that has not been applied. tellPayer: the reason is what they see on the payment page. */
  reject: (code: string, note: string, tellPayer = true) => api<{ order: AdminPaymentOrder }>(`/api/admin/billing/orders/${enc(code)}/reject`, { method: "POST", json: { note, tellPayer } }),
  /** Takes back a completed payment and what it applied, when that is still the account's plan or balance. */
  disapprove: (code: string, note: string, tellPayer: boolean) => api<{ order: AdminPaymentOrder; undo: "removed" | "shortened" | "unchanged" | "balance" }>(`/api/admin/billing/orders/${enc(code)}/disapprove`, { method: "POST", json: { note, tellPayer } }),
  settings: () => api<{ settings: BillingSettings }>("/api/admin/billing/settings"),
  /** Only the fields that changed: plans and the offer merge field by field on the server. */
  saveSettings: (patch: BillingSettingsPatch) => api<{ settings: BillingSettings }>("/api/admin/billing/settings", { method: "PUT", json: patch }),
  account: (userId: string) => api<AdminAccountBilling>(`/api/admin/billing/users/${enc(userId)}`),
  /** Gives (or extends) a plan without a payment. */
  grantPlan: (userId: string, planId: PlanId, days: number, note: string) => api<AdminAccountBilling>(`/api/admin/billing/users/${enc(userId)}/plan`, { method: "POST", json: { planId, days, note } }),
  endPlan: (userId: string, note: string) => api<AdminAccountBilling>(`/api/admin/billing/users/${enc(userId)}/plan`, { method: "DELETE", json: { note } }),
  /** Adds (or with a negative amount, removes) API balance. */
  adjustApiBalance: (userId: string, amountUsd: number, note: string) => api<AdminAccountBilling>(`/api/admin/billing/users/${enc(userId)}/api-balance`, { method: "POST", json: { amountUsd, note } }),
};
