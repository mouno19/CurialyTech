import { useRef, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/common/Reveal";
import { useScrollProgress } from "@/lib/motion";
import { CAPABILITIES, STACK, STEPS } from "./content";
import { SectionLabel } from "./primitives";

/** The marquee under the hero: what it writes, runs and tests in its sandbox. */
export function StackStrip() {
  const row = [...STACK, ...STACK];
  return (
    <section className="lp-strip" aria-label="Languages and tools Curialy works with">
      <div className="lp-container lp-strip-inner">
        <p className="lp-strip-label">
          Writes, runs and tests
          <span>in a sandboxed workspace</span>
        </p>
        <div className="m-marquee lp-strip-marquee">
          <ul className="m-marquee-track lp-strip-track">
            {row.map((item, index) => (
              <li key={`${item.name}-${index}`} data-style={item.style} aria-hidden={index >= STACK.length || undefined}>{item.name}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Capabilities() {
  return (
    <section id="capabilities" className="lp-section lp-capabilities" aria-labelledby="lp-cap-title">
      <div className="lp-container lp-cap-grid">
        <div className="lp-cap-intro">
          <Reveal className="lp-sticky">
            <SectionLabel index="01">Capabilities</SectionLabel>
            <h2 id="lp-cap-title" className="lp-h2 lp-h2-md">
              Five verbs.
              <br />
              <em>One</em> agent.
            </h2>
            <p className="lp-lede">
              Most AI tools autocomplete a line. Curialy owns the whole loop, from reading the ticket to handing you a tested
              change you can see running.
            </p>
            <p className="lp-pill-note"><span className="lp-dot" data-tone="moss" aria-hidden="true" />Any language, any framework it can run in its sandbox</p>
          </Reveal>
        </div>
        <ol className="lp-ledger">
          {CAPABILITIES.map((cap, index) => (
            <Reveal as="li" key={cap.verb} delay={index * 0.05} className="lp-ledger-row">
              <span className="lp-ledger-index">0{index + 1}</span>
              <h3 className="lp-ledger-verb">{cap.verb}</h3>
              <div className="lp-ledger-body">
                <p className="lp-ledger-title">{cap.title}</p>
                <p>{cap.body}</p>
                <div className="lp-ledger-foot">
                  <code className="lp-artifact"><span aria-hidden="true">›</span> {cap.artifact}</code>
                  <ArrowUpRight size={20} className="lp-ledger-arrow" aria-hidden="true" />
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const list = useRef<HTMLDivElement>(null);
  const spine = useRef<HTMLDivElement>(null);
  useScrollProgress(list, spine);
  return (
    <section id="how-it-works" className="lp-section lp-how" aria-labelledby="lp-how-title">
      <div className="lp-container">
        <div className="lp-split">
          <Reveal className="lp-split-main">
            <SectionLabel index="02">How it works</SectionLabel>
            <h2 id="lp-how-title" className="lp-h2">
              From one sentence
              <br />
              to <em>shipped</em> software.
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="lp-split-side">
            <p className="lp-lede">
              Curialy works like a careful senior engineer: it looks before it leaps, shows its plan, and never asks you to review
              something it hasn't run.
            </p>
          </Reveal>
        </div>
        <div ref={list} className="lp-steps">
          <div className="lp-spine" aria-hidden="true" />
          <div ref={spine} className="lp-spine lp-spine-fill" aria-hidden="true" style={{ "--progress": 0 } as CSSProperties} />
          <ol className="lp-steps-list">
          {STEPS.map((step, index) => (
            <li key={step.title} className="lp-step" data-side={index % 2 ? "right" : "left"}>
              <span className="lp-step-node" aria-hidden="true">0{index + 1}</span>
              <Reveal delay={0.05} className="lp-step-body">
                <h3 className="lp-step-title"><span className="sr-only">Step {index + 1}: </span>{step.title}</h3>
                <p>{step.body}</p>
                <code className="lp-snippet">{step.snippet}</code>
              </Reveal>
            </li>
          ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
