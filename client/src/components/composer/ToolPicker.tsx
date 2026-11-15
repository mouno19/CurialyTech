import * as Popover from "@radix-ui/react-popover";
import { Blocks } from "lucide-react";
import { TOOL_IDS, TOOLS, type ToolId } from "@shared/components";
import { Tip } from "@/components/common/Tooltip";
import { POPOVER_COLLISION } from "@/components/RepoSelector";

/** The tools a stored preference may hold (unknown ids from older builds are dropped). */
export const validTools = (value: unknown): ToolId[] => (Array.isArray(value) ? [...new Set(value.filter((id): id is ToolId => TOOL_IDS.includes(id as ToolId)))] : []);

/**
 * The tools the task may use. The user picks the tools; the agent picks the components within
 * them (and asks before using a tool that isn't selected). None selected: not limited.
 */
export function ToolPicker({ selected, onChange }: { selected: ToolId[]; onChange: (tools: ToolId[]) => void }) {
  const toggle = (id: ToolId) => onChange(selected.includes(id) ? selected.filter(current => current !== id) : TOOL_IDS.filter(tool => tool === id || selected.includes(tool)));
  const count = selected.length;
  return (
    <Popover.Root>
      <Tip content={count ? `Tools: ${TOOLS.filter(tool => selected.includes(tool.id)).map(tool => tool.label).join(", ")}` : "Tools: choose what this task may use (none chosen: not limited)"}>
        <Popover.Trigger asChild>
          <button type="button" className="toggle skill-pick" aria-label={count ? `Tools, ${count} selected` : "Tools, not limited"}>
            <Blocks size={14} aria-hidden="true" />
            <span className="toggle-label">Tools</span>
            {count > 0 && <span className="omni-opts-count" aria-hidden="true">{count}</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content className="popover skill-pick-panel" side="bottom" align="start" sideOffset={8} collisionPadding={POPOVER_COLLISION} aria-label="Tools for this task">
          <p className="skill-pick-lead">Choose the tools this task may use. The agent picks the components it needs within them, and asks before it needs another.</p>
          <ul className="skill-pick-list">
            {TOOLS.map(tool => (
              <li key={tool.id}>
                <label className="skill-pick-row">
                  <input type="checkbox" checked={selected.includes(tool.id)} onChange={() => toggle(tool.id)} />
                  <span>
                    <span className="skill-pick-name">{tool.label}</span>
                    <span className="skill-pick-body">{tool.detail}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="field-hint" aria-live="polite">{count ? `${count} selected.` : "None selected: the task isn't limited."}</p>
          {count > 0 && <button type="button" className="link tool-pick-clear" onClick={() => onChange([])}>Clear (don't limit)</button>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
