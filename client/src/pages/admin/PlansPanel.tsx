import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";
import { BadgePercent, Clock, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { discountPercent, formatPerMillion, PAYMENT_NETWORKS, PLAN_IDS, PLAN_RANK, type AdminBillingOverview, type BillingSettings, type PlanId } from "@shared/billing";
import { creditCount, fullText, shortDayText } from "@/components/billing/format";
import { formatPrice, freeMultiple, listText, offerBadge, offerSentence } from "@/components/billing/plans";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { errorMessage } from "@/lib/api";
import { adminBillingApi } from "@/lib/billing";
import { ExplorerLink, Fact, TextField } from "./parts";
import { apiSample, catalogPreview, checkDraft, draftOf, FIELD_ORDER, fieldOf, offerEnded, toLocalInput, type DraftField, type PlanDraft, type PricingDraft } from "./pricing";

const timeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
})();

const daysText = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;
const EVM_NETWORKS = PAYMENT_NETWORKS.filter(network => network.family === "evm");

/**
 * The plans (name, price, credits per window, days), the launch offer, whether new payments are
 * taken and applied by themselves, the receiving wallets this server has, and a live preview of
 * what customers see. Checked like the server checks it; only what changed is sent.
 */
export function PlansPanel({ billing, billingError, free, onSaved }: {
  /** The overview: the receiving wallets and whether alerts are set up. */
  billing: AdminBillingOverview | null;
  billingError: string | null;
  /** The free allowance, for the preview. */
  free: { creditsPerWindow: number; windowHours: number } | null;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<BillingSettings | null>(null);
  const [draft, setDraft] = useState<PricingDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Errors show once a save was tried (then as the fields change), not while someone is still typing.
  const [showErrors, setShowErrors] = useState(false);
  const uid = useId();
  const fieldId = (field: DraftField) => `${uid}-${field.replace(".", "-")}`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { settings } = await adminBillingApi.settings();
      setSaved(settings);
      setDraft(draftOf(settings));
    } catch (error) {
      setLoadError(errorMessage(error, "Couldn't load the plans and prices."));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const check = useMemo(() => (saved && draft ? checkDraft(draft, saved) : null), [saved, draft]);

  if (!saved || !draft || !check) {
    return loadError ? (
      <div className="card admin-card"><StateNotice variant="error" size="sm" title="Couldn't load the plans and prices" actions={<Button size="sm" icon={RotateCcw} onClick={() => void load()}>Try again</Button>}>{loadError}</StateNotice></div>
    ) : (
      <div className="card admin-card"><StateNotice variant="loading" size="sm" title="Loading the plans and prices…" /></div>
    );
  }

  const update = (patch: Partial<PricingDraft>) => setDraft(current => current && { ...current, ...patch });
  const setPlan = (planId: PlanId, key: keyof PlanDraft, value: string) => setDraft(current => {
    if (!current) return current;
    const plans = { ...current.plans };
    plans[planId] = { ...plans[planId], [key]: value };
    return { ...current, plans };
  });
  const errorOf = (field: DraftField) => (showErrors ? check.errors[field] : undefined);
  const undo = () => {
    setDraft(draftOf(saved));
    setShowErrors(false);
    setSaveError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const result = checkDraft(draft, saved);
    setShowErrors(true);
    setSaveError(null);
    const invalid = FIELD_ORDER.find(field => result.errors[field]);
    if (invalid) {
      document.getElementById(fieldId(invalid))?.focus();
      return;
    }
    if (!Object.keys(result.patch).length) return;
    setSaving(true);
    try {
      // The server takes any part of the settings and merges it; the client's type is the whole shape.
      const { settings } = await adminBillingApi.saveSettings(result.patch);
      setSaved(settings);
      setDraft(draftOf(settings));
      setShowErrors(false);
      toast.success("Plans and pricing saved.");
      onSaved();
    } catch (error) {
      setSaveError(errorMessage(error, "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const ended = offerEnded(saved.discount);
  const running = !ended && (discountPercent(saved.discount, "plans") > 0 || discountPercent(saved.discount, "api") > 0);
  const offerState = running ? (saved.discount.endsAt ? `On until ${shortDayText(saved.discount.endsAt)}` : "On, no end date") : ended ? "Ended" : "Off";

  return (
    <form className="admin-pricing" onSubmit={save} noValidate>
      <div className="admin-pricing-main">
        <section className="card admin-card" aria-labelledby={`${uid}-plans`}>
          <div className="card-head"><h3 id={`${uid}-plans`}>Plans</h3></div>
          <p className="field-hint">
            List prices in US dollars; the launch offer takes its percent off. A new price, credits per window or days apply to orders placed from now on
            (and to plans you give); orders already placed keep the terms they were sold with, even when they're paid or approved later. Accounts on a plan
            keep the credits per window they bought. A new name shows everywhere at once.
          </p>
          <div className="admin-plan-grid">
            {PLAN_IDS.map(planId => {
              const plan = draft.plans[planId];
              const field = (key: keyof PlanDraft) => fieldOf(planId, key);
              return (
                <fieldset key={planId} className="admin-plan">
                  <legend className="admin-plan-legend">{saved.plans[planId].name} <span className="micro">{PLAN_RANK[planId] === 1 ? "Lower plan" : "Higher plan"}</span></legend>
                  <div className="admin-plan-fields">
                    <TextField id={fieldId(field("name"))} label="Name" error={errorOf(field("name"))} value={plan.name} maxLength={24} autoComplete="off" onChange={event => setPlan(planId, "name", event.target.value)} />
                    <TextField id={fieldId(field("price"))} label="Price (USD)" error={errorOf(field("price"))} type="number" inputMode="decimal" min={1} max={10000} step="0.01" value={plan.price} onChange={event => setPlan(planId, "price", event.target.value)} />
                    <TextField id={fieldId(field("credits"))} label="Credits per window" error={errorOf(field("credits"))} type="number" inputMode="numeric" min={0} max={1000000} step="1" value={plan.credits} onChange={event => setPlan(planId, "credits", event.target.value)} />
                    <TextField id={fieldId(field("days"))} label="Days" error={errorOf(field("days"))} type="number" inputMode="numeric" min={1} max={366} step="1" value={plan.days} onChange={event => setPlan(planId, "days", event.target.value)} />
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>

        <section className="card admin-card" aria-labelledby={`${uid}-offer`}>
          <div className="card-head">
            <h3 id={`${uid}-offer`}>Launch offer</h3>
            <span className="chip" data-tone={running ? "success" : "neutral"}>{offerState}</span>
          </div>
          <p className="field-hint">A percent off plan prices and Developer API token prices. Top-ups are never discounted: $1 paid is $1 of API balance. Without an end date, customers see “limited time”.</p>
          {ended && saved.discount.endsAt && (
            <div className="notice" data-tone="neutral">
              <Clock size={16} aria-hidden="true" />
              <div className="notice-body">The offer ended {fullText(saved.discount.endsAt)}, so customers see list prices. Choose Never or a later end to run it again.</div>
            </div>
          )}
          <div className="admin-form-row">
            <TextField id={fieldId("percent")} label="Percent off" hint="0 turns the offer off." error={errorOf("percent")} type="number" inputMode="numeric" min={0} max={95} step="1" value={draft.percent} onChange={event => update({ percent: event.target.value })} />
          </div>
          <fieldset className="admin-fieldset">
            <legend className="field-label">Applies to</legend>
            <div className="admin-checks">
              <label className="admin-check"><input type="checkbox" checked={draft.onPlans} onChange={event => update({ onPlans: event.target.checked })} /><span>Plans</span></label>
              <label className="admin-check"><input type="checkbox" checked={draft.onApi} onChange={event => update({ onApi: event.target.checked })} /><span>Developer API prices</span></label>
            </div>
          </fieldset>
          <fieldset className="admin-fieldset">
            <legend className="field-label" id={`${uid}-ends`}>Ends</legend>
            <RadioGroup.Root className="segmented" aria-labelledby={`${uid}-ends`} value={draft.ends} onValueChange={value => { if (value === "never" || value === "at") update({ ends: value }); }} orientation="horizontal" loop>
              <RadioGroup.Item value="never">Never</RadioGroup.Item>
              <RadioGroup.Item value="at">On a date</RadioGroup.Item>
            </RadioGroup.Root>
            {draft.ends === "never" ? (
              <p className="field-hint">Runs until you turn it off.</p>
            ) : (
              <div className="admin-form-row">
                <TextField
                  id={fieldId("endsAt")} label="Ends at" hint={timeZone ? `In your time zone, ${timeZone}.` : "In your time zone."} error={errorOf("endsAt")}
                  type="datetime-local" min={toLocalInput(new Date().toISOString())} value={draft.endsAt} onChange={event => update({ endsAt: event.target.value })}
                />
              </div>
            )}
          </fieldset>
        </section>

        <section className="card admin-card" aria-labelledby={`${uid}-payments`}>
          <div className="card-head"><h3 id={`${uid}-payments`}>Payments</h3></div>
          <SwitchRow
            id={`${uid}-open`} label="Take new payments" checked={draft.paymentsOpen} onChange={paymentsOpen => update({ paymentsOpen })}
            hint="Off: nobody can start an order. Orders already placed still complete."
          />
          <SwitchRow
            id={`${uid}-auto`} label="Apply verified payments automatically" checked={draft.autoVerify} onChange={autoVerify => update({ autoVerify })}
            hint="Off: payments are still checked on the network, then wait under Payments for you to approve them."
          />
          <Wallets billing={billing} error={billingError} />
        </section>
      </div>

      <aside className="admin-pricing-side" aria-labelledby={`${uid}-preview`}>
        <section className="card admin-card">
          <div className="card-head"><h3 id={`${uid}-preview`}>What customers see</h3></div>
          <Preview settings={check.effective} billing={billing} free={free} partial={Object.keys(check.errors).length > 0} />
          <div className="admin-save">
            {saveError && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{saveError}</p>}
            <p className="field-hint">{check.changed ? "Unsaved changes." : "Everything is saved."}</p>
            <div className="admin-actions">
              {check.changed && <Button variant="ghost" disabled={saving} onClick={undo}>Undo changes</Button>}
              <Button type="submit" variant="primary" busy={saving} disabled={!check.changed}>{saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </div>
        </section>
      </aside>
    </form>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="admin-switch-row">
      <div className="admin-switch-text">
        <label className="admin-switch-label" htmlFor={id}>{label}</label>
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      </div>
      <Switch.Root className="switch" id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}

/** The receiving wallets from the server's environment (read-only) and whether alerts are set up. */
function Wallets({ billing, error }: { billing: AdminBillingOverview | null; error: string | null }) {
  const missing = (variable: string, what: string): ReactNode => (
    <span className="admin-missing"><TriangleAlert size={14} aria-hidden="true" />Not set: {variable} is missing or isn't a valid address, so {what} {what.includes(" and ") ? "are" : "is"} off.</span>
  );
  return (
    <div className="admin-wallets">
      <h4 className="admin-form-title">Receiving wallets</h4>
      <p className="field-hint">From the server's environment (/etc/curialyai.env); a change takes a restart. No private key is kept anywhere.</p>
      {!billing ? (
        error ? <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />Couldn't load the wallets: {error}</p> : <p className="field-hint">Loading…</p>
      ) : (
        <>
          {!billing.wallets.evm && !billing.wallets.solana && (
            <div className="notice" data-tone="warning">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body">No receiving wallet is set, so nobody can pay. Set PAY_EVM_ADDRESS, PAY_SOLANA_ADDRESS or both.</div>
            </div>
          )}
          <dl className="admin-facts">
            <Fact label={listText(EVM_NETWORKS.map(network => network.label), "and")}>
              {billing.wallets.evm ? (
                <span className="admin-chain-value">
                  <code className="admin-mono">{billing.wallets.evm}</code>
                  <span className="admin-chain-actions">
                    {EVM_NETWORKS.map(network => (
                      <ExplorerLink key={network.id} href={`${network.explorer.address}${billing.wallets.evm}`} explorer={network.explorer.name} what={`the wallet on ${network.label}`} />
                    ))}
                  </span>
                </span>
              ) : missing("PAY_EVM_ADDRESS", listText(EVM_NETWORKS.map(network => network.label), "and"))}
            </Fact>
            <Fact label="Solana">
              {billing.wallets.solana ? (
                <span className="admin-chain-value">
                  <code className="admin-mono">{billing.wallets.solana}</code>
                  <span className="admin-chain-actions">
                    {PAYMENT_NETWORKS.filter(network => network.family === "solana").map(network => (
                      <ExplorerLink key={network.id} href={`${network.explorer.address}${billing.wallets.solana}`} explorer={network.explorer.name} what={`the wallet on ${network.label}`} />
                    ))}
                  </span>
                </span>
              ) : missing("PAY_SOLANA_ADDRESS", "Solana")}
            </Fact>
            <Fact label="Telegram alerts">
              {billing.alerts ? "On: your chat gets a message when a payment needs review or completes." : (
                <span className="admin-missing">Off: set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID to get a message when a payment needs review or completes.</span>
              )}
            </Fact>
          </dl>
        </>
      )}
    </div>
  );
}

/** Prices as the homepage and Plans & Billing would show them with these settings (the catalog's own sums). */
function Preview({ settings, billing, free, partial }: { settings: BillingSettings; billing: AdminBillingOverview | null; free: { creditsPerWindow: number; windowHours: number } | null; partial: boolean }) {
  const { offers, discount } = catalogPreview(settings);
  const badge = offerBadge(discount, shortDayText);
  const every = free ? `every ${free.windowHours} hours` : "per window";
  const samples = apiSample(discount.apiPercent);
  const offered = billing ? PAYMENT_NETWORKS.filter(network => (network.family === "evm" ? billing.wallets.evm : billing.wallets.solana)) : null;
  const payments = !settings.paymentsOpen ? "Payments are paused: nobody can start an order."
    : offered === null ? null
      : offered.length === 0 ? "No receiving wallet is set: nobody can start an order."
        : `Customers pay with USDT, USDC or the network's own coin on ${listText(offered.map(network => network.label))}.`;
  const price = (list: number, offer: number) => (
    offer < list ? <><s className="admin-preview-list"><span className="sr-only">List price </span>{formatPerMillion(list)}</s> {formatPerMillion(offer)}</> : formatPerMillion(offer)
  );

  return (
    <div className="admin-preview-body">
      {partial && <p className="field-hint">Fields with a problem show their saved value here.</p>}
      {badge ? (
        <p className="admin-preview-offer"><BadgePercent size={16} aria-hidden="true" /><span><strong>{badge}</strong> {offerSentence(discount)}</span></p>
      ) : (
        <p className="admin-preview-offer" data-off=""><span>No offer: everything is at list price.</span></p>
      )}
      <ul className="admin-preview-plans">
        {free && (
          <li className="admin-preview-plan">
            <span className="admin-preview-name">Free</span>
            <span className="admin-preview-price"><span className="admin-preview-amount">$0</span></span>
            <span className="admin-preview-meta">{creditCount(free.creditsPerWindow)} credits {every}</span>
          </li>
        )}
        {offers.map(offer => {
          const discounted = offer.discountPercent > 0 && offer.listUsd > offer.priceUsd;
          const multiple = free ? freeMultiple(offer.creditsPerWindow, free.creditsPerWindow) : null;
          return (
            <li key={offer.id} className="admin-preview-plan">
              <span className="admin-preview-name">{offer.name}</span>
              <span className="admin-preview-price">
                {discounted && <s className="admin-preview-list"><span className="sr-only">List price </span>{formatPrice(offer.listUsd)}</s>}
                <span className="admin-preview-amount"><span className="sr-only">{discounted ? "Now " : ""}</span>{formatPrice(offer.priceUsd)}</span>
                {discounted && <span className="chip">{offer.discountPercent}% off</span>}
              </span>
              <span className="admin-preview-meta">
                for {daysText(offer.days)}, paid once · {creditCount(offer.creditsPerWindow)} credits {every}{multiple ? ` · ${multiple}× the free allowance` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="admin-preview-api">
        <p className="admin-preview-api-title">Developer API, {discount.apiPercent > 0 ? `${discount.apiPercent}% off list prices` : "at list prices"}</p>
        <table className="data-table admin-preview-table">
          <caption className="sr-only">US dollars per million tokens</caption>
          <thead><tr><th scope="col">Model</th><th scope="col" className="admin-col-num">Input</th><th scope="col" className="admin-col-num">Output</th></tr></thead>
          <tbody>
            {samples.map(sample => (
              <tr key={sample.id}>
                <td>{sample.label}</td>
                <td className="num admin-col-num">{price(sample.list.input, sample.price.input)}</td>
                <td className="num admin-col-num">{price(sample.list.output, sample.price.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="field-hint">Per million tokens. Every model on the Developer API page gets the same percent off.</p>
      </div>
      {payments && <p className="admin-preview-pay">{payments}</p>}
    </div>
  );
}
