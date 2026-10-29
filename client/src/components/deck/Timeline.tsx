import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bot, Brain, Check, ChevronDown, Circle, CircleDashed, CircleDot, CircleSlash, ExternalLink, FilePen, FileSearch, FolderTree, GitBranch, GitCommitHorizontal,
  GitPullRequest, Globe, ImageOff, Info, ListChecks, Minus, Paperclip, RefreshCw, Rocket, Route, ScanEye, Search, ShieldCheck, SquareTerminal, Trash2, TriangleAlert,
  Unplug, Wrench, X, CircleX,
} from "lucide-react";
import { getModel, PHASES, type PhaseId, type PhaseState, type PlanStep, type RunTrigger } from "@shared/agent";
import { Attachments } from "@/components/Attachments";
import { LiveBrowser } from "@/components/LiveBrowser";
import { MediaImage } from "@/components/MediaImage";
import { Spinner } from "@/components/common/Spinner";
import { Tip } from "@/components/common/Tooltip";
import { JumpToLatest } from "@/components/task/JumpToLatest";
import { formatClock, plural } from "@/components/task/format";
import { formatDuration, formatTokens } from "@/lib/api";
import { scrubText, type BrowserState, type ItemOf, type StreamState, type TimelineItem, type TurnUsage } from "@/lib/taskStream";
import { useStickToBottom } from "@/lib/useStickToBottom";
import { DiffViewer } from "./DiffViewer";
import { HandoffCard, RoleBadge } from "./Team";

// ---------------------------------------------------------------------------------------------
// Phase stepper: short labels in the steps, the full name and note in one caption line
// ---------------------------------------------------------------------------------------------

export const PHASE_SHORT: Record<PhaseId, string> = { planning: "Plan", deliberation: "Reason", implementation: "Build", verification: "Verify", review: "Deliver" };
const PHASE_STATE_TEXT: Record<PhaseState, string> = { pending: "not started", active: "in progress", done: "done", failed: "stopped or failed", skipped: "skipped" };

export function stepperCaption(phases: StreamState["phases"], final = false) {
  const total = PHASES.length;
  const activeIndex = PHASES.findIndex(phase => phases[phase.id].state === "active");
  if (activeIndex >= 0) {
    const phase = PHASES[activeIndex];
    return `Step ${activeIndex + 1} of ${total} · ${phase.label} — ${phases[phase.id].note ?? phase.detail}`;
  }
  for (let index = total - 1; index >= 0; index--) {
    const phase = PHASES[index];
    if (phases[phase.id].state === "failed") return `Stopped at step ${index + 1} of ${total} · ${phase.label}${phases[phase.id].note ? ` — ${phases[phase.id].note}` : ""}`;
  }
  const done = PHASES.filter(phase => phases[phase.id].state === "done");
  const skipped = PHASES.filter(phase => phases[phase.id].state === "skipped").length;
  if (done.length) {
    const last = done[done.length - 1];
    return `${done.length} of ${total} steps done${skipped ? `, ${skipped} skipped` : ""} · ${last.label}${phases[last.id].note ? ` — ${phases[last.id].note}` : ""}`;
  }
  if (skipped) return `${plural(skipped, "step")} skipped`;
  // A finished run whose log has no step events (older runs, deploy-only runs) did not "not start".
  return final ? "No step details were recorded for this run" : "Not started yet";
}

function StepIcon({ state, live }: { state: PhaseState; live: boolean }) {
  if (state === "done") return <Check size={12} aria-hidden="true" />;
  if (state === "failed") return <X size={12} aria-hidden="true" />;
  if (state === "skipped") return <Minus size={12} aria-hidden="true" />;
  if (state === "active") return live ? <Spinner size={12} /> : <CircleDot size={12} aria-hidden="true" />;
  return <CircleDashed size={12} aria-hidden="true" />;
}

/** live: the run is executing (an active step may animate). */
export function PhaseStepper({ phases, live, final = false }: { phases: StreamState["phases"]; live: boolean; final?: boolean }) {
  return (
    <div className="stepper-wrap">
      <ol className="stepper" aria-label="Run progress" data-live={live || undefined}>
        {PHASES.map(phase => {
          const current = phases[phase.id];
          return (
            <li key={phase.id} className="step" data-state={current.state} aria-current={current.state === "active" ? "step" : undefined}>
              <span className="step-bar" aria-hidden="true" />
              <span className="step-label">
                <StepIcon state={current.state} live={live} />
                <span aria-hidden="true">{PHASE_SHORT[phase.id]}</span>
                <span className="sr-only">{phase.label}: {PHASE_STATE_TEXT[current.state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="stepper-caption">{stepperCaption(phases, final)}</p>
    </div>
  );
}

export function PlanView({ steps, live }: { steps: PlanStep[]; live: boolean }) {
  if (!steps.length) return null;
  const done = steps.filter(step => step.status === "done").length;
  return (
    <section className="tl plan-card" aria-label="Plan">
      <div className="tl-head is-static">
        <ListChecks size={15} className="tl-icon" aria-hidden="true" />
        <span className="tl-title">Plan</span>
        <span className="tl-sub">{done}/{steps.length} done</span>
      </div>
      <ol className="plan-list">
        {steps.map((step, index) => (
          <li key={index} className="plan-step" data-status={step.status}>
            {step.status === "done" ? <Check size={14} aria-hidden="true" /> : step.status === "in_progress" ? (live ? <Spinner size={14} /> : <CircleDot size={14} aria-hidden="true" />) : <Circle size={14} aria-hidden="true" />}
            <span>{step.title}</span>
            <span className="sr-only">({step.status === "in_progress" ? "in progress" : step.status === "done" ? "done" : "to do"})</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// ---------------------------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------------------------

/** streaming: the run is executing and the stream is connected (only then can it still grow). */
export const ThinkingBlock = memo(function ThinkingBlock({ item, usage, streaming }: { item: ItemOf<"thinking">; usage?: TurnUsage; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const live = !item.done && streaming;
  const now = useNow(live);
  const elapsed = item.done ? item.ms ?? 0 : Math.max(0, now - Date.parse(item.ts));
  const paragraphs = useMemo(() => item.text.split(/\n{2,}/).filter(paragraph => paragraph.trim()), [item.text]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, { enabled: live });
  const timing = item.done ? (elapsed ? `for ${formatDuration(elapsed)}` : "") : live ? formatDuration(elapsed) : "stopped";
  return (
    <div className="tl thinking" data-live={live || undefined}>
      <button type="button" className="tl-head" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={bodyId}>
        <Brain size={15} className="tl-icon" aria-hidden="true" />
        <span className="tl-title">{item.done || !live ? "Thought" : "Thinking"}</span>
        <span className="tl-sub">{[timing, usage ? `${formatTokens(usage.thinkingTokens)} thinking tokens` : ""].filter(Boolean).join(" · ")}</span>
        {live && <Spinner size={13} />}
        <ChevronDown size={14} className="tl-chevron" aria-hidden="true" />
      </button>
      <div id={bodyId} className="tl-frame" hidden={!open}>
        <div className="tl-body thinking-text" ref={scroller}>
          <div>
            {paragraphs.length === 0 && <p className="faint">{item.done || !live ? "No readable reasoning was returned for this step." : "Waiting for reasoning…"}</p>}
            {paragraphs.map((paragraph, index) => <p key={index} className="thinking-para">{paragraph}</p>)}
            {live && paragraphs.length > 0 && <span className="caret" aria-hidden="true" />}
          </div>
        </div>
        <JumpToLatest size="sm" show={live && stick.showJump} onJump={stick.jump} label="Latest" />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Tools and terminals
// ---------------------------------------------------------------------------------------------

const TOOL_ICONS: Record<string, LucideIcon> = {
  run_command: SquareTerminal, verify: ShieldCheck, read_file: FileSearch, write_file: FilePen, edit_file: FilePen, delete_file: Trash2,
  list_files: FolderTree, search_files: Search, web_fetch: Globe, delegate_research: Bot, research_agent: Bot, update_plan: ListChecks,
  browse: Globe, test_preview_visual: ScanEye, deploy_preview: Rocket, browser_click: Globe, browser_type: Globe, browser_scroll: Globe, browser_extract: Globe, browser_screenshot: Globe, browser_close: Globe, attach_files: Paperclip,
  github_list_repos: GitBranch, github_get_repo: GitBranch, github_clone_to_workspace: GitBranch, github_commit_and_push: GitBranch, github_create_pr: GitBranch,
};

/** Tools whose output is a terminal stream (shown open, and in the Terminal tab). */
const SHELL_TOOLS = new Set(["run_command", "verify", "research", "research_agent", "delegate_research", "browse", "deploy_preview", "github_clone_to_workspace", "github_commit_and_push"]);
export const TERMINAL_TOOLS = new Set(["run_command", "verify", "research", "research_agent", "delegate_research", "browse", "deploy_preview"]);

function toolSubtitle(item: ItemOf<"tool">) {
  const input = item.input ?? {};
  const value = input.command ?? input.path ?? input.url ?? input.pattern ?? input.task ?? input.repo ?? input.message ?? input.title ?? (item.name === "deploy_preview" && typeof input.kind === "string" ? `${input.kind} preview` : undefined);
  if (typeof value === "string") return value;
  if (item.name === "update_plan" && Array.isArray(input.steps)) return plural(input.steps.length, "step");
  return partialField(item.inputPartial, ["command", "path", "url", "pattern"]) ?? "";
}

/** Best-effort extraction of a string field from streaming (incomplete) tool-input JSON. */
function partialField(partial: string, keys: string[]) {
  for (const key of keys) {
    const match = partial.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "s"));
    if (!match) continue;
    let raw = match[1];
    if (raw.endsWith("\\")) raw = raw.slice(0, -1);
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      return raw;
    }
  }
  return null;
}

function exitText(result: NonNullable<ItemOf<"tool">["result"]>) {
  if (result.settled === "interrupted") return "interrupted before it finished";
  if (result.settled === "stopped") return "stopped before it finished";
  const code = result.exitCode !== undefined && result.exitCode !== null ? `exit ${result.exitCode}` : result.ok ? "ok" : "failed";
  return `${code} · ${formatDuration(result.durationMs)}`;
}

function Terminal({ command, segments, result, live }: { command?: string; segments: { stream: string; text: string }[]; result?: ItemOf<"tool">["result"]; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, { enabled: live });
  return (
    <div className="terminal-frame">
      <div className="terminal panel-ink" ref={scroller} tabIndex={0} aria-label={command ? `Output of ${command}` : "Command output"}>
        <div>
          {command && <div className="cmd">{command}</div>}
          {segments.map((segment, index) => <span key={index} className={segment.stream === "stderr" ? "stderr" : undefined}>{scrubText(segment.text)}</span>)}
          {live && <span className="caret" aria-hidden="true" />}
          {result && <span className="exit" data-ok={result.ok && !result.settled ? "" : undefined} data-settled={result.settled}>{exitText(result)}</span>}
        </div>
      </div>
      <JumpToLatest size="sm" show={live && stick.showJump} onJump={stick.jump} label="Latest output" />
    </div>
  );
}

function ToolStatus({ item, live }: { item: ItemOf<"tool">; live: boolean }) {
  const result = item.result;
  // No live region here: the page has one, for milestones only.
  if (!result) return live ? <span className="tl-status"><Spinner size={13} /><span className="sr-only">Running</span></span> : <span className="tl-status" title="No result was recorded"><CircleDashed size={14} aria-hidden="true" /><span className="sr-only">No result</span></span>;
  if (result.settled === "interrupted") return <span className="tl-status"><Unplug size={14} aria-hidden="true" /><span className="sr-only">Interrupted</span></span>;
  if (result.settled) return <span className="tl-status"><CircleSlash size={14} aria-hidden="true" /><span className="sr-only">Stopped</span></span>;
  return result.ok
    ? <span className="tl-status" data-tone="success"><Check size={14} aria-hidden="true" /><span className="sr-only">Succeeded</span></span>
    : <span className="tl-status" data-tone="danger"><CircleX size={14} aria-hidden="true" /><span className="sr-only">Failed</span></span>;
}

export const ToolCard = memo(function ToolCard({ item, streaming }: { item: ItemOf<"tool">; streaming: boolean }) {
  const isShell = SHELL_TOOLS.has(item.name);
  const isWrite = item.name === "write_file" || item.name === "edit_file" || item.name === "delete_file";
  const running = !item.result;
  const live = running && streaming;
  // Open while it runs or when it failed; a finished, successful step starts folded (long histories stay scannable).
  const [open, setOpen] = useState((isShell || isWrite) && (live || (item.result ? !item.result.ok && !item.result.settled : false)));
  const bodyId = useId();
  const Icon = TOOL_ICONS[item.name] ?? Wrench;
  const subtitle = scrubText(toolSubtitle(item));
  const liveCode = live && item.name === "write_file" ? partialField(item.inputPartial, ["content"]) : live && item.name === "edit_file" ? partialField(item.inputPartial, ["new_string"]) : null;
  const now = useNow(live);
  const elapsed = item.result ? item.result.durationMs : Math.max(0, now - Date.parse(item.ts));
  const tone = !item.result ? (live ? "progress" : "neutral") : item.result.settled ? "neutral" : item.result.ok ? "success" : "danger";
  const command = typeof item.input?.command === "string" ? item.input.command : undefined;
  return (
    <div className="tl tool" data-tone={tone}>
      <button type="button" className="tl-head" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={bodyId}>
        <Icon size={15} className="tl-icon" aria-hidden="true" />
        <span className="tl-title mono">{item.name}</span>
        <span className="tl-sub mono" title={subtitle || undefined}>{subtitle}</span>
        {item.result && <span className="chip tl-chip" data-tone={tone} title={scrubText(item.result.summary)}><span className="truncate">{scrubText(item.result.summary)}</span></span>}
        {(item.result || live) && <span className="tl-time">{formatDuration(elapsed)}</span>}
        <ToolStatus item={item} live={live} />
        <ChevronDown size={14} className="tl-chevron" aria-hidden="true" />
      </button>
      <div id={bodyId} className="tl-body" hidden={!open}>
        {open && (
          <>
            {isShell && <Terminal command={command} segments={item.output} result={item.result} live={live && Boolean(item.input)} />}
            {liveCode !== null && (
              <div className="terminal panel-ink synth">
                <div>
                  <div className="cmd-note">Writing {partialField(item.inputPartial, ["path"]) ?? "a file"}…</div>
                  {liveCode}
                  <span className="caret" aria-hidden="true" />
                </div>
              </div>
            )}
            {item.changes.map((change, index) => <DiffViewer key={index} change={change} defaultOpen={item.changes.length <= 3} />)}
            {!isShell && !item.changes.length && liveCode === null && (
              <pre className="kv panel-ink" tabIndex={0}>{scrubText(item.input ? JSON.stringify(item.input, null, 2) : item.inputPartial || "No input recorded.")}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Other timeline entries
// ---------------------------------------------------------------------------------------------

const TRIGGER_TEXT: Record<RunTrigger, string> = { prompt: "Task started", follow_up: "Follow-up", retry: "Retry", deploy: "Deploy requested" };

export function runLabel(trigger: RunTrigger, attempt: number) {
  return trigger === "retry" ? `Retry · attempt ${attempt}` : TRIGGER_TEXT[trigger];
}

function VerifyEntry({ item, streaming }: { item: ItemOf<"verify">; streaming: boolean }) {
  const failed = item.results.filter(result => !result.ok);
  const passed = item.results.length - failed.length;
  const pending = item.commands.filter(command => !item.results.some(result => result.command === command));
  const tone = failed.length ? "danger" : pending.length && streaming ? "progress" : item.results.length ? "success" : "neutral";
  return (
    <section className="tl verify" data-tone={tone} aria-label={`Verification pass ${item.iteration}`}>
      <div className="tl-head is-static">
        <ShieldCheck size={15} className="tl-icon" aria-hidden="true" />
        <span className="tl-title">Verification pass {item.iteration}</span>
        <span className="tl-sub">{plural(item.commands.length, "check")} · {passed} passed{failed.length ? ` · ${failed.length} failed` : ""}</span>
      </div>
      <ul className="verify-list">
        {item.results.map((result, index) => (
          <li key={`r${index}`} className="verify-row" data-ok={result.ok || undefined}>
            {result.ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
            <code className="verify-cmd">{result.command}</code>
            <span className="verify-meta">{result.ok ? "passed" : `failed${result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}`} · {formatDuration(result.durationMs)}</span>
            {!result.ok && result.output && (
              <details className="verify-output">
                <summary>Output</summary>
                <pre className="kv panel-ink" tabIndex={0}>{scrubText(result.output)}</pre>
              </details>
            )}
          </li>
        ))}
        {pending.map(command => (
          <li key={`p${command}`} className="verify-row" data-pending="">
            {streaming ? <Spinner size={13} /> : <Minus size={13} aria-hidden="true" />}
            <code className="verify-cmd">{command}</code>
            <span className="verify-meta">{streaming ? "running" : "not run"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MediaEntry({ item }: { item: ItemOf<"media"> }) {
  const isImage = item.mimeType.startsWith("image/");
  return (
    <figure className="tl media">
      {item.unavailable && !item.mediaId && !item.inlineDataUrl ? (
        <div className="media-missing"><ImageOff size={18} aria-hidden="true" /><span>The screenshot could not be kept (file storage was unavailable).</span></div>
      ) : isImage ? (
        item.mediaId ? <MediaImage id={item.mediaId} alt={item.caption || item.filename} /> : <MediaImage src={item.inlineDataUrl} alt={item.caption || item.filename} />
      ) : (
        <span className="chip">{item.filename}</span>
      )}
      <figcaption><Globe size={12} aria-hidden="true" /> {item.caption || item.filename}</figcaption>
    </figure>
  );
}

const NOTICE_TONE = { info: "info", warn: "warning", error: "danger" } as const;

type EntryProps = {
  item: TimelineItem;
  taskId: string;
  usage?: TurnUsage;
  browser?: BrowserState;
  /** The run is executing and the stream is connected. */
  streaming: boolean;
  /** The derived task status is active. */
  taskActive: boolean;
  streamConnected: boolean;
};

function EntryBody({ item, taskId, usage, browser, streaming, taskActive, streamConnected }: EntryProps) {
  switch (item.kind) {
    case "handoff":
      return <HandoffCard item={item} defaultOpen={item.handoff !== "report"} />;
    case "browser":
      return browser ? <LiveBrowser taskId={taskId} browser={browser} taskActive={taskActive} streamConnected={streamConnected} compact /> : null;
    case "attachments":
      return <Attachments taskId={taskId} files={item.files} auto={item.auto} more={item.more} skipped={item.skipped} generated={item.generated} partial={item.partial} />;
    case "thinking":
      return <ThinkingBlock item={item} usage={usage} streaming={streaming} />;
    case "tool":
      return <ToolCard item={item} streaming={streaming} />;
    case "run":
      return (
        <div className="tl-divider" role="separator" aria-label={runLabel(item.trigger, item.attempt)}>
          <span className="chip" data-tone={item.trigger === "retry" || item.trigger === "deploy" ? "info" : "neutral"}>{runLabel(item.trigger, item.attempt)}{formatClock(item.ts) ? ` · ${formatClock(item.ts)}` : ""}</span>
        </div>
      );
    case "dispatch":
      return (
        <div className="tl tl-line">
          <Route size={14} className="tl-icon" aria-hidden="true" />
          <span className="tl-title">{getModel(item.model)?.label ?? item.model}</span>
          <span className="tl-sub wrap">{item.reason}</span>
        </div>
      );
    case "verify":
      return <VerifyEntry item={item} streaming={streaming} />;
    case "recovery":
      return (
        <div className="tl tl-line" data-tone="warning">
          <RefreshCw size={14} className="tl-icon" aria-hidden="true" />
          <span className="tl-title">Self-healing</span>
          <span className="tl-sub wrap">{scrubText(item.detail)} → {item.action}{item.attempt > 1 ? ` (attempt ${item.attempt})` : ""}</span>
        </div>
      );
    case "heal":
      return (
        <div className="tl tl-line" data-tone="warning">
          <Wrench size={14} className="tl-icon" aria-hidden="true" />
          <span className="tl-title">Self-healing iteration {item.iteration}</span>
          <span className="tl-sub wrap">{scrubText(item.reason)} → sending the failure back to {getModel(item.model)?.label ?? "the model"}</span>
        </div>
      );
    case "external":
      return (
        <div className="tl tl-line">
          <Bot size={14} className="tl-icon" aria-hidden="true" />
          <span className="tl-title">Research Agent · {item.status}</span>
          <span className="tl-sub wrap">{scrubText(item.detail)}</span>
        </div>
      );
    case "repo": {
      const RepoIcon = item.action === "push" ? GitCommitHorizontal : item.action === "pr" ? GitPullRequest : GitBranch;
      return (
        <div className="tl tl-line" data-tone="info">
          <RepoIcon size={14} className="tl-icon" aria-hidden="true" />
          <span className="tl-title">{item.label}</span>
          <span className="tl-sub mono" title={item.detail}>{item.detail}</span>
          {item.url && (
            <Tip content="Open on GitHub">
              <a className="icon-btn sm" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on GitHub: ${item.label}`}>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </Tip>
          )}
        </div>
      );
    }
    case "media":
      return <MediaEntry item={item} />;
    case "notice": {
      const Icon = item.level === "info" ? Info : TriangleAlert;
      return (
        // Not an alert: history replays would announce old errors. The page announces new failures.
        <div className="notice tl-notice" data-tone={NOTICE_TONE[item.level]}>
          <Icon size={15} aria-hidden="true" />
          <p className="notice-body">{scrubText(item.message)}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

/** One Activity entry; Dev Team items show which member produced them. */
export const TimelineEntry = memo(function TimelineEntry(props: EntryProps) {
  const { item } = props;
  const body = <EntryBody {...props} />;
  const lane = item.agent && item.kind !== "handoff";
  return (
    <div className="tl-entry" data-entry-key={item.key} data-kind={item.kind}>
      {lane ? (
        <div className="role-lane" data-role={item.agent}>
          <RoleBadge role={item.agent!} />
          {body}
        </div>
      ) : body}
    </div>
  );
});
