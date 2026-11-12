import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { API_TOPUP, MAX_OPEN_ORDERS, MAX_PLAN_MONTHS, ORDER_TTL_MINUTES, LATE_SUBMIT_HOURS, type BillingCatalog } from "@shared/billing";
import { formatPrice } from "@/components/billing/plans";
import { MAX_ACTIVE_KEYS, GATEWAY_BASE_URL } from "@shared/gateway";
import { FREE_VAULT_BYTES, FREE_VAULT_FILES } from "@shared/media";
import { SUPPORT_LIMITS } from "@shared/support";
import { Wordmark } from "@/components/brand/Logo";
import { TopUpPrice } from "@/components/billing/TopUpPrice";
import { ThemeMenu, useThemeOption } from "@/components/common/ThemeMenu";
import { billingApi } from "@/lib/billing";
import "@/styles/docs.css";

const SECTIONS = [
  { id: "start", label: "Start here" },
  { id: "tasks", label: "Tasks" },
  { id: "credits", label: "Credits" },
  { id: "plans", label: "Plans" },
  { id: "api", label: "Developer API" },
  { id: "payments", label: "Payments" },
  { id: "previews", label: "Previews" },
  { id: "workspace", label: "Files and skills" },
  { id: "support", label: "Support" },
  { id: "use", label: "Acceptable use" },
  { id: "terms", label: "Terms" },
  { id: "privacy", label: "Privacy" },
] as const;

const UPDATED = "12 November 2026";

function ThemeButton() {
  const option = useThemeOption();
  return (
    <ThemeMenu>
      <button type="button" className="icon-btn" aria-label={`Theme: ${option.label}`}>
        <option.icon size={18} aria-hidden="true" />
      </button>
    </ThemeMenu>
  );
}

function goTo(id: string, behavior: ScrollBehavior = "smooth") {
  const node = document.getElementById(id);
  if (!node) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  node.scrollIntoView({ behavior: reduce || behavior === "auto" ? "auto" : "smooth", block: "start" });
  node.focus({ preventScroll: true });
}

/** Plan prices and the top-up pair, from the catalog the rest of the site uses. */
function CurrentPrices() {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    billingApi.catalog().then(data => { if (alive) setCatalog(data); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  const paid = catalog?.apiTopup.minUsd ?? API_TOPUP.minUsd;
  const rate = catalog?.apiTopup.creditPerUsd ?? API_TOPUP.creditPerUsd;
  return (
    <div className="docs-card">
      <TopUpPrice paidUsd={paid} creditPerUsd={rate} variant="note" />
      <p>A {formatPrice(paid)} top-up. The crossed price is the API balance you receive. The price beside it is what you pay.</p>
      {catalog && catalog.plans.length > 0 && (
        <ul className="docs-plans">
          {catalog.plans.map(plan => (
            <li key={plan.id} className="docs-plan">
              <span className="docs-plan-name">{plan.name}</span>
              <span>
                {plan.discountPercent > 0 && plan.listUsd > plan.priceUsd && <s><span className="sr-only">List price </span>{formatPrice(plan.listUsd)}</s>}
                <span className="docs-plan-pay"><span className="sr-only">{plan.discountPercent > 0 ? "You pay " : "Price "}</span>{formatPrice(plan.priceUsd)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {catalog && <p>Each plan is paid once and does not renew. {catalog.paymentsOpen ? "Payments are open." : "New payments are paused right now. An order already placed can still be paid."}</p>}
      {failed && <p>The live prices could not be loaded. Plans & Billing and the homepage show them.</p>}
    </div>
  );
}

/**
 * Documentation and the terms of the service. Public: a visitor can read it before signing in.
 * `section` opens that part (the /terms address opens Terms).
 */
export default function Docs({ signedIn, section }: { signedIn: boolean; section?: string }) {
  const [current, setCurrent] = useState(section ?? "start");

  useEffect(() => {
    const previous = document.title;
    document.title = "Documentation · Curialy";
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    const id = section ?? window.location.hash.replace(/^#/, "");
    if (!id) return;
    const frame = requestAnimationFrame(() => goTo(id, "auto"));
    return () => cancelAnimationFrame(frame);
  }, [section]);

  useEffect(() => {
    const nodes = SECTIONS.map(item => document.getElementById(item.id)).filter((node): node is HTMLElement => node !== null);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setCurrent(visible.target.id);
    }, { rootMargin: "-15% 0px -55% 0px", threshold: [0.15, 0.4, 1] });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const url = `${window.location.pathname}#${id}`;
    window.history.replaceState(null, "", url);
    setCurrent(id);
    goTo(id);
  };

  return (
    <div className="docs">
      <a href="#docs-title" className="skip-link">Skip to content</a>
      <header className="docs-bar">
        <Link href="/" className="docs-bar-brand">
          <Wordmark />
          <span className="docs-kicker">Docs</span>
        </Link>
        <div className="docs-bar-actions">
          <ThemeButton />
          {signedIn ? (
            <Link href="/" className="btn secondary">Workspace</Link>
          ) : (
            <a href="/api/auth/github/login?next=%2Fdocs" className="btn primary">Sign in</a>
          )}
        </div>
      </header>
      <div className="docs-layout">
        <nav aria-label="On this page">
          <ol className="docs-nav">
            {SECTIONS.map(item => (
              <li key={item.id}>
                <a href={`#${item.id}`} aria-current={current === item.id ? "location" : undefined} onClick={jump(item.id)}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="docs-article">
          <header className="docs-lede">
            <p className="docs-kicker">Documentation</p>
            <h1 id="docs-title" tabIndex={-1}>How Curialy works</h1>
            <p className="docs-standfirst">
              Curialy is a coding workspace and a Developer API. You hand a task to an agent, review what it did, and pay only when you want more credits or API balance. This page is the guide, the terms, and the privacy notice.
            </p>
            <p className="docs-updated">Updated {UPDATED}</p>
          </header>

          <section className="docs-section" id="start" tabIndex={-1}>
            <h2>Start here</h2>
            <p>Sign in with GitHub. A new account can start without a card. The homepage composer can hold a task until you sign in, and it is waiting when you arrive.</p>
            <p>Two things are billed separately:</p>
            <ul>
              <li><strong>Credits</strong> pay for the agent in the workspace. A plan raises how many you can spend.</li>
              <li><strong>API balance</strong> pays for the Developer API, in dollars, at the prices on that page. A top-up adds balance.</li>
            </ul>
            <p>The prices in force are on the <Link href="/welcome#pricing">homepage</Link> and on Plans & Billing. An order keeps the price it was given.</p>
          </section>

          <section className="docs-section" id="tasks" tabIndex={-1}>
            <h2>Tasks</h2>
            <p>A task is one piece of work: build something, fix a bug, explain a repository, or change code you point the agent at. Each task has its own workspace, command log, and record of what happened.</p>
            <ul>
              <li>You can attach files and, when you have connected GitHub, point a task at a repository.</li>
              <li>Follow-up messages continue the same task. Cancelling a run stops it where it is. It does not publish, push, or deploy on the way out, and the files written so far stay.</li>
              <li>A failed run is shown as failed, with the error. Nothing is labelled done that is not.</li>
              <li>Read the result. The agent can be wrong, and you decide what to keep, commit, or throw away.</li>
            </ul>
          </section>

          <section className="docs-section" id="credits" tabIndex={-1}>
            <h2>Credits</h2>
            <p>A run spends credits. Heavier models spend them faster. Welcome credits are given once to a new account and do not refill. They are not a cash balance.</p>
            <p>A refilling allowance, when you have one, comes back on a schedule. For an ordinary allowance the first window starts when you spend a credit, and later windows follow that time. A launch boost, when you have earned it, starts when the boost begins and refills from that time. The meter on Plans & Billing says which one you are on, and when it refills.</p>
            <p>Following the Curialy account on X and posting about Curialy can each add credits once. Doing both can also add a one-time amount of API balance and, while that offer is on, a larger refilling allowance. The amounts and the account to follow are on Plans & Billing. That API grant is the number of dollars shown there. It is not multiplied the way a top-up is.</p>
          </section>

          <section className="docs-section" id="plans" tabIndex={-1}>
            <h2>Plans</h2>
            <p>A plan raises your credit allowance for a set number of days. You pay once, in crypto. It does not renew and it does not charge a card later. You can pay for up to {MAX_PLAN_MONTHS} periods ahead. Buying the plan you already have adds time at the end. A higher plan takes over, and time left on a lower plan is carried across at its value.</p>
            <p>When a launch offer is on, the list price is crossed out and the price you pay is beside it, the same way a top-up is shown. The offer applies to plans. It does not reduce Developer API token prices.</p>
            <CurrentPrices />
          </section>

          <section className="docs-section" id="api" tabIndex={-1}>
            <h2>Developer API</h2>
            <p>The Developer API answers at <code>{GATEWAY_BASE_URL}</code> in the shapes the Anthropic and OpenAI client libraries already speak. Create a key on the Developer API page. You can keep {MAX_ACTIVE_KEYS} active keys. The secret is shown once. Store it yourself. Curialy keeps only enough to recognise the key later.</p>
            <p>Each request is reserved against your balance for about the most it could cost, then charged for the tokens it actually used, at the prices listed for that model. Those prices are per million tokens. There is no further percent off.</p>
            <h3>What a top-up shows</h3>
            <p>A top-up is priced like a plan. The crossed price is the API balance you receive. The price next to it is what you send. Paying {formatPrice(1)} adds {formatPrice(API_TOPUP.creditPerUsd)} of balance. A {formatPrice(API_TOPUP.minUsd)} top-up is shown as {formatPrice(API_TOPUP.minUsd * API_TOPUP.creditPerUsd)} crossed out and {formatPrice(API_TOPUP.minUsd)} to pay. You can choose {API_TOPUP.presets.map(formatPrice).join(", ")}, or another whole-dollar amount from {formatPrice(API_TOPUP.minUsd)} to {formatPrice(API_TOPUP.maxUsd)}.</p>
            <p>The balance is spent at the prices on the Developer API page. It is not cash, it is not transferable, and it is not the same thing as workspace credits.</p>
          </section>

          <section className="docs-section" id="payments" tabIndex={-1}>
            <h2>Payments</h2>
            <p>Plans and top-ups are paid in crypto, on a network and coin offered at checkout. The order shows the exact amount, including the fraction of a cent that marks the payment as yours. Send that amount, to the address on the order, in the coin and on the network you chose. A different coin or network is not the same payment.</p>
            <ul>
              <li>A payment quote lasts {ORDER_TTL_MINUTES} minutes. After that, start the order again rather than sending the old amount.</li>
              <li>You can have {MAX_OPEN_ORDERS} orders in progress. Pay one, or let it expire, before opening another past that.</li>
              <li>After you send the payment, submit the transaction hash on the order. A hash can still be submitted for {LATE_SUBMIT_HOURS} hours after the quote expires.</li>
              <li>If you paid and the order will no longer take the hash, open Support and send the hash there. Do not send the payment a second time.</li>
            </ul>
            <p>Curialy checks the payment on the chain you used. When new payments are paused, orders already placed can still be completed. A paused checkout does not take new ones.</p>
          </section>

          <section className="docs-section" id="previews" tabIndex={-1}>
            <h2>Previews</h2>
            <p>A task can publish a temporary preview of a site it built. The address is on curialy.tech. A preview lasts about two hours and is then removed, including the copy that was published for it. It is a way to look at the work, not a place to host a site. When it is gone, start a new one from the task.</p>
          </section>

          <section className="docs-section" id="workspace" tabIndex={-1}>
            <h2>Files, skills, and memory</h2>
            <p>The Media Vault keeps files from your work. On a free account it holds {Math.round(FREE_VAULT_BYTES / 1024 / 1024)} MB or {FREE_VAULT_FILES} files, whichever comes first. A plan removes that limit while the plan is active.</p>
            <p>A skill is a procedure you write once, such as how this account runs tests or how a pull request should be described. You attach it to any task. Project memory is one short note per repository, written by the agent, for decisions and constraints in that repo. A skill is yours to edit. A memory note is not a substitute for reading the result of a task.</p>
          </section>

          <section className="docs-section" id="support" tabIndex={-1}>
            <h2>Support</h2>
            <p>Support is a conversation on the Support page, one issue per conversation. You can have {SUPPORT_LIMITS.openPerAccount} open conversations. A subject is at most {SUPPORT_LIMITS.subject} characters and a message at most {SUPPORT_LIMITS.body.toLocaleString("en-US")}. Closing a conversation does not delete it. Writing again opens it. The person who runs Curialy replies in the same thread.</p>
            <p>Use Support for a payment that needs a transaction hash, a balance that does not match the order, or a task that did not behave as this page describes. Include the order code when the question is about a payment.</p>
          </section>

          <section className="docs-section" id="use" tabIndex={-1}>
            <h2>Acceptable use</h2>
            <p>Use Curialy for your own work and for work you are allowed to do. You may not:</p>
            <ul>
              <li>break the law, or ask the agent to break the law</li>
              <li>attack, scan, or disrupt systems you do not have permission to test</li>
              <li>try to get past the limits of your account, or use someone else's account, key, or payment</li>
              <li>send malware, credentials that are not yours, or material that exploits a person</li>
              <li>overload the service, or resell the API as an unattended proxy for someone else's product without using it yourself</li>
            </ul>
            <p>Curialy may refuse a request, stop a run, or close an account that is used this way. Credits and API balance already spent are not refunded as cash.</p>
          </section>

          <section className="docs-section" id="terms" tabIndex={-1}>
            <h2>Terms</h2>
            <p>These are the rules for using Curialy at curialy.tech. They are written in plain language so you can read them before you pay. By signing in, placing an order, or calling the API, you agree to them.</p>
            <h3>The service</h3>
            <p>Curialy provides an AI coding workspace and a Developer API. Output is generated and can be wrong, incomplete, or unsuitable. You are responsible for reviewing it before you rely on it, ship it, or send it to anyone else. Curialy does not promise that a task will succeed, that a preview will stay up, or that a particular model will remain available.</p>
            <h3>Your account</h3>
            <p>You sign in with GitHub. You are responsible for activity on your account, including API keys you create and payments you start. Do not share a key. Revoke a key you no longer control.</p>
            <h3>What you pay for</h3>
            <p>Workspace credits and API balance are for use on Curialy. They are not money, not a deposit, and not transferable. A plan is a one-time payment for a period of higher credits. A top-up buys the API balance shown as the crossed price, and you pay the price beside it. Prices can change. An order that has already been created keeps the price and the balance it was given. A launch offer can end. When it ends, plan prices return to the list price. Token prices stay the prices on the Developer API page.</p>
            <h3>Payments</h3>
            <p>You pay the amount on the order, on the network and in the coin the order names. A payment that does not match is not applied. Curialy may decline a payment it cannot verify. If you believe you paid, the way to resolve it is the order page or Support, with the transaction hash. Sending the same payment twice does not create a second order.</p>
            <h3>Your material</h3>
            <p>You keep the rights you already have in prompts, files, and repositories you bring. You give Curialy permission to use that material to run the task, the preview, and the API request you asked for. Do not submit material you are not allowed to use. You are responsible for what you ask the agent to publish.</p>
            <h3>Availability and changes</h3>
            <p>The service is offered as it is available. Maintenance, a paused checkout, a model being removed, or a preview expiring can interrupt a feature without a separate notice. Curialy may change these terms. The date at the top of this page changes when they do. Continuing to use Curialy after that date is agreement to the updated terms. If you do not agree, stop using the service and do not place a new order.</p>
            <h3>Ending use</h3>
            <p>You can stop at any time. Curialy can suspend or close an account that breaks these terms, abuses the service, or creates risk for other people. Closing an account does not turn leftover credits or API balance into a cash refund.</p>
          </section>

          <section className="docs-section" id="privacy" tabIndex={-1}>
            <h2>Privacy</h2>
            <p>Curialy stores what it needs to run the account you created and the work you asked for:</p>
            <ul>
              <li>the GitHub identity you sign in with, such as your login, name, and avatar</li>
              <li>tasks, prompts, files, and the record of what the agent did</li>
              <li>orders, the coin and network you chose, and the transaction hash you submit</li>
              <li>API keys in a form that can be checked, not the secret after it has been shown to you</li>
              <li>support conversations</li>
            </ul>
            <p>A crypto payment is public on the network you chose. Curialy can see the transaction you point it at, and so can anyone else looking at that chain.</p>
            <p>This information is used to run Curialy: to sign you in, to do the task, to apply a payment, to answer a support conversation, and to keep the service within its limits. It is not sold. Questions about your account go to Support, from the signed-in account the question is about.</p>
          </section>
        </article>
      </div>
    </div>
  );
}
