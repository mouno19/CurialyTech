import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Check, Circle, FileCode2, Globe, Lock, RefreshCw, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Reveal } from "@/components/common/Reveal";
import { useInView, useReducedMotion } from "@/lib/motion";
import { Spinner } from "@/components/common/Spinner";
import { DIFF_LINES, SAMPLE_TASK, TASK_PROGRESS, TERMINAL_LINES } from "./content";
import { SectionLabel } from "./primitives";

/** Plays the terminal one line at a time while the window is on screen, then loops. */
function useTerminalPlayback(active: boolean, reduce: boolean) {
  const [count, setCount] = useState(reduce ? TERMINAL_LINES.length : 0);
  useEffect(() => {
    if (reduce) {
      setCount(TERMINAL_LINES.length);
      return;
    }
    if (!active) return;
    const finished = count >= TERMINAL_LINES.length;
    const timer = setTimeout(() => setCount(current => (current >= TERMINAL_LINES.length ? 0 : current + 1)), finished ? 3200 : 520 + Math.random() * 380);
    return () => clearTimeout(timer);
  }, [active, count, reduce]);
  return count;
}

function PanelHeader({ icon: Icon, title, meta }: { icon: LucideIcon; title: string; meta?: string }) {
  return (
    <div className="lp-win-panel-head">
      <span><Icon size={14} aria-hidden="true" />{title}</span>
      {meta && <span className="lp-win-meta">{meta}</span>}
    </div>
  );
}

export function WorkspacePreview({ signedIn }: { signedIn: boolean }) {
  const windowRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const terminal = useRef<HTMLDivElement>(null);
  const inView = useInView(windowRef, "-15% 0px");
  const lines = useTerminalPlayback(inView, reduce);
  const deployed = lines >= TERMINAL_LINES.length;
  // Like a terminal: the newest line stays in view once the box is full (older ones scroll off the top).
  useEffect(() => {
    const element = terminal.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <section id="workspace" className="lp-section lp-workspace" aria-labelledby="lp-ws-title">
      <div className="grid-paper-dark lp-workspace-paper" aria-hidden="true" />
      <div className="lp-container lp-workspace-inner">
        <div className="lp-split">
          <Reveal className="lp-split-main">
            <SectionLabel index="03" tone="paper">The workspace</SectionLabel>
            <h2 id="lp-ws-title" className="lp-h2">
              Watch it work.
              <br />
              <em>Or don't</em>: it leaves notes.
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="lp-split-side">
            <p className="lp-lede">
              Every task gets a live workspace: the plan, every edit it makes, every command it runs and the running result,
              streamed as it happens. Files its commands change are attached when it finishes.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1} y={40}>
          <p className="sr-only">
            A sample run: Curialy adds checkout to a storefront. It reads the repository, installs the payments package, writes the
            session code, finds that discounts were applied after tax, fixes it, gets all 14 tests passing and opens the result in
            the preview.
          </p>
          {/* Decorative and inert: nothing inside (e.g. the scrolling diff on phones) can take focus. */}
          <div ref={windowRef} className="lp-win" aria-hidden="true" inert>
            <div className="lp-win-chrome">
              <div className="lp-win-title">
                <span className="lp-win-lights"><i /><i /><i /></span>
                <span><span className="lp-win-dim">curialy ›</span> sample run · {SAMPLE_TASK}</span>
              </div>
              <span className="lp-win-state" data-done={deployed || undefined}>
                <span className="lp-win-state-dot" />
                {deployed ? "Ready for review · 09:12" : "Running · 06:42"}
              </span>
            </div>
            <div className="lp-win-grid">
              <div className="lp-win-progress">
                <p className="lp-win-kicker">Task progress</p>
                <div className="lp-win-bar"><span style={{ width: deployed ? "100%" : "72%" }} /></div>
                <ul className="lp-win-steps">
                  {TASK_PROGRESS.map(step => {
                    const state = deployed ? "done" : step.state;
                    return (
                      <li key={step.label} data-state={state}>
                        {state === "done" && <Check size={16} className="lp-ok" />}
                        {state === "active" && <Spinner size={15} />}
                        {state === "pending" && <Circle size={16} />}
                        <span>
                          <span className="lp-win-step-label">{step.label}</span>
                          <span className="lp-win-step-time">{deployed && step.state !== "done" ? "done" : step.time}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="lp-win-note">
                  <p className="lp-win-kicker" data-accent="">Agent note</p>
                  <p>Found a pre-existing bug: discounts were applied after tax. Fixed it and added a regression test.</p>
                </div>
              </div>

              <div className="lp-win-code">
                <PanelHeader icon={FileCode2} title="src/checkout/session.ts" meta="+7 −1" />
                <pre className="lp-win-diff">
                  {DIFF_LINES.map((line, index) => (
                    <div key={index} data-kind={line.kind}>
                      <span className="lp-diff-n">{index + 1}</span>
                      <span className="lp-diff-sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
                      <span className="lp-diff-text">{line.text || " "}</span>
                    </div>
                  ))}
                </pre>
                <div className="lp-win-term">
                  <PanelHeader icon={TerminalSquare} title="terminal · sandbox" meta="node 22 · linux" />
                  <div className="lp-win-term-body" ref={terminal}>
                    {TERMINAL_LINES.slice(0, lines).map((line, index) => (
                      <p key={index} data-tone={line.tone}>{line.text}</p>
                    ))}
                    {!deployed && !reduce && <span className="caret" />}
                  </div>
                </div>
              </div>

              <div className="lp-win-result">
                <div className="lp-win-result-head">
                  <p className="lp-win-kicker"><Globe size={14} />Live result</p>
                  <RefreshCw size={14} className="lp-win-refresh" data-spinning={!deployed && !reduce ? "" : undefined} />
                </div>
                <div className="lp-mock">
                  <div className="lp-mock-bar"><Lock size={12} /><span>preview · storefront/checkout</span></div>
                  <div className="lp-mock-body">
                    <p className="lp-mock-title">Checkout</p>
                    <div className="lp-mock-item">
                      <span className="lp-mock-swatch" />
                      <span className="lp-mock-name"><b>Field Notes Jacket</b><span>Size M · Oat</span></span>
                      <b>$180</b>
                    </div>
                    <div className="lp-mock-sum">
                      <p><span>Discount · CURIOUS10</span><span className="lp-mock-discount">−$18.00</span></p>
                      <p><b>Total</b><b>$162.00</b></p>
                    </div>
                    <span className="lp-mock-pay">Pay now</span>
                  </div>
                </div>
                <dl className="lp-win-checks">
                  <div><dt>tests</dt><dd data-ok={deployed || undefined}>{deployed ? "14 / 14 ✓" : "12 / 14"}</dd></div>
                  <div><dt>types</dt><dd data-ok="">clean</dd></div>
                  <div><dt>preview</dt><dd>{deployed ? "running · screenshot" : "building"}</dd></div>
                </dl>
              </div>
            </div>
          </div>
          <div className="lp-workspace-cta">
            {signedIn ? (
              <Link href="/" className="lp-pill lp-pill-paper m-nudge">Open your workspace <ArrowUpRight size={16} aria-hidden="true" /></Link>
            ) : (
              <a href="/api/auth/github/login?next=%2F" className="lp-pill lp-pill-paper m-nudge">Start free with GitHub <ArrowUpRight size={16} aria-hidden="true" /></a>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
