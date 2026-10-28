import { Reveal } from "@/components/common/Reveal";
import { StarterTabs } from "@/components/StarterTabs";
import type { StarterTask } from "@/lib/starterTasks";
import { SectionLabel } from "./primitives";

export function UseCases({ onUse }: { onUse: (task: StarterTask) => void }) {
  return (
    <section id="use-cases" className="lp-section" aria-labelledby="lp-cases-title">
      <div className="lp-container">
        <Reveal className="lp-narrow">
          <SectionLabel index="04">Use cases</SectionLabel>
          <h2 id="lp-cases-title" className="lp-h2">
            What to hand
            <br />
            to <em>Curialy</em> first.
          </h2>
        </Reveal>
        <Reveal delay={0.08} className="lp-cases">
          <StarterTabs onUse={onUse} idPrefix="lp-case" />
        </Reveal>
      </div>
    </section>
  );
}
