import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bot, Brain, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDashed, ExternalLink, FilePen, FileSearch, FolderTree,
  GitBranch, Globe, ListChecks, Loader2, Paperclip, RefreshCw, Rocket, Route, Search, ShieldCheck, SquareTerminal, Trash2, Wrench, X, XCircle,
} from "lucide-react";
import { PHASES, type PlanStep } from "@shared/agent";
import type { BrowserState, StreamState, TimelineItem, TurnUsage } from "@/lib/taskStream";
import { LiveBrowser } from "@/components/LiveBrowser";
import { Attachments } from "@/components/Attachments";
import { getModel } from "@shared/agent";
import { formatDuration, formatTokens } from "@/lib/api";
import { DiffViewer } from "./DiffViewer";

export function PhaseStepper({ phases }: { phases: StreamState["phases"] }) {
  return (
    <div className="stepper" role="list" aria-label="Task lifecycle">
      {PHASES.map((phase, index) => {
        const current = phases[phase.id];
        const Icon = current.state === "done" ? CheckCircle2 : current.state === "failed" ? XCircle : current.state === "active" ? Loader2 : CircleDashed;
        return (
          <div key={phase.id} className={`step ${current.state}`} role="listitem" title={`${phase.label}: ${phase.detail}${current.note ? `\n${current.note}` : ""}`}>
            <div className="step-bar" />
            <div className="step-label"><Icon size={12} className={current.state === "active" ? "spin" : ""} /><span>{index + 1}. {phase.label}</span></div>
            <div className="step-note">{current.note ?? (current.state === "skipped" ? "Skipped" : phase.detail)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function PlanView({ steps }: { steps: PlanStep[] }) {
  if (!steps.length) return null;
  const done = steps.filter(step => step.status === "done").length;
  return (
    <div className="tl">
      <div className="tl-head"><ListChecks size={15} className="faint" /><span className="title">Plan</span><span className="sub">{done}/{steps.length} complete</span></div>
      <div className="tl-body plan">
        {steps.map((step, index) => (
          <div key={index} className={`plan-step ${step.status}`}>
            {step.status === "done" ? <Check size={15} color="var(--mint)" /> : step.status === "in_progress" ? <Loader2 size={15} className="spin" color="var(--violet)" /> : <Circle size={15} color="var(--faint)" />}
            <span>{step.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// Heuristic labels to help scan long reasoning; they are pattern matches, not model annotations.
const MARKERS: { tag: "discarded" | "hypothesis" | "checkpoint"; pattern: RegExp }[] = [
  { tag: "discarded", pattern: /\b(actually|wait|scratch that|instead|rather than|won't work|doesn't work|reconsider|on second thought|that's wrong|not quite)\b/i },
  { tag: "hypothesis", pattern: /\b(hypothes\w*|I suspect|my guess|likely because|probably|might be (due|because)|could be (due|because))\b/i },
  { tag: "checkpoint", pattern: /^(\*\*.+\*\*|#+ .+)|\b(so the plan|the plan is|key insight|conclusion|therefore|in summary|next step|now I('ll| will)|first,|finally,)\b/i },
];

function classify(paragraph: string) {
  return MARKERS.find(marker => marker.pattern.test(paragraph))?.tag;
}

export function ThinkingBlock({ item, usage }: { item: Extract<TimelineItem, { kind: "thinking" }>; usage?: TurnUsage }) {
  const [open, setOpen] = useState(true);
  const now = useNow(!item.done);
  const elapsed = item.done ? item.ms ?? 0 : now - new Date(item.ts).getTime();
  const paragraphs = useMemo(() => item.text.split(/\n{2,}/).filter(Boolean), [item.text]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!item.done && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [item.text, item.done]);
  return (
    <div className="tl thinking">
      <button type="button" className="tl-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <Brain size={15} />
        <span className="title">{item.done ? "Thought" : "Thinking"}</span>
        <span className="sub">
          {item.done ? `for ${formatDuration(elapsed)}` : `${formatDuration(elapsed)} · streaming`}
          {usage ? ` · ${formatTokens(usage.thinkingTokens)} thinking tokens` : ""}
        </span>
        {!item.done && <Loader2 size={13} className="spin faint" />}
        {open ? <ChevronDown size={14} className="faint" /> : <ChevronRight size={14} className="faint" />}
      </button>
      {open && (
        <div className="tl-body thinking-text" ref={scroller}>
          {paragraphs.length === 0 && <span className="faint">{item.done ? "The provider returned no readable thinking for this block (thinking display is omitted for this model)." : "Waiting for reasoning tokens…"}</span>}
          {paragraphs.map((paragraph, index) => {
            const tag = classify(paragraph);
            return (
              <p key={index} className={`thinking-para ${tag ?? ""}`}>
                {tag && <span className={`thinking-tag ${tag}`}>{tag}</span>}
                {paragraph}
              </p>
            );
          })}
          {!item.done && <span className="caret" />}
        </div>
      )}
    </div>
  );
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  run_command: SquareTerminal, verify: ShieldCheck, read_file: FileSearch, write_file: FilePen, edit_file: FilePen, delete_file: Trash2,
  list_files: FolderTree, search_files: Search, web_fetch: Globe, delegate_research: Bot, research_agent: Bot, update_plan: ListChecks,
  browse: Globe, deploy_preview: Rocket, browser_click: Globe, browser_type: Globe, browser_scroll: Globe, browser_extract: Globe, browser_screenshot: Globe, browser_close: Globe, attach_files: Paperclip,
  github_list_repos: GitBranch, github_get_repo: GitBranch, github_clone_to_workspace: GitBranch, github_commit_and_push: GitBranch, github_create_pr: GitBranch,
};

function toolSubtitle(item: Extract<TimelineItem, { kind: "tool" }>) {
  const input = item.input ?? {};
  const value = input.command ?? input.path ?? input.url ?? input.pattern ?? input.task ?? input.repo ?? input.message ?? input.title ?? (item.name === "deploy_preview" && typeof input.kind === "string" ? `${input.kind} preview` : undefined);
  if (typeof value === "string") return value;
  if (item.name === "update_plan" && Array.isArray(input.steps)) return `${input.steps.length} steps`;
  const partial = partialField(item.inputPartial, ["command", "path", "url", "pattern"]);
  return partial ?? "";
}

/** Best-effort extraction of a string field from streaming (incomplete) tool-input JSON. */
function partialField(partial: string, keys: string[]) {
  for (const key of keys) {
    const match = partial.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "s"));
    if (!match) continue;
    let raw = match[1];
    if (raw.endsWith("\\")) raw = raw.slice(0, -1);
    try { return JSON.parse(`"${raw}"`) as string; } catch { return raw; }
  }
  return null;
}

function Terminal({ command, segments, result, live }: { command?: string; segments: { stream: string; text: string }[]; result?: { exitCode?: number | null; durationMs: number; ok: boolean }; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [segments]);
  return (
    <div className="terminal" ref={ref}>
      {command && <div className="cmd">{command}</div>}
      {segments.map((segment, index) => <span key={index} className={segment.stream === "stderr" ? "stderr" : ""}>{segment.text}</span>)}
      {live && <span className="caret" />}
      {result && <span className={`exit${result.ok ? "" : " bad"}`}>{result.exitCode !== undefined && result.exitCode !== null ? `exit ${result.exitCode}` : result.ok ? "ok" : "failed"} · {formatDuration(result.durationMs)}</span>}
    </div>
  );
}

export function ToolCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const isShell = ["run_command", "verify", "research", "research_agent", "delegate_research", "browse", "deploy_preview", "github_clone_to_workspace", "github_commit_and_push"].includes(item.name);
  const isWrite = item.name === "write_file" || item.name === "edit_file" || item.name === "delete_file";
  const running = !item.result;
  const [open, setOpen] = useState(isShell || isWrite);
  const Icon = TOOL_ICONS[item.name] ?? Wrench;
  const subtitle = toolSubtitle(item);
  const liveCode = running && item.name === "write_file" ? partialField(item.inputPartial, ["content"]) : running && item.name === "edit_file" ? partialField(item.inputPartial, ["new_string"]) : null;
  const elapsedNow = useNow(running);
  const elapsed = item.result ? item.result.durationMs : elapsedNow - new Date(item.ts).getTime();

  return (
    <div className={`tl tool${item.result && !item.result.ok ? " failed" : ""}`}>
      <button type="button" className="tl-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <Icon size={15} className="tool-icon" />
        <span className="title mono" style={{ fontSize: 12 }}>{item.name}</span>
        <span className="sub mono" title={subtitle}>{subtitle}</span>
        {item.result && <span className={`chip ${item.result.ok ? "mint" : "red"}`}>{item.result.summary}</span>}
        <span className="time">{formatDuration(Math.max(0, elapsed))}</span>
        {running ? <Loader2 size={13} className="spin faint" /> : item.result?.ok ? <Check size={14} color="var(--mint)" /> : <X size={14} color="var(--red)" />}
      </button>
      {open && (
        <div className="tl-body">
          {isShell && <Terminal command={typeof item.input?.command === "string" ? item.input.command : undefined} segments={item.output} result={item.result} live={running && Boolean(item.input)} />}
          {liveCode !== null && (
            <div className="terminal" style={{ color: "var(--add-fg)" }}>
              <div className="faint" style={{ marginBottom: 6 }}>⟶ synthesizing {partialField(item.inputPartial, ["path"]) ?? "file"}…</div>
              {liveCode}<span className="caret" />
            </div>
          )}
          {item.changes.map((change, index) => <div key={index} style={{ padding: 8 }}><DiffViewer change={change} /></div>)}
          {!isShell && !item.changes.length && liveCode === null && (
            <div className="kv">{item.input ? JSON.stringify(item.input, null, 2) : item.inputPartial || "…"}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function TimelineEntry({ item, usageByTurn, browsers }: { item: TimelineItem; usageByTurn: Map<number, TurnUsage>; browsers?: Record<string, BrowserState> }) {
  switch (item.kind) {
    case "browser":
      return browsers?.[item.id] ? <LiveBrowser browser={browsers[item.id]} compact /> : null;
    case "attachments":
      return <Attachments files={item.files} auto={item.auto} more={item.more} skipped={item.skipped} />;
    case "thinking":
      return <ThinkingBlock item={item} usage={usageByTurn.get(item.turn)} />;
    case "tool":
      return <ToolCard item={item} />;
    case "dispatch":
      return (
        <div className="tl dispatch">
          <div className="tl-head"><Route size={15} color="var(--violet)" /><span className="title" style={{ fontSize: 12.5 }}>{getModel(item.model)?.label ?? item.model}</span><span className="sub">{item.reason}</span></div>
        </div>
      );
    case "verify": {
      const passed = item.results.filter(result => result.ok).length;
      const failed = item.results.some(result => !result.ok);
      return (
        <div className="tl verify">
          <div className="tl-head">
            <ShieldCheck size={15} color={failed ? "var(--red)" : "var(--mint)"} />
            <span className="title">Verification pass {item.iteration}</span>
            <span className="sub">{item.commands.length} check{item.commands.length === 1 ? "" : "s"} · {passed} passed{failed ? " · failure detected" : ""}</span>
          </div>
        </div>
      );
    }
    case "recovery":
      return (
        <div className="tl heal" title={`${item.failure} · attempt ${item.attempt}`}>
          <div className="tl-head"><RefreshCw size={15} color="var(--amber)" /><span className="title">Self-healing</span><span className="sub" style={{ whiteSpace: "normal" }}>{item.detail} → {item.action}</span></div>
        </div>
      );
    case "heal":
      return (
        <div className="tl heal">
          <div className="tl-head"><Wrench size={15} color="var(--amber)" /><span className="title">Self-healing iteration {item.iteration}</span><span className="sub">{item.reason} → sending the stack trace back to {item.model}</span></div>
        </div>
      );
    case "external":
      return (
        <div className="tl">
          <div className="tl-head">
            <Bot size={15} color="var(--amber)" />
            <span className="title">Research Agent · {item.status}</span>
            <span className="sub">{item.detail}</span>
          </div>
        </div>
      );
    case "repo":
      return (
        <div className="tl" style={{ borderColor: "var(--violet-line)" }}>
          <div className="tl-head">
            <GitBranch size={15} color="var(--violet)" />
            <span className="title">{item.label}</span>
            <span className="sub mono">{item.detail}</span>
            <a className="icon-btn sm" href={item.url} target="_blank" rel="noreferrer" title="Open on GitHub"><ExternalLink size={13} /></a>
          </div>
        </div>
      );
    case "media":
      return (
        <figure className="tl media">
          <a href={item.src} target="_blank" rel="noreferrer" title="Open full size">
            {item.mimeType.startsWith("image/") ? <img src={item.src} alt={item.caption} loading="lazy" /> : <span className="chip">{item.filename}</span>}
          </a>
          <figcaption><Globe size={12} /> {item.caption}{item.mediaId ? " · Curialy Vault" : ""}</figcaption>
        </figure>
      );
    case "notice":
      return (
        <div className={`tl notice ${item.level}`}>
          <div className="tl-head"><AlertTriangle size={15} color={item.level === "error" ? "var(--red)" : item.level === "warn" ? "var(--amber)" : "var(--muted)"} /><span className="sub" style={{ whiteSpace: "normal", color: "var(--text-2)" }}>{item.message}</span></div>
        </div>
      );
    default:
      return null;
  }
}
