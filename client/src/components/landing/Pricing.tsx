import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { MAX_PLAN_MONTHS, type BillingCatalog } from "@shared/billing";
import { billingApi } from "@/lib/billing";
import { Reveal } from "@/components/common/Reveal";
import { creditCount, shortDayText } from "@/components/billing/format";
import { formatPrice, freeMultiple, freeTierLines, listText, offerEnd, offerText, topUpSentence, vaultText } from "@/components/billing/plans";
import { scrollToAnchor, SectionLabel } from "./primitives";

/** The coins a payment can use, stablecoins first, each once (USDT and USDC are on every network). */
function coinsAccepted(catalog: BillingCatalog) {
  const coins: string[] = [];
  for (const kind of ["stablecoin", "native"] as const) {
    for (const network of catalog.networks) for (const coin of network.coins) if (coin.kind === kind && !coins.includes(coin.coin)) coins.push(coin.coin);
  }
  return coins;
}

/**
 * Free, Pro and Max from the live catalog (public, no sign-in needed), the Developer API in one
 * line and the coins accepted. The section is always there (the navigation and /#pricing links
 * land on it); its prices show once the catalog answers, and never made up when it can't.
 */
export function Pricing({ signedIn }: { signedIn: boolean }) {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    billingApi.catalog().then(data => { if (active) setCatalog(data); }, () => { if (active) setFailed(true); });
    return () => {
      active = false;
    };
  }, []);

  // A /#pricing link opens before this lazy page and its prices are there, so the browser's own
  // jump finds nothing: jump once the prices settle, unless the visitor has scrolled meanwhile.
  const settled = catalog !== null || failed;
  const jumped = useRef(false);
  useEffect(() => {
    if (!settled || jumped.current) return;
    jumped.current = true;
    if (window.location.hash !== "#pricing" || window.scrollY > 0) return;
    requestAnimationFrame(() => scrollToAnchor("#pricing"));
  }, [settled]);

  const priced = catalog && catalog.plans.length ? catalog : null;
  const open = priced ? priced.paymentsOpen : true;
  // While new payments are paused (the lede says so) nobody is sent to sign in to pay.
  const cta = signedIn ? (
    <div className="lp-pricing-cta">
      <Link href="/billing" className="lp-pill lp-pill-lg m-nudge">Open Plans &amp; Billing <ArrowRight size={16} aria-hidden="true" /></Link>
      <p className="lp-final-note">Your plan, credits and API balance are there.</p>
    </div>
  ) : open ? (
    <div className="lp-pricing-cta">
      <a href="/api/auth/github/login?next=%2Fbilling" className="lp-pill lp-pill-lg m-nudge">Sign in with GitHub <ArrowRight size={16} aria-hidden="true" /></a>
      <p className="lp-final-note">Plans and top-ups are on the Plans & Billing page once you're signed in.</p>
    </div>
  ) : null;

  return (
    <section id="pricing" className="lp-section lp-pricing" aria-labelledby="lp-pricing-title" aria-busy={!settled || undefined}>
      <div className="lp-container">
        <Reveal className="lp-pricing-head">
          <div>
            <SectionLabel index="06">Pricing</SectionLabel>
            <h2 id="lp-pricing-title" className="lp-h2">
              Free to start.
              <br />
              <em>Pay once</em> for more.
            </h2>
            <p className="lp-lede">
              {priced ? lede(priced) : settled ? `The current prices couldn't be shown here. Plans & Billing has them${signedIn ? "" : " once you're signed in"}.` : "Loading the current prices…"}
            </p>
          </div>
          {priced && open && offerPill(priced)}
        </Reveal>
        {priced ? (
          <>
            {/* The reveal is on the item, the hover lift on the card inside it (one transition each). */}
            <ul className="lp-plans">
              <Reveal as="li">
                <div className="lp-plan">
                  <h3 className="lp-plan-name">Free</h3>
                  <p className="lp-plan-price"><span className="lp-plan-amount">$0</span></p>
                  <p className="lp-plan-term">no card needed</p>
                  <FreeCredits free={priced.free} />
                </div>
              </Reveal>
              {priced.plans.map((plan, index) => {
                const discounted = plan.discountPercent > 0 && plan.listUsd > plan.priceUsd;
                const multiple = freeMultiple(plan.creditsPerWindow, priced.free.creditsPerWindow);
                return (
                  <Reveal as="li" key={plan.id} delay={0.06 * (index + 1)}>
                    <div className="lp-plan">
                      <h3 className="lp-plan-name">{plan.name}</h3>
                      <p className="lp-plan-price">
                        {discounted && <s className="lp-plan-list"><span className="sr-only">List price </span>{formatPrice(plan.listUsd)}</s>}
                        <span className="lp-plan-amount"><span className="sr-only">{discounted ? "Now " : ""}</span>{formatPrice(plan.priceUsd)}</span>
                      </p>
                      <p className="lp-plan-term">for {plan.days} days, paid once · up to {MAX_PLAN_MONTHS} months ahead</p>
                      <p className="lp-plan-credits">
                        {creditCount(plan.creditsPerWindow)} credits every {priced.free.windowHours} hours
                        {multiple && <span>{multiple}× the free allowance</span>}
                        <span>{vaultText(true)}</span>
                      </p>
                    </div>
                  </Reveal>
                );
              })}
            </ul>
            <Reveal className="lp-pricing-foot">
              <div className="lp-pricing-notes">
                <p className="lp-pricing-api">
                  {topUpSentence(priced.apiTopup.creditPerUsd)} Top up from {formatPrice(priced.apiTopup.minUsd)}.
                </p>
                <Coins catalog={priced} />
              </div>
              {cta}
            </Reveal>
          </>
        ) : (
          // No prices to show: the way to them still is (the CTA keeps its column on wide screens).
          <Reveal className="lp-pricing-foot">{cta}</Reveal>
        )}
      </div>
    </section>
  );
}

/** The plans in a sentence, by the names the operator gave them (the free allowance is on its card). */
function lede(catalog: BillingCatalog) {
  const lengths = [...new Set(catalog.plans.map(plan => plan.days))];
  const term = lengths.length === 1 ? `${lengths[0]} days` : "a set number of days";
  const names = listText(catalog.plans.map(plan => plan.name), "and");
  return catalog.paymentsOpen
    ? `${names} raise your credits for ${term}, paid once in crypto: nothing renews. Pay for up to ${MAX_PLAN_MONTHS} months ahead at the same price.`
    : `${names} raise your credits for ${term}, paid once in crypto. New payments are paused right now.`;
}

/** The offer as a pill: what it takes off (plans, API prices or both) and when it ends; null without one. */
function offerPill(catalog: BillingCatalog) {
  const offer = offerText(catalog.discount);
  if (!offer) return null;
  return <p className="lp-pill-note lp-offer"><span className="lp-dot" aria-hidden="true" />{offer} · {offerEnd(catalog.discount.endsAt, shortDayText)}</p>;
}

/** The Free card: welcome credits once, what X adds, and the boost while it is offered. */
function FreeCredits({ free }: { free: BillingCatalog["free"] }) {
  const lines = freeTierLines(free, shortDayText);
  return (
    <p className="lp-plan-credits">
      {lines.headline}
      {lines.lines.map(line => <span key={line}>{line}</span>)}
      <span>{vaultText(false)}</span>
    </p>
  );
}

function Coins({ catalog }: { catalog: BillingCatalog }) {
  const coins = coinsAccepted(catalog);
  if (!coins.length) return null;
  return (
    <p className="lp-pricing-coins">
      <span className="lp-pricing-logos" aria-hidden="true">{catalog.networks.map(network => <img key={network.id} src={network.logo} alt="" width={22} height={22} />)}</span>
      <span>Pay with {listText(coins)} on {listText(catalog.networks.map(network => network.label))}.</span>
    </p>
  );
}
