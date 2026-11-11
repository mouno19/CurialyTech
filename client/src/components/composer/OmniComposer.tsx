import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, Bot, Check, ChevronDown, CloudOff, Globe, Info, MessageSquare, Paperclip, RotateCcw, SlidersHorizontal, Sparkles, TriangleAlert, Users, X } from "lucide-react";
import { aliasEffort, effortApplies, getModel, outputLimit, PICKER_MODELS, REPLACED, teamCapable, type CreateTaskRequest, type ModelSpec, type TaskMode, type ThinkingLevel } from "@shared/agent";
import { formatTokenCount, modelLimits } from "@shared/billing";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { IconButton } from "@/components/common/IconButton";
import { Tip } from "@/components/common/Tooltip";
import { POPOVER_COLLISION, RepoSelector } from "@/components/RepoSelector";
import { errorMessage, type GitHubRepo, type ProviderProbe } from "@/lib/api";
import { useGitHub, useHealth } from "@/lib/appStatus";
import { MQ, useMediaQuery } from "@/lib/breakpoints";
import { mediaHealth, useMediaHealth } from "@/lib/mediaHealth";
import { useCountdown } from "@/components/common/useCountdown";
import { Spinner } from "@/components/common/Spinner";
import { TypingText } from "@/components/common/TypingText";
import { usePresence, useTypewriter } from "@/lib/motion";
import { AttachmentTray, MAX_ATTACHMENTS, useAttachments } from "@/lib/useAttachments";
import { insertAtCursor } from "@/lib/insertText";
import { DictationButton } from "./DictationButton";
import { readAttachedSkills, SkillPicker, writeAttachedSkills } from "./SkillPicker";
// The unsent prompt survives a reload, the GitHub sign-in round trip and a hand-off from the homepage.
import { PREFS_KEY, readDraft, writeDraft } from "@/lib/composerDraft";

type Prefs = { model: string; mode: TaskMode; effort: ThinkingLevel; webSearch: boolean; team: boolean };
const DEFAULT_PREFS: Prefs = { model: "auto", mode: "agent", effort: "medium", webSearch: false, team: false };

function readPrefs(): Prefs {
  let prefs = DEFAULT_PREFS;
  try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { /* storage unavailable */ }
  if (prefs.model === "auto") return prefs;
  // Saved ids from older catalogs: aliases resolve to their entry (keeping the level they implied),
  // retired entries to their replacement, anything else to Auto.
  const saved = getModel(REPLACED[prefs.model] ?? prefs.model);
  if (!saved || saved.hidden) return { ...prefs, model: "auto" };
  // Saved elsewhere (e.g. a homepage hand-off into Dev Team): the model must suit the mode, as update() ensures.
  if (prefs.mode === "agent" && (!saved.tools || (prefs.team && !teamCapable(saved)))) return { ...prefs, model: "auto" };
  return { ...prefs, model: saved.id, effort: aliasEffort(prefs.model) ?? prefs.effort };
}


// ---- Model picker ----

const FAMILIES: { label: string; match: RegExp }[] = [
  { label: "Claude", match: /^claude-/ },
  { label: "OpenAI", match: /^openai-/ },
  { label: "Gemini", match: /gemini/ },
  { label: "Grok", match: /^grok-/ },
  { label: "Open models", match: /^(kimi|glm|llama|mistral)/ },
];
const OTHER_FAMILY = "More models";

const MODEL_FAMILIES = (() => {
  const groups = new Map<string, ModelSpec[]>();
  for (const label of [...FAMILIES.map(family => family.label), OTHER_FAMILY]) groups.set(label, []);
  for (const model of PICKER_MODELS) groups.get(FAMILIES.find(family => family.match.test(model.id))?.label ?? OTHER_FAMILY)!.push(model);
  return Array.from(groups, ([label, models]) => ({ label, models })).filter(group => group.models.length > 0);
})();

// Routes that need their own credentials; the server rejects a model whose route is not set up.
const ROUTE_PROBE: Partial<Record<ModelSpec["provider"], string>> = { relay: "relay", fast: "fast" };

/** Why this model can't be picked right now (shown as visible hint text), or null. */
function modelBlocked(spec: ModelSpec, mode: TaskMode, team: boolean, probes: ProviderProbe[] | null): string | null {
  if (mode === "agent" && !spec.tools) return "Chat mode only";
  if (mode === "agent" && team && !teamCapable(spec)) return "Can't join a Dev Team";
  const probeId = ROUTE_PROBE[spec.provider];
  const probe = probeId ? probes?.find(item => item.id === probeId) : undefined;
  if (probe && !probe.configured) return "Not set up on this server";
  return null;
}

const modelNote = (spec: ModelSpec) => (spec.provider === "core-sql" ? "Answers arrive all at once" : null);

/**
 * "1M context · 64K output", from the operator's list of model limits (null when it has none). The
 * output is what one reply may really use here: the listed limit, or the route's when that is lower.
 */
function limitsNote(spec: ModelSpec) {
  const limits = modelLimits(spec.id);
  return limits ? `${formatTokenCount(limits.contextWindow)} context · ${formatTokenCount(Math.min(limits.maxOutput, outputLimit(spec)))} output` : null;
}

/** Model menu: Radix DropdownMenu in a portal, menuitemradio items grouped by family. */
export function ModelPicker({ value, onChange, mode, team = false, auto = true, blocked, label: name = "Model" }: {
  value: string; onChange: (id: string) => void; mode: TaskMode; team?: boolean;
  /** Offer Auto (a new task); a follow-up continues on a named model. */
  auto?: boolean;
  /** Another reason a model can't be picked here (shown as its hint), e.g. a follow-up's conversation format. */
  blocked?: (spec: ModelSpec) => string | null;
  /** What the trigger is called for screen readers and its tooltip. */
  label?: string;
  /** Ignored (kept for older callers). */ openDown?: boolean;
}) {
  const { providers } = useHealth();
  const label = (value !== "auto" && getModel(value)?.label) || (auto ? "Auto" : value);
  return (
    <DropdownMenu.Root>
      <Tip content={`${name}: ${label}`}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="pick-trigger omni-model" aria-label={`${name}: ${label}`}>
            <span className="omni-model-spark" aria-hidden="true" />
            <span className="pick-label">{label}</span>
            <ChevronDown size={14} className="pick-chevron" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu omni-model-menu" side="bottom" align="start" sideOffset={6} collisionPadding={POPOVER_COLLISION} loop>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {auto && (
              <DropdownMenu.RadioItem value="auto" className="menu-item" textValue="Auto">
                <Sparkles size={15} aria-hidden="true" />
                <span className="menu-item-body">
                  <span>Auto</span>
                  <span className="menu-item-hint">Picks a model to match each task</span>
                </span>
                <DropdownMenu.ItemIndicator className="menu-item-end"><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            )}
            {MODEL_FAMILIES.map((group, index) => (
              <ModelFamily key={group.label} label={group.label} models={group.models} mode={mode} team={team} probes={providers} blocked={blocked} separator={auto || index > 0} />
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ModelFamily({ label, models, mode, team, probes, blocked: extra, separator = true }: { label: string; models: ModelSpec[]; mode: TaskMode; team: boolean; probes: ProviderProbe[] | null; blocked?: (spec: ModelSpec) => string | null; separator?: boolean }) {
  const id = useId();
  return (
    <Fragment>
      {separator && <DropdownMenu.Separator className="menu-sep" />}
      <DropdownMenu.Group aria-labelledby={id}>
        <DropdownMenu.Label id={id} className="menu-label">{label}</DropdownMenu.Label>
        {models.map(spec => {
          const blocked = modelBlocked(spec, mode, team, probes) ?? extra?.(spec) ?? null;
          const hint = [blocked ?? modelNote(spec), limitsNote(spec)].filter(Boolean).join(" · ") || null;
          return (
            <DropdownMenu.RadioItem key={spec.id} value={spec.id} disabled={Boolean(blocked)} className="menu-item" textValue={spec.label}>
              <span className="menu-item-body">
                <span>{spec.label}</span>
                {hint && <span className="menu-item-hint">{hint}</span>}
              </span>
              <DropdownMenu.ItemIndicator className="menu-item-end"><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          );
        })}
      </DropdownMenu.Group>
    </Fragment>
  );
}

// ---- Mode, thinking level, toggles ----

function ModeSwitch({ value, onChange }: { value: TaskMode; onChange: (mode: TaskMode) => void }) {
  return (
    <RadioGroup.Root className="segmented omni-mode" aria-label="Mode" value={value} onValueChange={next => onChange(next as TaskMode)} orientation="horizontal" loop>
      <Tip content="Works in its own workspace: files, a terminal, checks and tests">
        <RadioGroup.Item value="agent"><Bot size={14} aria-hidden="true" />Agent</RadioGroup.Item>
      </Tip>
      <Tip content="A conversational answer, without a workspace">
        <RadioGroup.Item value="chat"><MessageSquare size={14} aria-hidden="true" />Chat</RadioGroup.Item>
      </Tip>
    </RadioGroup.Root>
  );
}

const LEVELS: { id: ThinkingLevel; label: string; icon?: LucideIcon }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High", icon: Sparkles },
];

function EffortRadios({ value, onChange, disabledReason, labelledBy, tip = true }: { value: ThinkingLevel; onChange: (level: ThinkingLevel) => void; disabledReason: string | null; labelledBy?: string; tip?: boolean }) {
  const descId = useId();
  const group = (
    <RadioGroup.Root
      className="segmented omni-effort"
      aria-label={labelledBy ? undefined : "Thinking level"}
      aria-labelledby={labelledBy}
      aria-describedby={disabledReason ? descId : undefined}
      value={value}
      onValueChange={next => onChange(next as ThinkingLevel)}
      disabled={Boolean(disabledReason)}
      orientation="horizontal"
      loop
    >
      {LEVELS.map(level => (
        <RadioGroup.Item key={level.id} value={level.id}>
          {level.icon && <level.icon size={13} aria-hidden="true" />}
          {level.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
  return (
    <>
      {tip ? <Tip content={disabledReason ?? "Thinking level: how long the model reasons before it acts"}>{group}</Tip> : group}
      {disabledReason && <span id={descId} className="sr-only">{disabledReason}</span>}
    </>
  );
}

function ToolToggle({ icon: Icon, label, pressed, onToggle, tip, blocked, onBlocked }: { icon: LucideIcon; label: string; pressed: boolean; onToggle: () => void; tip: string; blocked: string | null; onBlocked?: (reason: string) => void }) {
  return (
    <Tip content={blocked ?? tip}>
      <button
        type="button"
        className="toggle"
        aria-label={label}
        aria-pressed={blocked ? false : pressed}
        aria-disabled={blocked ? true : undefined}
        // A tap on a blocked toggle says why (tooltips never show on touch screens).
        onClick={() => (blocked ? onBlocked?.(`${blocked}.`) : onToggle())}
      >
        <Icon size={14} aria-hidden="true" />
        <span className="toggle-label">{label}</span>
      </button>
    </Tip>
  );
}

function SwitchRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="omni-opt omni-switch-row" data-disabled={disabled || undefined}>
      <div className="omni-opt-text">
        <label className="omni-opt-title" htmlFor={id}>{label}</label>
        <p className="field-hint" id={`${id}-hint`}>{description}</p>
      </div>
      <Switch.Root className="switch" id={id} checked={checked} disabled={disabled} aria-describedby={`${id}-hint`} onCheckedChange={onChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}

/** Narrow composers (<= 440px): thinking level, Dev Team and Web move into this popover. */
function OptionsPopover({ agent, effort, onEffort, effortReason, team, onTeam, web, onWeb, webReason }: {
  agent: boolean; effort: ThinkingLevel; onEffort: (level: ThinkingLevel) => void; effortReason: string | null;
  team: boolean; onTeam: (on: boolean) => void; web: boolean; onWeb: (on: boolean) => void; webReason: string | null;
}) {
  const effortLabel = useId();
  const on = (agent && team ? 1 : 0) + (web && !webReason ? 1 : 0);
  return (
    <Popover.Root>
      <Tip content="Thinking level, Dev Team and web access">
        <Popover.Trigger asChild>
          <button type="button" className="toggle omni-opts-trigger" aria-label={on ? `Options, ${on} on` : "Options"}>
            <SlidersHorizontal size={14} aria-hidden="true" />
            <span className="toggle-label">Options</span>
            {on > 0 && <span className="omni-opts-count" aria-hidden="true">{on}</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content className="popover omni-opts" side="bottom" align="start" sideOffset={8} collisionPadding={POPOVER_COLLISION} aria-label="Task options">
          <div className="omni-opt">
            <p className="omni-opt-title" id={effortLabel}>Thinking level</p>
            <EffortRadios value={effort} onChange={onEffort} disabledReason={effortReason} labelledBy={effortLabel} tip={false} />
            {effortReason && <p className="field-hint">{effortReason}.</p>}
          </div>
          {agent && <SwitchRow label="Dev Team" description="An Architect plans, an Engineer builds and a Reviewer tests, with fix rounds until the work is approved." checked={team} onChange={onTeam} />}
          <SwitchRow label="Web access" description={webReason ? `${webReason}.` : "Fetch pages and use the Live Browser and the Research Agent."} checked={web && !webReason} disabled={Boolean(webReason)} onChange={onWeb} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---- The composer ----

export type ComposerSeed = { text: string; nonce: number; mode?: TaskMode; team?: boolean };

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const STORAGE_NOTE = "File storage isn't available right now, so attachments are paused. You can still run the task without them.";

const hasFiles = (event: DragEvent | ClipboardEvent) =>
  "dataTransfer" in event ? Boolean(event.dataTransfer?.types.includes("Files")) : (event.clipboardData?.files.length ?? 0) > 0;

export function OmniComposer({ onSubmit, busy, autoFocus, seed, examples }: {
  onSubmit: (request: CreateTaskRequest) => Promise<void>;
  busy: boolean;
  /** Focus on arrival when a draft is waiting (otherwise the typing examples invite input). */
  autoFocus?: boolean;
  seed?: ComposerSeed;
  /** Example tasks the empty, unfocused composer types out (the reference's typewriter). */
  examples?: readonly string[];
}) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [prompt, setPrompt] = useState(readDraft);
  const [focused, setFocused] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [skillIds, setSkillIds] = useState(readAttachedSkills);
  const [skillsReady, setSkillsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const attachments = useAttachments();
  const github = useGitHub();
  const storage = useMediaHealth();
  const coarse = useMediaQuery(MQ.coarsePointer);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const ghost = Boolean(examples?.length) && !prompt && !focused && !busy;
  const typing = useTypewriter(examples ?? [], ghost);
  const starting = usePresence(busy);
  const [arrivedWithDraft] = useState(() => readDraft().trim().length > 0);
  // Dictation: spoken text lands where the cursor is (or at the end), separated by a space.
  const [dictationNote, setDictationNote] = useState("");
  // Where the cursor was when the box lost focus (pressing the microphone moves focus to it).
  const selection = useRef<{ start: number; end: number } | null>(null);
  const insertDictated = (text: string) => {
    const at = selection.current;
    setPrompt(current => insertAtCursor(current, text, at));
    selection.current = null;
    requestAnimationFrame(() => textarea.current?.focus({ preventScroll: true }));
  };
  const dictationMessage = (message: string, tone?: "error") => {
    setDictationNote(message);
    if (tone === "error") setNote(message);
  };

  // Ctrl+/ (⌘/ on a Mac) anywhere on the page starts typing here. A chord, not a bare "/": a
  // single-character shortcut would fire while dictating or reading (WCAG 2.1.4) and hide Quick Find.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || !(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[role='dialog'], [role='menu'], [role='listbox']")) return;
      event.preventDefault();
      textarea.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const agent = prefs.mode === "agent";
  const spec = prefs.model === "auto" ? undefined : getModel(prefs.model);
  const effortReason = !spec || effortApplies(spec) ? null : `${spec.label} uses a fixed thinking level`;
  const webReason = !spec || spec.tools ? null : `${spec.label} can't fetch pages`;
  const storageDown = storage.status === "unavailable";
  const attachBlocked = storageDown ? STORAGE_NOTE : attachments.full ? `Up to ${MAX_ATTACHMENTS} files per task.` : null;
  const text = prompt.trim();
  const runBlocked = busy ? null
    : attachments.uploading ? `Wait for ${attachments.uploading === 1 ? "the upload" : `${attachments.uploading} uploads`} to finish`
    : text.length < 2 ? "Describe the task first" : null;

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }, [prefs]);
  useEffect(() => {
    const timer = setTimeout(() => writeDraft(prompt), 250);
    return () => clearTimeout(timer);
  }, [prompt]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(320, element.scrollHeight)}px`;
  }, [prompt]);

  /** Apply a preference change; a model that can't serve the new mode falls back to Auto, and says so. */
  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    const current = getModel(next.model);
    let fallback: string | null = null;
    if (next.mode === "agent" && current && (!current.tools || (next.team && !teamCapable(current)))) {
      next.model = "auto";
      fallback = `${current.label} ${current.tools ? "can't join a Dev Team" : "can't work in Agent mode"}, so the model is now Auto.`;
    }
    setNote(fallback);
    setPrefs(next);
  };
  // The storage note is about a state that has passed once storage is back.
  useEffect(() => {
    if (!storageDown) setNote(current => (current === STORAGE_NOTE ? null : current));
  }, [storageDown]);

  useEffect(() => {
    if (skillsReady) writeAttachedSkills(skillIds);
  }, [skillIds, skillsReady]);

  useEffect(() => {
    if (!seed) return;
    setPrompt(seed.text);
    if ((seed.mode && seed.mode !== prefs.mode) || (seed.team !== undefined && seed.team !== prefs.team)) {
      update({ ...(seed.mode ? { mode: seed.mode } : {}), ...(seed.team !== undefined ? { team: seed.team } : {}) });
    }
    const element = textarea.current;
    if (!element) return;
    // The caller scrolls the composer into view (smoothly); focusing must not jump there first.
    element.focus({ preventScroll: true });
    requestAnimationFrame(() => element.setSelectionRange(element.value.length, element.value.length));
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy || runBlocked) return;
    const sent = attachments.ids;
    setError(null);
    setSubmitted(text);
    try {
      await onSubmit({
        prompt: text,
        model: prefs.model,
        mode: prefs.mode,
        effort: prefs.effort,
        webSearch: prefs.webSearch && !webReason,
        team: agent && prefs.team,
        attachmentIds: sent,
        repo: agent ? repo?.full_name ?? null : null,
        repoBranch: agent ? repo?.default_branch ?? null : null,
        ...(skillsReady ? { skillIds } : {}),
      });
      writeDraft("");
      setPrompt("");
      attachments.clear(sent);
    } catch (submitError) {
      setError(errorMessage(submitError, "Couldn't start the task. Try again."));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (event.shiftKey && !modifier) return;
    // On-screen keyboards have no easy Shift+Enter: there Enter is a new line and Run starts the task.
    if (coarse && !modifier) return;
    event.preventDefault();
    void submit();
  };

  // While storage is down, files are refused here (with the reason) instead of failing one upload at a time.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (storageDown && hasFiles(event) && !(event.clipboardData.getData("text/plain") ?? "").trim()) {
      event.preventDefault();
      setNote(attachBlocked);
      return;
    }
    attachments.onPaste(event);
  };
  const dropProps = storageDown
    ? {
        onDragOver: (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setNote(attachBlocked);
        },
      }
    : attachments.dropProps;

  const failure = error ?? attachments.error;
  const showRepo = agent && Boolean(github.status?.configured);
  const placeholder = agent
    ? repo ? `What should change in ${repo.full_name}?` : "Describe what to build, fix or refactor…"
    : "Ask anything…";
  const files = attachments.files.length;

  return (
    <div className="omni">
      <form className={cx("composer omni-composer", attachments.dragging && !storageDown && "dragging")} data-ghost={ghost || undefined} aria-busy={busy || undefined} onSubmit={event => { event.preventDefault(); void submit(); }} {...dropProps}>
        <div className="composer-head">
          <span className="eyebrow omni-eyebrow">
            <span className={cx("spark-dot", (busy || ghost) && "m-spark")} aria-hidden="true" />
            New task
          </span>
          {!coarse && <span className="omni-slash" aria-hidden="true"><kbd>{MAC ? "⌘" : "Ctrl"}</kbd>+<kbd>/</kbd> to type</span>}
          <ModeSwitch value={prefs.mode} onChange={mode => update({ mode })} />
        </div>
        <label className="sr-only" htmlFor="omni-prompt">Describe the task</label>
        <span id={hintId} className="sr-only">{coarse ? "Use the Run button to start the task." : "Press Enter to run the task, Shift+Enter for a new line."}</span>
        <div className="omni-field">
          <textarea
            id="omni-prompt"
            ref={textarea}
            className="composer-input"
            rows={3}
            value={prompt}
            autoFocus={autoFocus && !coarse && arrivedWithDraft}
            placeholder={placeholder}
            aria-describedby={hintId}
            onChange={event => setPrompt(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={event => {
              setFocused(false);
              selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
            }}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
          />
          {ghost && <div className="omni-ghost" aria-hidden="true"><TypingText text={typing} /></div>}
        </div>
        <AttachmentTray files={attachments.files} uploading={attachments.uploading} onRemove={attachments.remove} />
        <p className="sr-only" role="status">
          {attachments.uploading ? `Uploading ${attachments.uploading === 1 ? "a file" : `${attachments.uploading} files`}…` : files ? `${files} ${files === 1 ? "file" : "files"} attached` : ""}
        </p>
        <p className="sr-only" role="status">{dictationNote}</p>
        <div className="composer-bar">
          <div className="composer-tools">
            <ModelPicker value={prefs.model} mode={prefs.mode} team={agent && prefs.team} onChange={model => update({ model })} />
            {showRepo && <RepoSelector value={repo?.full_name ?? null} onChange={setRepo} className="omni-repo" />}
            <div className="composer-group omni-inline-opts">
              {effortReason ? (
                <Tip content={`${effortReason}.`}>
                  <span className="chip omni-fixed"><Sparkles size={12} aria-hidden="true" />Fixed thinking</span>
                </Tip>
              ) : (
                <EffortRadios value={prefs.effort} onChange={effort => update({ effort })} disabledReason={null} />
              )}
              {agent && (
                <ToolToggle icon={Users} label="Dev Team" pressed={prefs.team} onToggle={() => update({ team: !prefs.team })} blocked={null}
                  tip="Dev Team: an Architect plans, an Engineer builds and a Reviewer tests, with fix rounds until approved" />
              )}
              <ToolToggle icon={Globe} label="Web" pressed={prefs.webSearch} onToggle={() => update({ webSearch: !prefs.webSearch })} blocked={webReason} onBlocked={setNote}
                tip="Let the agent fetch pages and use the Live Browser and the Research Agent" />
            </div>
            <OptionsPopover
              agent={agent}
              effort={prefs.effort}
              onEffort={effort => update({ effort })}
              effortReason={effortReason}
              team={prefs.team}
              onTeam={team => update({ team })}
              web={prefs.webSearch}
              onWeb={webSearch => update({ webSearch })}
              webReason={webReason}
            />
            <SkillPicker selected={skillIds} onChange={setSkillIds} onReady={setSkillsReady} />
            <Tip content={attachBlocked ?? "Attach files, or paste or drop them into the box"}>
              <button type="button" className="toggle" aria-label="Attach files" aria-disabled={attachBlocked ? true : undefined} onClick={() => (attachBlocked ? setNote(attachBlocked) : attachments.open())}>
                {storageDown ? <CloudOff size={14} aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
                <span className="toggle-label">Attach</span>
              </button>
            </Tip>
            {attachments.picker}
            <DictationButton onText={insertDictated} onNote={dictationMessage} tip="Dictate: speak your task" />
          </div>
          <div className="composer-send">
            <span className="composer-hint" aria-hidden="true"><kbd>Enter</kbd> to run · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
            <Tip content={runBlocked ?? "Run task"}>
              <Button type="submit" variant="accent" pill className="omni-run" icon={ArrowUp} busy={busy} aria-disabled={runBlocked ? true : undefined}>
                <span className="omni-run-label">{busy ? "Starting…" : "Run"}</span>
                {!busy && <span className="sr-only"> task</span>}
              </Button>
            </Tip>
          </div>
        </div>
        {starting.mounted && (
          <div className="m-collapse omni-starting" data-open={starting.open || undefined}>
            <div>
              <div className="omni-starting-panel panel-ink">
                <p className="omni-starting-you"><span>you ›</span> {submitted}</p>
                <p className="omni-starting-step"><Spinner size={14} /> Creating the task…</p>
              </div>
            </div>
          </div>
        )}
      </form>
      {failure && (
        <div className="notice omni-message" data-tone="danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">{failure}</div>
          <IconButton size="sm" label="Dismiss" icon={X} tooltip={false} onClick={() => { setError(null); attachments.setError(null); }} />
        </div>
      )}
      {note && (
        <div className="notice omni-message" data-tone="neutral" role="status">
          <Info size={16} aria-hidden="true" />
          <div className="notice-body">{note}</div>
          {note === STORAGE_NOTE && <StorageRecheck />}
          <IconButton size="sm" label="Dismiss" icon={X} tooltip={false} onClick={() => setNote(null)} />
        </div>
      )}
    </div>
  );
}

/** "Check again" for file storage, enabled when the shared wait is over (one probe, no polling). */
function StorageRecheck() {
  const storage = useMediaHealth();
  const left = useCountdown(storage.status === "unavailable" ? storage.retryAt : null);
  if (storage.status !== "unavailable") return null;
  const waiting = left > 0;
  return (
    <Button size="sm" icon={RotateCcw} busy={storage.probing} disabled={waiting || storage.probing} onClick={() => void mediaHealth.retry()}>
      {waiting ? `Check again in ${left} s` : "Check again"}
    </Button>
  );
}
