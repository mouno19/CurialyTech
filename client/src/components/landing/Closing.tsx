import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { Reveal } from "@/components/common/Reveal";
import { FOOTER_WORKSPACE, NAV_LINKS, PRINCIPLES, PROMISES } from "./content";
import { LaunchFigure } from "./figures";
import { scrollToAnchor, SectionLabel } from "./primitives";

export function Principles() {
  return (
    <section id="principles" className="lp-section lp-principles" aria-labelledby="lp-principles-title">
      <div className="lp-container">
        <Reveal className="lp-principles-head">
          <div>
            <SectionLabel index="05">Principles</SectionLabel>
            <h2 id="lp-principles-title" className="lp-h2">
              Trusted with the
              <br />
              <em>whole</em> ticket.
            </h2>
          </div>
          <p className="lp-fine">How the workspace behaves, every time, by design.</p>
        </Reveal>
        <dl className="lp-metrics">
          {PRINCIPLES.map((item, index) => (
            <Reveal key={item.label} delay={index * 0.06} className="lp-metric">
              <dt className="sr-only">{item.label}</dt>
              <dd>
                <span className="lp-metric-value">{item.value}</span>
                <span className="lp-metric-label">{item.label}</span>
              </dd>
            </Reveal>
          ))}
        </dl>
        <div className="lp-quotes">
          <Reveal className="lp-quote-lead">
            <figure>
              <span className="lp-quote-mark" aria-hidden="true">“</span>
              <blockquote>An agent you can trust is one that tells you what it's unsure about, so you can rely on the parts it is sure about.</blockquote>
              <figcaption><span className="lp-quote-avatar" aria-hidden="true">§</span><span><b>The first principle</b><span>Uncertain parts are flagged, never hidden.</span></span></figcaption>
            </figure>
          </Reveal>
          <div className="lp-quote-side">
            {PROMISES.map((promise, index) => (
              <Reveal key={promise.title} delay={0.08 * (index + 1)}>
                <figure className="lp-promise">
                  <p className="lp-promise-title">{promise.title}</p>
                  <p>{promise.body}</p>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCTA({ signedIn }: { signedIn: boolean }) {
  const jump = (event: MouseEvent<HTMLAnchorElement>) => {
    if (scrollToAnchor("#composer")) event.preventDefault();
  };
  return (
    <section id="start" className="lp-section lp-final" aria-labelledby="lp-final-title">
      <div className="lp-container">
        <Reveal y={30}>
          <div className="lp-final-card">
            <figure className="lp-final-figure">
              <LaunchFigure />
              <figcaption className="sr-only">Fig. 2 — A task, launched</figcaption>
            </figure>
            <div className="lp-final-grid">
              <div className="lp-final-main">
                <SectionLabel index="06">Start shipping</SectionLabel>
                <h2 id="lp-final-title" className="lp-h2">
                  Your backlog called.
                  <br />
                  <em>Curialy</em> picked up.
                </h2>
                <p className="lp-lede">
                  Sign in to your workspace, connect GitHub and hand over your first task. It starts in its own sandboxed workspace in seconds.
                </p>
              </div>
              <div className="lp-final-side">
                <Link href={signedIn ? "/" : "/login"} className="lp-pill lp-pill-lg lp-pill-accent m-nudge">
                  {signedIn ? "Open the workspace" : "Sign in to the workspace"} <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <p className="lp-final-note">
                  Or <a href="#composer" className="ink-link" onClick={jump}>write the task now</a> and press Assign: it's waiting in the composer when you sign in.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** Whether the server answers its public health check (it says nothing about the engines behind it). */
function useServerUp() {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then(response => setUp(response.ok), () => !controller.signal.aborted && setUp(false));
    return () => controller.abort();
  }, []);
  return up;
}

export function Footer({ signedIn }: { signedIn: boolean }) {
  const up = useServerUp();
  const jump = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (scrollToAnchor(href)) event.preventDefault();
  };
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <Wordmark />
            <p>The autonomous coding agent for people who would rather review than type.</p>
            <p className="lp-status" data-state={up === null ? "checking" : up ? "up" : "down"}>
              <span className="lp-dot" aria-hidden="true" />
              {up === null ? "Checking the server…" : up ? "Server online" : "Server not reachable right now"}
            </p>
          </div>
          <nav aria-label="Footer" className="lp-footer-nav">
            <div>
              <p className="lp-footer-title">Workspace</p>
              {/* Visitors are signed out: "/" is this page, so the dashboard link asks them to sign in. */}
              <ul>{FOOTER_WORKSPACE.map(link => <li key={link.href}><Link href={!signedIn && link.href === "/" ? "/login" : link.href} className="ink-link">{link.label}</Link></li>)}</ul>
            </div>
            <div>
              <p className="lp-footer-title">Explore</p>
              <ul>{NAV_LINKS.map(link => <li key={link.href}><a href={link.href} className="ink-link" onClick={event => jump(event, link.href)}>{link.label}</a></li>)}</ul>
            </div>
          </nav>
        </div>
        <Reveal className="lp-footer-word" y={40} aria-hidden="true">
          <p>curialy<span>.</span></p>
        </Reveal>
        <div className="lp-footer-bottom">
          <p>© 2026 Curialy AI</p>
          <p>Made with curiosity, compiled with care.</p>
        </div>
      </div>
    </footer>
  );
}
