import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearch } from "wouter";
import { Ban, Check, Coins, Copy, Gift, RotateCcw, Search, Settings2, ShieldCheck, Ticket, TriangleAlert, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { AdminBillingOverview, AdminPaymentOrder, BillingSettings } from "@shared/billing";
import { formatCredits } from "@shared/credits";
import { shortDayText } from "@/components/billing/format";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { cx } from "@/components/common/cx";
import { Dialog } from "@/components/common/Dialog";
import { StateNotice } from "@/components/common/StateNotice";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { useAnnouncer } from "@/components/task/useAnnouncer";
import { adminApi, errorMessage, relativeTime, type AdminOverview, type AdminUser, type CreditEvent, type PromoCode } from "@/lib/api";
import { clockText } from "@/lib/account";
import { adminBillingApi } from "@/lib/billing";
import { AccountBillingCell, AccountBillingDialog } from "./admin/AccountBilling";
import { OrderDialog } from "./admin/OrderDialog";
import { PaymentsPanel, type OrderChange } from "./admin/PaymentsPanel";
import { WalletBalances } from "./admin/WalletBalances";
import { PlansPanel } from "./admin/PlansPanel";
import { ADMIN_TABS, adminHref, compactUsd, readAdminLocation, type AdminTab, type OrderFilter } from "./admin/payments";
import { fromLocalInput, toLocalInput } from "./admin/pricing";

/**
 * The operator's dashboard: accounts with their credits, plans and API balances, payments (the
 * review queue first), promo codes, plans and pricing, and the free allowance. The address keeps
 * the tab and the open order (/admin?tab=payments&order=CUR-…: payment alerts link there).
 */
export default function Admin() {
  const search = useSearch();
  const [tab, setTab] = useState<AdminTab>(() => readAdminLocation(window.location.search).tab ?? "accounts");
  // One order dialog for the page: a payments row, an account's billing and the address all open it.
  const [orderCode, setOrderCode] = useState<string | null>(() => readAdminLocation(window.location.search).order);
  const [paymentsFilter, setPaymentsFilter] = useState<OrderFilter>("all");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [billing, setBilling] = useState<AdminBillingOverview | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [orderChange, setOrderChange] = useState<OrderChange | null>(null);
  const [codeFor, setCodeFor] = useState<AdminUser | null>(null);
  const { announce, region } = useAnnouncer();
  const tabsRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(tabsRef);
  const loadOverview = useCallback(() => void adminApi.overview().then(setOverview, () => undefined), []);
  const loadBilling = useCallback(() => void adminBillingApi.overview().then(
    next => { setBilling(next); setBillingError(null); },
    error => setBillingError(errorMessage(error, "Couldn't load payments.")),
  ), []);
  useEffect(() => loadOverview(), [loadOverview]);
  useEffect(() => loadBilling(), [loadBilling]);

  // The address decides when it changes: /admin?tab=…&order=… opens that tab and order (also while
  // the page is open), plain /admin (the sidebar link) the first tab. The page's own writes below
  // always match its state, so following them changes nothing.
  useEffect(() => {
    const next = readAdminLocation(search);
    setTab(next.tab ?? "accounts");
    setOrderCode(next.order);
  }, [search]);
  // The address follows the tab and the open order (replaced, so Back leaves the page as before).
  useEffect(() => {
    const href = adminHref(tab, orderCode);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(window.history.state, "", href);
  }, [tab, orderCode]);

  // Tabs move with the arrow keys, Home and End; only the selected one is in the Tab order.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ADMIN_TABS.findIndex(item => item.id === tab);
    const last = ADMIN_TABS.length - 1;
    const to = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index <= 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (to === null) return;
    event.preventDefault();
    setTab(ADMIN_TABS[to].id);
    document.getElementById(`admin-tab-${ADMIN_TABS[to].id}`)?.focus();
  };

  const orderChanged = useCallback((order: AdminPaymentOrder) => {
    setOrderChange({ order, at: Date.now() });
    loadBilling();
  }, [loadBilling]);
  const review = billing?.counts.review ?? 0;
  const settings = billing?.settings ?? null;

  return (
    <AppShell title="Admin">
      <div className="page">
        <div className="page-wide">
          {region}
          <header className="page-head">
            <div>
              <span className="eyebrow">Operator</span>
              <h2 className="page-title">Admin</h2>
              <p className="page-sub">A new account starts with welcome credits, once. Following and posting on X earn more, and both together open a refilling window while that offer lasts. Give an account more with a promo code, stop one that misuses the agent, and decide on the payments the on-chain check couldn't match.</p>
            </div>
          </header>

          <div className="dash-stats admin-stats" role="group" aria-label="Overview">
            <Stat icon={Users} label="Accounts" value={overview?.users} hint={overview ? `${overview.newToday} new today` : undefined} />
            <Stat icon={ShieldCheck} label="Active today" value={overview?.activeToday} />
            <Stat icon={RotateCcw} label="Runs now" value={overview?.activeRuns} />
            <Stat icon={Coins} label="Credits used today" value={overview ? formatCredits(overview.creditsUsedToday) : undefined} />
            <Stat
              icon={TriangleAlert} label="In review" tone={review > 0 ? "warning" : undefined}
              value={billing ? review : billingError ? "–" : undefined}
              hint={billing ? (review === 0 ? "Nothing waiting" : review === 1 ? "A payment waits for you" : "Payments wait for you") : billingError ? "Couldn't load payments" : undefined}
              onSelect={() => { setPaymentsFilter("attention"); setTab("payments"); }}
            />
            <Stat
              icon={Wallet} label="Revenue, 30 days"
              value={billing ? compactUsd(billing.revenue.last30dUsd) : billingError ? "–" : undefined}
              hint={billing ? `${compactUsd(billing.revenue.last7dUsd)} in 7 days · ${compactUsd(billing.revenue.totalUsd)} in all` : undefined}
            />
            <Stat icon={Ticket} label="Active codes" value={overview?.activePromoCodes} />
            <Stat icon={Settings2} label="Welcome credits" value={overview ? formatCredits(overview.settings.welcomeCredits) : undefined} hint={overview ? (overview.settings.creditsPerWindow > 0 ? `plus ${formatCredits(overview.settings.creditsPerWindow)} every ${overview.settings.windowHours} h` : "once, no refill") : undefined} />
          </div>

          <div className="pg-filter-scroll admin-tabs-scroll" ref={tabsRef}>
            <div className="segmented admin-tabs" role="tablist" aria-label="Admin sections" onKeyDown={onTabKey}>
              {ADMIN_TABS.map(item => (
                <button
                  key={item.id} type="button" role="tab" id={`admin-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`admin-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === "payments" && review > 0 && <><span className="pg-count" aria-hidden="true">{review}</span><span className="sr-only">, {review} in review</span></>}
                </button>
              ))}
            </div>
          </div>

          <section id={`admin-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className="admin-panel">
            {tab === "accounts" && (
              <AccountsPanel
                settings={settings} orderChange={orderChange} onOpenOrder={setOrderCode} onChanged={loadOverview} onBillingChanged={loadBilling}
                onCodeFor={user => { setCodeFor(user); setTab("codes"); }}
              />
            )}
            {tab === "payments" && (
              <>
                <WalletBalances />
                <PaymentsPanel counts={billing?.counts ?? null} filter={paymentsFilter} onFilter={setPaymentsFilter} onOpen={setOrderCode} orderChange={orderChange} announce={announce} onRefresh={loadBilling} />
              </>
            )}
            {tab === "codes" && <CodesPanel forUser={codeFor} clearForUser={() => setCodeFor(null)} onChanged={loadOverview} />}
            {tab === "plans" && <PlansPanel billing={billing} billingError={billingError} free={overview?.settings ?? null} onSaved={loadBilling} />}
            {tab === "settings" && <SettingsPanel onSaved={loadOverview} />}
          </section>
        </div>
      </div>
      {orderCode && <OrderDialog key={orderCode} code={orderCode} settings={settings} onClose={() => setOrderCode(null)} onChanged={orderChanged} announce={announce} />}
    </AppShell>
  );
}

/** One number in the ledger at the top; with onSelect it is a button (In review opens the review queue). */
function Stat({ icon: Icon, label, value, hint, tone, onSelect }: { icon: typeof Users; label: string; value: number | string | undefined; hint?: string; tone?: "warning"; onSelect?: () => void }) {
  const body = (
    <>
      <span className="dash-stat-label"><Icon size={15} aria-hidden="true" />{label}</span>
      {value === undefined ? <span className="skeleton dash-stat-skeleton" aria-hidden="true" /> : <span className="dash-stat-value">{value}</span>}
      {hint && <span className="dash-stat-hint">{hint}</span>}
    </>
  );
  if (onSelect) return <button type="button" className={cx("dash-stat", "admin-stat-button", tone && "admin-stat-alert")} data-tone={tone} onClick={onSelect}>{body}</button>;
  return <div className="dash-stat" data-static="">{body}</div>;
}

// ---- Accounts ----

function AccountsPanel({ settings, orderChange, onOpenOrder, onChanged, onBillingChanged, onCodeFor }: {
  /** The billing settings (plans), for the Billing dialog. */
  settings: BillingSettings | null;
  orderChange: OrderChange | null;
  onOpenOrder: (code: string) => void;
  onChanged: () => void;
  /** A plan or an API balance changed (the billing overview reloads). */
  onBillingChanged: () => void;
  onCodeFor: (user: AdminUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [billingFor, setBillingFor] = useState<AdminUser | null>(null);
  const [banning, setBanning] = useState<AdminUser | null>(null);
  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      const result = await adminApi.users(q);
      setUsers(result.users);
      setMore(result.more);
    } catch (loadError) {
      setError(errorMessage(loadError, "Couldn't load accounts."));
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);
  const changed = () => { void load(query); onChanged(); };

  return (
    <div className="card admin-card">
      <div className="card-head admin-card-head">
        <h3>Accounts</h3>
        <label className="admin-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search accounts</span>
          <input className="input" type="search" placeholder="GitHub login, name or email" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
      </div>
      {users === null ? (
        error ? <StateNotice variant="error" size="sm" title="Couldn't load accounts" actions={<Button size="sm" icon={RotateCcw} onClick={() => void load(query)}>Try again</Button>}>{error}</StateNotice>
          : <StateNotice variant="loading" size="sm" title="Loading accounts…" />
      ) : users.length === 0 ? (
        <StateNotice variant="empty" size="sm" title={query ? "No account matches" : "No accounts yet"}>{query ? "Try part of the GitHub login." : "Accounts appear here once people sign in with GitHub."}</StateNotice>
      ) : (
        <div className="table-wrap">
          <table className="data-table admin-table">
            <thead>
              <tr><th scope="col">Account</th><th scope="col">Credits now</th><th scope="col">Plan · API</th><th scope="col">Used</th><th scope="col">Last seen</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} data-banned={user.banned || undefined}>
                  <td>
                    <div className="admin-account">
                      {user.avatarUrl ? <img src={user.avatarUrl} alt="" width={28} height={28} /> : <span className="admin-avatar" aria-hidden="true">{(user.login ?? user.name).slice(0, 1).toUpperCase()}</span>}
                      <span className="admin-account-text">
                        <span className="admin-account-name">{user.login ?? user.name}{user.role === "admin" && <span className="badge admin-role">operator</span>}{user.banned && <span className="badge admin-banned">banned</span>}{user.freeAllowance?.withheld && <span className="badge admin-banned" title={user.freeAllowance.note ?? undefined}>no free credits</span>}{user.x && <span className="badge" title={user.x.followed && user.x.posted ? "Following and posted" : user.x.followed ? "Following claimed" : user.x.posted ? "Post claimed" : "Linked, nothing claimed"}>@{user.x.username}</span>}</span>
                        <span className="admin-account-meta">{user.name !== user.login ? `${user.name} · ` : ""}joined {relativeTime(user.createdAt)}</span>
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    {user.credits.unlimited ? "not charged" : (
                      <>
                        {formatCredits(user.credits.available)}
                        <span className="admin-sub">
                          {formatCredits(user.credits.remaining)}/{formatCredits(user.credits.allowance)}
                          {user.credits.plan && user.credits.allowance === user.credits.plan.creditsPerWindow ? " (plan)" : user.customAllowance !== null ? " (custom)" : ""}
                          {user.credits.bonus ? ` + ${formatCredits(user.credits.bonus)} bonus` : ""}
                        </span>
                      </>
                    )}
                  </td>
                  <td><AccountBillingCell user={user} /></td>
                  <td className="num">{formatCredits(user.creditsUsedTotal)}<span className="admin-sub">{user.tasks} task{user.tasks === 1 ? "" : "s"}{user.activeRuns ? ` · ${user.activeRuns} running` : ""}</span></td>
                  <td className="num">{user.lastSeenAt ? relativeTime(user.lastSeenAt) : "never"}</td>
                  <td>
                    <div className="admin-actions">
                      <Button size="sm" icon={Coins} onClick={() => setSelected(user)}>Credits</Button>
                      <Button size="sm" variant="ghost" icon={Wallet} onClick={() => setBillingFor(user)}>Billing</Button>
                      {user.role !== "admin" && <Button size="sm" variant="ghost" icon={Gift} onClick={() => onCodeFor(user)}>Code</Button>}
                      {user.role !== "admin" && <Button size="sm" variant="ghost" icon={user.banned ? Check : Ban} onClick={() => setBanning(user)}>{user.banned ? "Unban" : "Ban"}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && <p className="field-hint admin-more">Showing the 50 most recently active accounts. Search to find others.</p>}
        </div>
      )}
      {selected && <CreditsDialog user={selected} onClose={() => setSelected(null)} onChanged={changed} />}
      {billingFor && (
        <AccountBillingDialog
          user={billingFor} settings={settings} orderChange={orderChange} onOpenOrder={onOpenOrder} onClose={() => setBillingFor(null)}
          onChanged={() => { changed(); onBillingChanged(); }}
        />
      )}
      <ConfirmDialog
        open={Boolean(banning)}
        onOpenChange={open => { if (!open) setBanning(null); }}
        title={banning?.banned ? `Unban ${banning.login ?? banning.name}?` : `Ban ${banning?.login ?? banning?.name}?`}
        confirmLabel={banning?.banned ? "Unban" : "Ban account"}
        tone={banning?.banned ? "default" : "danger"}
        onConfirm={async () => {
          if (!banning) return;
          await adminApi.ban(banning.id, !banning.banned);
          toast.success(banning.banned ? "Account unbanned." : "Account banned and signed out everywhere.");
          setBanning(null);
          changed();
        }}
      >
        {banning?.banned ? "They can sign in again with GitHub." : "They're signed out everywhere at once, can't sign in again, and anything they have running stops. Their tasks and files are kept."}
      </ConfirmDialog>
    </div>
  );
}

const CREDIT_KIND: Record<CreditEvent["kind"], string> = { usage: "Used", promo: "Promo code", grant: "Added by the operator", adjust: "Allowance", plan: "Plan", welcome: "Welcome credits", reward: "Earned on X" };

function CreditsDialog({ user, onClose, onChanged }: { user: AdminUser; onClose: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [allowance, setAllowance] = useState(user.customAllowance === null ? "" : String(user.customAllowance));
  const [busy, setBusy] = useState<"grant" | "allowance" | "free" | "x" | null>(null);
  const [withheld, setWithheld] = useState(Boolean(user.freeAllowance?.withheld));
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CreditEvent[] | null>(null);
  const [credits, setCredits] = useState(user.credits);
  const amountId = useId();
  useEffect(() => { void adminApi.history(user.id).then(result => { setHistory(result.history); setCredits(result.credits); }, () => setHistory([])); }, [user.id]);
  const name = user.login ?? user.name;

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value === 0) return setError("Enter how many credits to add (a negative number removes bonus credits).");
    setBusy("grant");
    setError(null);
    try {
      const result = await adminApi.grant(user.id, value, note);
      setCredits(result.credits);
      setAmount("");
      setNote("");
      toast.success(value > 0 ? `${formatCredits(value)} credits added to ${name}.` : `${formatCredits(-value)} bonus credits removed from ${name}.`);
      onChanged();
      void adminApi.history(user.id).then(result => setHistory(result.history), () => undefined);
    } catch (grantError) {
      setError(errorMessage(grantError));
    } finally {
      setBusy(null);
    }
  };
  const saveFreeAllowance = async (next: boolean) => {
    setBusy("free");
    setError(null);
    try {
      const result = await adminApi.freeAllowance(user.id, next);
      setCredits(result.credits);
      setWithheld(next);
      toast.success(next ? `${name} no longer gets the free allowance.` : `${name} gets the free allowance again.`);
      onChanged();
      void adminApi.history(user.id).then(result => setHistory(result.history), () => undefined);
    } catch (freeError) {
      setError(errorMessage(freeError));
    } finally {
      setBusy(null);
    }
  };
  const saveAllowance = async (value: number | null) => {
    setBusy("allowance");
    setError(null);
    try {
      const result = await adminApi.allowance(user.id, value);
      setCredits(result.credits);
      toast.success(value === null ? `${name} is back on the default allowance.` : `${name} now gets ${formatCredits(value)} credits per window.`);
      onChanged();
    } catch (allowanceError) {
      setError(errorMessage(allowanceError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }} size="md" title={`Credits · ${name}`} description={credits.unlimited ? "The operator's account is not charged." : `${formatCredits(credits.available)} available now: ${formatCredits(credits.remaining)} of ${formatCredits(credits.allowance)} in this window${credits.resetsAt ? ` (refills at ${clockText(credits.resetsAt)})` : ""}, plus ${formatCredits(credits.bonus)} bonus.${credits.plan ? ` On ${credits.plan.name} until ${shortDayText(credits.plan.expiresAt)}.` : ""}`}>
      <form className="admin-form" onSubmit={grant} noValidate>
        <h4 className="admin-form-title">Add bonus credits</h4>
        <p className="field-hint">Bonus credits are spent after the window's and never expire.</p>
        <div className="admin-form-row">
          <div className="field">
            <label className="field-label" htmlFor={amountId}>Credits</label>
            <input id={amountId} className="input" type="number" inputMode="decimal" step="1" value={amount} onChange={event => setAmount(event.target.value)} placeholder="100" />
          </div>
          <div className="field admin-grow">
            <label className="field-label" htmlFor={`${amountId}-note`}>Note (optional)</label>
            <input id={`${amountId}-note`} className="input" value={note} maxLength={200} onChange={event => setNote(event.target.value)} placeholder="Why, for your records" />
          </div>
        </div>
        <Button type="submit" variant="primary" busy={busy === "grant"} disabled={!amount}>Add credits</Button>
      </form>
      <div className="admin-form">
        <h4 className="admin-form-title">Allowance per window</h4>
        <p className="field-hint">Leave empty for the default. Takes effect from the next charge. While a plan runs, the larger of the two applies.</p>
        <div className="admin-form-row">
          <div className="field">
            <label className="field-label" htmlFor={`${amountId}-allowance`}>Credits every window</label>
            <input id={`${amountId}-allowance`} className="input" type="number" inputMode="numeric" min={0} step="1" value={allowance} onChange={event => setAllowance(event.target.value)} placeholder="Default" />
          </div>
        </div>
        <div className="admin-actions">
          <Button busy={busy === "allowance"} disabled={allowance === "" || !Number.isInteger(Number(allowance))} onClick={() => void saveAllowance(Number(allowance))}>Save allowance</Button>
          {user.customAllowance !== null && <Button variant="ghost" disabled={busy !== null} onClick={() => { setAllowance(""); void saveAllowance(null); }}>Use the default</Button>}
        </div>
      </div>
      {user.x && (
        <div className="admin-form">
          <h4 className="admin-form-title">X rewards</h4>
          <p className="field-hint">Linked as @{user.x.username}. {user.x.followed ? "Follow claimed. " : "Follow not claimed. "}{user.x.posted ? "Post claimed." : "Post not claimed."} Resetting forgets the link and both claims, so the boost ends; credits already given stay.</p>
          <div className="admin-actions">
            <Button busy={busy === "x"} disabled={busy !== null && busy !== "x"} onClick={() => void (async () => {
              setBusy("x");
              setError(null);
              try {
                const result = await adminApi.resetX(user.id);
                setCredits(result.credits);
                setHistory(result.history);
                toast.success(`X rewards reset for ${name}.`);
                onChanged();
              } catch (resetError) {
                setError(errorMessage(resetError));
              } finally {
                setBusy(null);
              }
            })()}>Reset X rewards</Button>
          </div>
        </div>
      )}
      {!credits.unlimited && (
        <div className="admin-form">
          <h4 className="admin-form-title">Free credits</h4>
          <p className="field-hint">{withheld ? "This account doesn't get the welcome credits or the X rewards. " : "This account gets the welcome credits and can earn the X rewards. "}{user.freeAllowance?.note ?? ""}{user.customAllowance !== null ? " Its own allowance applies either way." : ""}{credits.plan ? " Its plan applies either way." : ""}</p>
          <div className="admin-actions">
            <Button busy={busy === "free"} disabled={busy !== null && busy !== "free"} onClick={() => void saveFreeAllowance(!withheld)}>{withheld ? "Give the free credits" : "Remove the free credits"}</Button>
          </div>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <h4 className="admin-form-title">Recent activity</h4>
      {history === null ? <p className="field-hint">Loading…</p> : history.length === 0 ? <p className="field-hint">No credit activity yet.</p> : (
        <ul className="admin-history">
          {history.slice(0, 30).map((event, index) => (
            <li key={`${event.at}-${index}`}>
              <span className="num" data-sign={event.amount < 0 ? "minus" : "plus"}>{event.amount > 0 ? "+" : ""}{formatCredits(event.amount)}</span>
              <span>{CREDIT_KIND[event.kind]}{event.detail ? ` · ${event.detail}` : ""}</span>
              <span className="admin-sub">{relativeTime(event.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

// ---- Promo codes ----

const STATE_LABEL: Record<PromoCode["state"], string> = { active: "Active", used_up: "Used up", expired: "Expired", disabled: "Disabled" };

function CodesPanel({ forUser, clearForUser, onChanged }: { forUser: AdminUser | null; clearForUser: () => void; onChanged: () => void }) {
  const [codes, setCodes] = useState<PromoCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState("100");
  const [code, setCode] = useState("");
  const [uses, setUses] = useState(forUser ? "1" : "");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<PromoCode | null>(null);
  const id = useId();
  const load = useCallback(() => {
    setError(null);
    adminApi.promoCodes().then(result => setCodes(result.codes), loadError => setError(errorMessage(loadError, "Couldn't load promo codes.")));
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => setUses(forUser ? "1" : ""), [forUser]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const result = await adminApi.createPromoCode({
        credits: Number(credits),
        ...(code.trim() ? { code: code.trim() } : {}),
        forUserId: forUser?.id ?? null,
        maxRedemptions: uses.trim() ? Number(uses) : null,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setCreated(result.code);
      setCode("");
      setNote("");
      load();
      onChanged();
    } catch (createError) {
      setFormError(errorMessage(createError));
    } finally {
      setBusy(false);
    }
  };
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast.success("Code copied."), () => toast.error("Couldn't copy; select the code instead."));
  };

  return (
    <>
      <form className="card admin-card admin-form" onSubmit={create} noValidate>
        <div className="card-head"><h3>New promo code</h3></div>
        {forUser ? (
          <p className="admin-for">For <strong>{forUser.login ?? forUser.name}</strong> only: nobody else can redeem it. <Button size="sm" variant="link" onClick={clearForUser}>Make it for anyone</Button></p>
        ) : (
          <p className="field-hint">Anyone with the code can redeem it once. To make one for a single account, use "Code" next to it under Accounts.</p>
        )}
        <div className="admin-form-row">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-credits`}>Credits</label>
            <input id={`${id}-credits`} className="input" type="number" inputMode="numeric" min={1} step="1" value={credits} onChange={event => setCredits(event.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-uses`}>Uses</label>
            <input id={`${id}-uses`} className="input" type="number" inputMode="numeric" min={1} step="1" value={uses} onChange={event => setUses(event.target.value)} placeholder="Unlimited" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-expires`}>Expires (optional)</label>
            <input id={`${id}-expires`} className="input" type="date" value={expires} onChange={event => setExpires(event.target.value)} />
          </div>
        </div>
        <div className="admin-form-row">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-code`}>Code (optional)</label>
            <input id={`${id}-code`} className="input admin-code-input" value={code} maxLength={32} onChange={event => setCode(event.target.value)} placeholder="Generated" autoComplete="off" spellCheck={false} />
          </div>
          <div className="field admin-grow">
            <label className="field-label" htmlFor={`${id}-note`}>Note (optional)</label>
            <input id={`${id}-note`} className="input" value={note} maxLength={200} onChange={event => setNote(event.target.value)} placeholder="Who it's for, for your records" />
          </div>
        </div>
        {formError && <p className="field-error" role="alert">{formError}</p>}
        <div className="admin-actions">
          <Button type="submit" variant="primary" icon={Ticket} busy={busy} disabled={!(Number(credits) >= 1)}>Create code</Button>
        </div>
        {created && (
          <div className="notice admin-created" data-tone="success" role="status">
            <Check size={16} aria-hidden="true" />
            <div className="notice-body">
              <code className="admin-code">{created.code}</code> gives {formatCredits(created.credits)} credits{created.forUser ? ` to ${created.forUser.login ?? "that account"}` : ""}. Send it to them; they redeem it under Credits in the sidebar.
            </div>
            <Button size="sm" icon={Copy} onClick={() => copy(created.code)}>Copy</Button>
          </div>
        )}
      </form>

      <div className="card admin-card">
        <div className="card-head"><h3>Codes</h3></div>
        {codes === null ? (
          error ? <StateNotice variant="error" size="sm" title="Couldn't load promo codes" actions={<Button size="sm" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice>
            : <StateNotice variant="loading" size="sm" title="Loading codes…" />
        ) : codes.length === 0 ? (
          <StateNotice variant="empty" size="sm" title="No promo codes yet">Codes you create appear here with how often they were used.</StateNotice>
        ) : (
          <div className="table-wrap">
            <table className="data-table admin-table">
              <thead><tr><th scope="col">Code</th><th scope="col">Credits</th><th scope="col">For</th><th scope="col">Used</th><th scope="col">Expires</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {codes.map(promo => (
                  <tr key={promo.id}>
                    <td><code className="admin-code">{promo.code}</code>{promo.note && <span className="admin-sub">{promo.note}</span>}</td>
                    <td className="num">{formatCredits(promo.credits)}</td>
                    <td>{promo.forUser ? promo.forUser.login ?? "one account" : "anyone"}</td>
                    <td className="num">{promo.redemptions}{promo.maxRedemptions !== null ? ` / ${promo.maxRedemptions}` : ""}</td>
                    <td className="num">{promo.expiresAt ? new Date(promo.expiresAt).toLocaleDateString() : "never"}</td>
                    <td><span className="status-badge" data-tone={promo.state === "active" ? "success" : "neutral"}>{STATE_LABEL[promo.state]}</span></td>
                    <td>
                      <div className="admin-actions">
                        <Button size="sm" variant="ghost" icon={Copy} onClick={() => copy(promo.code)}>Copy</Button>
                        {promo.state === "active" && (
                          <Button size="sm" variant="ghost" icon={Ban} onClick={() => void adminApi.disablePromoCode(promo.id).then(result => { setCodes(result.codes); onChanged(); toast.success("Code disabled."); }, disableError => toast.error(errorMessage(disableError)))}>Disable</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---- Settings ----

function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [perWindow, setPerWindow] = useState("");
  const [hours, setHours] = useState("");
  const [signups, setSignups] = useState(true);
  const [welcome, setWelcome] = useState("");
  const [followHandle, setFollowHandle] = useState("");
  const [followCredits, setFollowCredits] = useState("");
  const [postCredits, setPostCredits] = useState("");
  const [boostOn, setBoostOn] = useState(true);
  const [boostCredits, setBoostCredits] = useState("");
  const [boostHours, setBoostHours] = useState("");
  const [boostEnds, setBoostEnds] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    adminApi.settings().then(({ settings }) => {
      setPerWindow(String(settings.creditsPerWindow));
      setHours(String(settings.windowHours));
      setSignups(settings.signupsOpen);
      setWelcome(String(settings.welcomeCredits));
      setFollowHandle(settings.rewards.followHandle);
      setFollowCredits(String(settings.rewards.followCredits));
      setPostCredits(String(settings.rewards.postCredits));
      setBoostOn(settings.rewards.boost.enabled);
      setBoostCredits(String(settings.rewards.boost.creditsPerWindow));
      setBoostHours(String(settings.rewards.boost.windowHours));
      setBoostEnds(toLocalInput(settings.rewards.boost.endsAt));
      setLoaded(true);
    }, loadError => setError(errorMessage(loadError, "Couldn't load the settings.")));
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.saveSettings({
        creditsPerWindow: Number(perWindow), windowHours: Number(hours), signupsOpen: signups, welcomeCredits: Number(welcome),
        rewards: {
          followHandle, followCredits: Number(followCredits), postCredits: Number(postCredits),
          boost: { enabled: boostOn, creditsPerWindow: Number(boostCredits), windowHours: Number(boostHours), endsAt: boostEnds ? fromLocalInput(boostEnds) : null },
        },
      });
      toast.success("Settings saved.");
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card admin-card admin-form" onSubmit={save} noValidate>
      <div className="card-head"><h3>Free credits</h3></div>
      <p className="field-hint">A new account gets the welcome credits once; they never refill. Credits per window, when above zero, is a refilling allowance for every account (a window starts with the first credit spent). Accounts with their own allowance, a plan or the X boost keep whichever is higher. One credit is 25,000 tokens on a standard model (output counts four times).</p>
      <div className="admin-form-row">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-welcome`}>Welcome credits</label>
          <input id={`${id}-welcome`} className="input" type="number" inputMode="numeric" min={0} step="1" value={welcome} disabled={!loaded} onChange={event => setWelcome(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-credits`}>Credits per window</label>
          <input id={`${id}-credits`} className="input" type="number" inputMode="numeric" min={0} step="1" value={perWindow} disabled={!loaded} onChange={event => setPerWindow(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-hours`}>Window length (hours)</label>
          <input id={`${id}-hours`} className="input" type="number" inputMode="decimal" min={1} max={168} step="1" value={hours} disabled={!loaded} onChange={event => setHours(event.target.value)} />
        </div>
      </div>
      <h4 className="admin-form-title">Earned on X</h4>
      <p className="field-hint">Each is claimed once per account, after this server has checked it on X. Both claimed: the boost's allowance refills on its own window until the offer ends (empty: until you turn it off).</p>
      <div className="admin-form-row">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-handle`}>Account to follow</label>
          <input id={`${id}-handle`} className="input" value={followHandle} maxLength={100} disabled={!loaded} spellCheck={false} autoComplete="off" onChange={event => setFollowHandle(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-follow`}>Credits for following</label>
          <input id={`${id}-follow`} className="input" type="number" inputMode="numeric" min={0} step="1" value={followCredits} disabled={!loaded} onChange={event => setFollowCredits(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-post`}>Credits for a post</label>
          <input id={`${id}-post`} className="input" type="number" inputMode="numeric" min={0} step="1" value={postCredits} disabled={!loaded} onChange={event => setPostCredits(event.target.value)} />
        </div>
      </div>
      <div className="admin-form-row">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-boost`}>Boost, credits per window</label>
          <input id={`${id}-boost`} className="input" type="number" inputMode="numeric" min={0} step="1" value={boostCredits} disabled={!loaded} onChange={event => setBoostCredits(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-boost-hours`}>Boost window (hours)</label>
          <input id={`${id}-boost-hours`} className="input" type="number" inputMode="decimal" min={1} max={168} step="1" value={boostHours} disabled={!loaded} onChange={event => setBoostHours(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-boost-ends`}>Boost ends (optional)</label>
          <input id={`${id}-boost-ends`} className="input" type="datetime-local" value={boostEnds} disabled={!loaded} onChange={event => setBoostEnds(event.target.value)} />
        </div>
      </div>
      <label className="admin-check">
        <input type="checkbox" checked={boostOn} disabled={!loaded} onChange={event => setBoostOn(event.target.checked)} />
        <span>The boost is on <span className="field-hint">(when off, nobody refills from it, including accounts that already earned both)</span></span>
      </label>
      <label className="admin-check">
        <input type="checkbox" checked={signups} disabled={!loaded} onChange={event => setSignups(event.target.checked)} />
        <span>New accounts can sign up <span className="field-hint">(when off, only accounts that already exist can sign in)</span></span>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="admin-actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!loaded}>Save settings</Button>
      </div>
    </form>
  );
}
