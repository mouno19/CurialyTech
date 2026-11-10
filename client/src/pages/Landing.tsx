import { useEffect, useState } from "react";
import "@/styles/landing.css";
import { Hero } from "@/components/landing/Hero";
import type { ComposerSeed } from "@/components/landing/LandingComposer";
import { Navbar } from "@/components/landing/Navbar";
import { Capabilities, HowItWorks, StackStrip } from "@/components/landing/Sections";
import { UseCases } from "@/components/landing/UseCases";
import { WorkspacePreview } from "@/components/landing/WorkspacePreview";
import { FinalCTA, Footer, Principles } from "@/components/landing/Closing";
import { Pricing } from "@/components/landing/Pricing";

/**
 * The public homepage (the reference landing design): for visitors at "/", and for the operator
 * at "/welcome". Loaded on demand with its own stylesheet, so the workspace bundle stays small.
 */
export default function Landing({ signedIn }: { signedIn: boolean }) {
  const [seed, setSeed] = useState<ComposerSeed>();

  useEffect(() => {
    const previous = document.title;
    document.title = "Curialy AI · the autonomous coding agent";
    document.documentElement.classList.add("lp-document");
    return () => {
      document.title = previous;
      document.documentElement.classList.remove("lp-document");
    };
  }, []);

  return (
    <div className="lp">
      <a href="#main" className="skip-link">Skip to content</a>
      <Navbar signedIn={signedIn} />
      <main id="main" className="lp-main" tabIndex={-1}>
        <Hero signedIn={signedIn} seed={seed} />
        <StackStrip />
        <Capabilities />
        <HowItWorks />
        <WorkspacePreview signedIn={signedIn} />
        <UseCases onUse={task => setSeed({ prompt: task.prompt, team: task.team ?? false, nonce: Date.now() })} />
        <Principles />
        {/* Live prices from the catalog (the section is there at once; its prices fill in when they load). */}
        <Pricing signedIn={signedIn} />
        <FinalCTA signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </div>
  );
}
