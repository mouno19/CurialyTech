import { isFinalStatus } from "@shared/taskStatus";
import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown, Ellipsis, FileDiff, Globe, PanelRightClose, PanelRightOpen, ScrollText, SquareTerminal, Workflow } from "lucide-react";
import { getModel, type AgentTaskSummary, type TaskStatus } from "@shared/agent";
import { IconButton } from "@/components/common/IconButton";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { TeamPanel } from "@/components/deck/Team";
import { PhaseStepper, TERMINAL_TOOLS } from "@/components/deck/Timeline";
import { formatTokens } from "@/lib/api";
import { totals, type InspectorTab, type StreamState } from "@/lib/taskStream";
import { capCount, plural } from "./format";
import { ActivityPanel, ChangesPanel, RawLog, TerminalPanel } from "./InspectorPanels";
import { PreviewPanel, type DeployAction } from "./PreviewPanel";
import type { DeploymentsData, WorkspacePreviewData } from "./usePreviewData";

export const INSPECTOR_TABS: { id: Exclude<InspectorTab, "raw">; label: string; icon: LucideIcon }[] = [
  { id: "activity", label: "Activity", icon: Workflow },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "changes", label: "Changes", icon: FileDiff },
  { id: "preview", label: "Preview", icon: Globe },
];

export function inspectorCounts(state: StreamState, liveDeployments: number): Record<Exclude<InspectorTab, "raw">, number> {
  let activity = 0;
  let terminal = 0;
  for (const item of state.items) {
    if (item.kind !== "user" && item.kind !== "text") activity++;
    if (item.kind === "tool" && TERMINAL_TOOLS.has(item.name)) terminal++;
  }
  return { activity, terminal, changes: state.changes.length, preview: liveDeployments };
}

const tabName = (label: string, count: number) => (count ? `${label}, ${count}` : label);

function Metrics({ state, task, active }: { state: StreamState; task: AgentTaskSummary | null; active: boolean }) {
  const [open, setOpen] = useState(false);
  const sum = totals(state.usage);
  const modelId = state.model ?? task?.model ?? "";
  const model = getModel(modelId)?.label ?? (modelId || "—");
  const files = new Set(state.changes.map(change => change.path)).size;
  const connection = state.live ? "Live" : state.connected ? "Following" : state.ended ? "History" : state.missing ? "Unavailable" : "Reconnecting…";
  const tone = state.live ? "progress" : state.connected ? "info" : state.ended ? "neutral" : "warning";
  return (
    <div className="metrics-wrap">
      <button type="button" className="metrics-toggle" aria-expanded={open} aria-controls="task-metrics" onClick={() => setOpen(value => !value)}>
        <ChevronDown size={13} aria-hidden="true" />
        Usage · {plural(state.usage.length, "turn")} · {formatTokens(sum.input + sum.output)} tokens
      </button>
      <dl className="metrics" id="task-metrics" data-open={open || undefined}>
        <div><dt>Model</dt><dd title={model}>{model}</dd></div>
        <div><dt>Turns</dt><dd>{state.usage.length}</dd></div>
        <div><dt>In</dt><dd>{formatTokens(sum.input)}</dd></div>
        <div><dt>Out</dt><dd>{formatTokens(sum.output)}</dd></div>
        <div><dt>Thinking</dt><dd>{formatTokens(sum.thinking)}</dd></div>
        <div><dt>Files</dt><dd>{files}</dd></div>
        <div>
          <dt>Stream</dt>
          <dd><span className="dot" data-tone={tone} data-live={state.live && active ? "" : undefined} aria-hidden="true" /> {connection}</dd>
        </div>
      </dl>
    </div>
  );
}

type Props = {
  taskId: string;
  task: AgentTaskSummary | null;
  state: StreamState;
  status: TaskStatus | null;
  active: boolean;
  streaming: boolean;
  tab: InspectorTab;
  /** byUser: the reader chose it (no automatic switching afterwards). */
  onTab: (tab: InspectorTab, byUser: boolean) => void;
  counts: Record<Exclude<InspectorTab, "raw">, number>;
  focusKey: string | null;
  onFocused: () => void;
  /** On screen (not in a hidden pane, not collapsed). */
  visible: boolean;
  preview: WorkspacePreviewData;
  deployments: DeploymentsData;
  deploy: DeployAction | null;
  /** Desktop: collapse into the rail. */
  onCollapse?: () => void;
  collapsed?: boolean;
};

/** What the agent is doing and did: lifecycle, usage, and the Activity / Terminal / Changes / Preview views. */
export function Inspector(props: Props) {
  const { taskId, task, state, status, active, streaming, tab, onTab, counts, focusKey, onFocused, visible, preview, deployments, deploy, onCollapse, collapsed } = props;
  const listRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(listRef);
  const team = Boolean(task?.team) || Object.keys(state.team).length > 0;

  return (
    <Tabs.Root className="inspector" value={tab} onValueChange={value => onTab(value as InspectorTab, true)} inert={collapsed || undefined} aria-label="Inspector">
      <div className="inspector-head">
        {team && <TeamPanel team={state.team} live={streaming} />}
        <PhaseStepper phases={state.phases} live={streaming} final={isFinalStatus(status)} />
        <Metrics state={state} task={task} active={active} />
      </div>
      <div className="inspector-tabbar">
        <Tabs.List ref={listRef} className="tabs inspector-tabs" aria-label="Inspector views">
          {INSPECTOR_TABS.map(item => (
            <Tabs.Trigger key={item.id} value={item.id} className="tab" aria-label={tabName(item.label, counts[item.id])}>
              <item.icon size={15} aria-hidden="true" />
              <span className="tab-label">{item.label}</span>
              {counts[item.id] > 0 && <span className="tab-count" aria-hidden="true">{capCount(counts[item.id])}</span>}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton size="sm" label="More inspector views" icon={Ellipsis} data-active={tab === "raw" || undefined} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={12}>
              <DropdownMenu.Item className="menu-item" onSelect={() => onTab("raw", true)}>
                <ScrollText size={15} aria-hidden="true" />
                <span className="menu-item-body">
                  <span>Raw log</span>
                  <span className="menu-item-hint">{plural(state.eventCount, "event")} as received (debug view)</span>
                </span>
                {tab === "raw" && <span className="menu-item-end"><Check size={14} aria-hidden="true" /></span>}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {onCollapse && <IconButton size="sm" label="Collapse the inspector" icon={PanelRightClose} aria-expanded="true" aria-controls="inspector-panel" onClick={onCollapse} />}
      </div>
      <Tabs.Content value="activity" forceMount hidden={tab !== "activity"} className="tab-panel inspector-panel">
        <ActivityPanel taskId={taskId} state={state} streaming={streaming} taskActive={active} focusKey={focusKey} onFocused={onFocused} visible={visible && tab === "activity"} />
      </Tabs.Content>
      <Tabs.Content value="terminal" forceMount hidden={tab !== "terminal"} className="tab-panel inspector-panel">
        <TerminalPanel state={state} streaming={streaming} />
      </Tabs.Content>
      <Tabs.Content value="changes" forceMount hidden={tab !== "changes"} className="tab-panel inspector-panel">
        <ChangesPanel changes={state.changes} />
      </Tabs.Content>
      {/* Not force-mounted: frames are only loaded while the tab is open. */}
      <Tabs.Content value="preview" className="tab-panel inspector-panel">
        <PreviewPanel taskId={taskId} status={status} active={active} preview={preview} deployments={deployments} deploy={deploy} />
      </Tabs.Content>
      <Tabs.Content value="raw" className="tab-panel inspector-panel" aria-labelledby={undefined} aria-label="Raw log">
        <RawLog events={state.events} total={state.eventCount} onClose={() => onTab("activity", true)} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/** The collapsed inspector (desktop): expand, or jump straight to a view. */
export function InspectorRail({ counts, onExpand }: { counts: Record<Exclude<InspectorTab, "raw">, number>; onExpand: (tab?: InspectorTab) => void }) {
  return (
    <nav className="inspector-rail" aria-label="Inspector (collapsed)">
      <IconButton label="Show the inspector" icon={PanelRightOpen} tooltipSide="left" aria-expanded="false" aria-controls="inspector-panel" onClick={() => onExpand()} />
      <span className="inspector-rail-rule" aria-hidden="true" />
      {INSPECTOR_TABS.map(item => (
        <IconButton key={item.id} label={`Show ${tabName(item.label, counts[item.id])}`} icon={item.icon} tooltipSide="left" onClick={() => onExpand(item.id)} />
      ))}
    </nav>
  );
}
