import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, CornerDownRight } from "lucide-react";
import { useSwap } from "@/lib/motion";
import { STARTER_TASKS, type StarterTask } from "@/lib/starterTasks";

/**
 * Starter tasks as tabs (the reference's use cases): panels leave and then enter (its
 * AnimatePresence mode="wait"), with the ARIA tabs keyboard model (arrows move between tabs,
 * Home and End jump to the ends). Lays itself out by its own width (container query).
 */
export function StarterTabs({ onUse, idPrefix, useLabel = "Use this task", size = "lg" }: { onUse: (task: StarterTask) => void; idPrefix: string; useLabel?: string; size?: "lg" | "md" }) {
  const [activeId, setActiveId] = useState(STARTER_TASKS[0].id);
  const { shown, leaving } = useSwap(activeId);
  const active = STARTER_TASKS.find(task => task.id === shown) ?? STARTER_TASKS[0];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = STARTER_TASKS.length - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setActiveId(STARTER_TASKS[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="st" data-size={size}>
      <div className="st-grid">
        <div role="tablist" aria-label="Starter tasks" className="st-tabs">
          {STARTER_TASKS.map((task, index) => {
            const selected = task.id === activeId;
            return (
              <button
                key={task.id}
                ref={element => { tabs.current[index] = element; }}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${task.id}`}
                aria-selected={selected}
                aria-controls={`${idPrefix}-panel`}
                tabIndex={selected ? 0 : -1}
                className="st-tab"
                onClick={() => setActiveId(task.id)}
                onKeyDown={event => onKeyDown(event, index)}
              >
                <span className="st-tab-label">
                  <span className="st-index" aria-hidden="true">0{index + 1}</span>
                  <span className="st-tab-name">{task.tab}</span>
                </span>
                <ArrowRight size={20} className="st-arrow" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${active.id}`} tabIndex={0} className="st-panel">
          <div key={active.id} className="m-swap" data-leaving={leaving || undefined}>
            <p className="st-headline">{active.headline}</p>
            <figure className="st-example">
              <figcaption>Example task</figcaption>
              <blockquote><span aria-hidden="true">› </span>{active.prompt}</blockquote>
            </figure>
            <div className="st-foot">
              <ul className="st-outcomes">
                {active.outcomes.map(outcome => (
                  <li key={outcome}><CornerDownRight size={16} aria-hidden="true" /><span>{outcome}</span></li>
                ))}
              </ul>
              <div className="st-deliver">
                <p className="st-deliver-label">You get</p>
                <p className="st-deliver-value">{active.deliverable}</p>
                <button type="button" className="st-use m-nudge" onClick={() => onUse(active)}>
                  {useLabel} <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
