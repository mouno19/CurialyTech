import type { CSSProperties, MouseEvent } from "react";
import { ArrowRight, Play } from "lucide-react";
import { HeroFigure } from "./figures";
import { LandingComposer, type ComposerSeed } from "./LandingComposer";
import { scrollToAnchor, SectionLabel } from "./primitives";

/** Staggered entrance (the reference's enter(delay)): delay in seconds. */
const enter = (delay: number): CSSProperties => ({ "--m-delay": `${Math.round(delay * 1000)}ms` }) as CSSProperties;

export function Hero({ signedIn, seed }: { signedIn: boolean; seed?: ComposerSeed }) {
  const jump = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (scrollToAnchor(href)) event.preventDefault();
  };
  return (
    <section id="top" className="lp-hero grain" aria-labelledby="lp-hero-title">
      <div className="lp-hero-paper grid-paper fade-mask" aria-hidden="true" />
      <div className="lp-container lp-hero-grid">
        <div className="lp-hero-main">
          <div className="lp-hero-kicker lp-enter" style={enter(0)}>
            <SectionLabel index="00">Autonomous coding agent</SectionLabel>
            <a href="#how-it-works" className="lp-badge" onClick={event => jump(event, "#how-it-works")}>
              <span className="lp-badge-new">New</span>
              Dev Team: Architect, Engineer, Reviewer
            </a>
          </div>
          <h1 id="lp-hero-title" className="lp-hero-title lp-enter" style={enter(0.08)}>
            Hand it the ticket.
            <br />
            Get back a <em>shipped</em>
            <br className="lp-br-sm" /> pull request.
          </h1>
          <p className="lp-hero-lede lp-enter" style={enter(0.18)}>
            Curialy AI is the autonomous coding agent that plans, writes, debugs, tests and deploys real software inside its own
            sandboxed workspace, so you review instead of type.
          </p>
          <div className="lp-hero-ctas lp-enter" style={enter(0.26)}>
            <a href="#composer" className="lp-pill lp-pill-lg m-nudge" onClick={event => jump(event, "#composer")}>
              Assign your first task <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a href="#workspace" className="lp-pill lp-pill-lg" data-variant="outline" onClick={event => jump(event, "#workspace")}>
              <span className="lp-play" aria-hidden="true"><Play size={12} /></span>
              Watch a sample run
            </a>
          </div>
          <p className="lp-hero-fine lp-enter" style={enter(0.32)}>
            Its own workspace for every task · GitHub export, branches and pull requests · Live previews that clean up after themselves
          </p>
        </div>

        <figure className="lp-hero-figure m-settle" style={enter(0.2)}>
          <HeroFigure />
          <figcaption>Fig. 1 — A request, unfurling into software</figcaption>
        </figure>

        <div className="lp-hero-composer lp-enter" style={enter(0.4)}>
          <LandingComposer signedIn={signedIn} seed={seed} />
        </div>

        <aside className="lp-hero-note lp-enter" style={enter(0.5)} aria-label="Margin note">
          <p className="lp-note-label">margin note</p>
          <p>Every task runs in its own workspace: a real terminal, a real browser, a real runtime. On repositories you link it can push a branch and open a pull request for you to review; new repositories and live previews wait for your confirmation.</p>
          <p className="lp-note-fact">one workspace · per task</p>
          <p className="lp-note-fact">every step · on the record</p>
        </aside>
      </div>
    </section>
  );
}
