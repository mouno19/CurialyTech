import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, Bot, Check, ChevronDown, CloudOff, Globe, Info, MessageSquare, Paperclip, RotateCcw, SlidersHorizontal, Sparkles, TriangleAlert, Users, X } from "lucide-react";
import { aliasEffort, effortApplies, getModel, PICKER_MODELS, REPLACED, teamCapable, type CreateTaskRequest, type ModelSpec, type TaskMode, type ThinkingLevel } from "@shared/agent";
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
import { AttachmentTray, MAX_ATTACHMENTS, useAttachments } from "@/lib/useAttachments";

type Prefs = { model: string; mode: TaskMode; effort: ThinkingLevel; webSearch: boolean; team: boolean };
const PREFS_KEY = "curialy.composer.v2";
const DRAFT_KEY = "curialy.composer.draft";
const DEFAULT_PREFS: Prefs = { model: "auto", mode: "agent", effort: "medium", webSearch: false, team: false };

function readPrefs(): Prefs {
  let prefs = DEFAULT_PREFS;
  try { prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { /* storage unavailable */ }
  if (prefs.model === "auto") return prefs;
  // Saved ids from older catalogs: aliases resolve to their entry (keeping the level they implied),
  // retired entries to their replacement, anything else to Auto.
  const saved = getModel(REPLACED[prefs.model] ?? prefs.model);
  if (!saved || saved.hidden) return { ...prefs, model: "auto" };
  return { ...prefs, model: saved.id, effort: aliasEffort(prefs.model) ?? prefs.effort };
}

// The unsent prompt survives a reload or the GitHub sign-in round trip (this tab only).
function readDraft() {
  try { return sessionStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; }
}
function writeDraft(text: string) {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* storage unavailable */ }
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

/** Model menu: Radix DropdownMenu in a portal, menuitemradio items grouped by family. */
export function ModelPicker({ value, onChange, mode, team = false }: { value: string; onChange: (id: string) => void; mode: TaskMode; team?: boolean; /** Ignored (kept for older callers). */ openDown?: boolean }) {
  const { providers } = useHealth();
  const label = (value !== "auto" && getModel(value)?.label) || "Auto";
  return (
    <DropdownMenu.Root>
      <Tip content={`Model: ${label}`}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="pick-trigger omni-model" aria-label={`Model: ${label}`}>
            <span className="omni-model-spark" aria-hidden="true" />
            <span className="pick-label">{label}</span>
            <ChevronDown size={14} className="pick-chevron" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu omni-model-menu" side="bottom" align="start" sideOffset={6} collisionPadding={POPOVER_COLLISION} loop>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            <DropdownMenu.RadioItem value="auto" className="menu-item" textValue="Auto">
              <Sparkles size={15} aria-hidden="true" />
              <span className="menu-item-body">
                <span>Auto</span>
                <span className="menu-item-hint">Picks a model to match each task</span>
              </span>
              <DropdownMenu.ItemIndicator className="menu-item-end"><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
            {MODEL_FAMILIES.map(group => (
              <ModelFamily key={group.label} label={group.label} models={group.models} mode={mode} team={team} probes={providers} />
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ModelFamily({ label, models, mode, team, probes }: { label: string; models: ModelSpec[]; mode: TaskMode; team: boolean; probes: ProviderProbe[] | null }) {
  const id = useId();
  return (
    <Fragment>
      <DropdownMenu.Separator className="menu-sep" />
      <DropdownMenu.Group aria-labelledby={id}>
        <DropdownMenu.Label id={id} className="menu-label">{label}</DropdownMenu.Label>
        {models.map(spec => {
          const blocked = modelBlocked(spec, mode, team, probes);
          const hint = blocked ?? modelNote(spec);
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

export type ComposerSeed = { text: string; nonce: number; mode?: TaskMode };

const STORAGE_NOTE = "File storage isn't available right now, so attachments are paused. You can still run the task without them.";

const hasFiles = (event: DragEvent | ClipboardEvent) =>
  "dataTransfer" in event ? Boolean(event.dataTransfer?.types.includes("Files")) : (event.clipboardData?.files.length ?? 0) > 0;

export function OmniComposer({ onSubmit, busy, autoFocus, seed }: { onSubmit: (request: CreateTaskRequest) => Promise<void>; busy: boolean; autoFocus?: boolean; seed?: ComposerSeed }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [prompt, setPrompt] = useState(readDraft);
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const attachments = useAttachments();
  const github = useGitHub();
  const storage = useMediaHealth();
  const coarse = useMediaQuery(MQ.coarsePointer);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

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
    if (!seed) return;
    setPrompt(seed.text);
    if (seed.mode && seed.mode !== prefs.mode) update({ mode: seed.mode });
    const element = textarea.current;
    if (!element) return;
    element.focus();
    requestAnimationFrame(() => element.setSelectionRange(element.value.length, element.value.length));
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (busy || runBlocked) return;
    const sent = attachments.ids;
    setError(null);
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
      <form className={cx("composer omni-composer", attachments.dragging && !storageDown && "dragging")} aria-busy={busy || undefined} onSubmit={event => { event.preventDefault(); void submit(); }} {...dropProps}>
        <div className="composer-head">
          <span className="eyebrow omni-eyebrow">
            <span className="spark-dot" data-live={busy ? "" : undefined} aria-hidden="true" />
            New task
          </span>
          <ModeSwitch value={prefs.mode} onChange={mode => update({ mode })} />
        </div>
        <label className="sr-only" htmlFor="omni-prompt">Describe the task</label>
        <span id={hintId} className="sr-only">{coarse ? "Use the Run button to start the task." : "Press Enter to run the task, Shift+Enter for a new line."}</span>
        <textarea
          id="omni-prompt"
          ref={textarea}
          className="composer-input"
          rows={3}
          value={prompt}
          autoFocus={autoFocus && !coarse}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={event => setPrompt(event.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
        />
        <AttachmentTray files={attachments.files} uploading={attachments.uploading} onRemove={attachments.remove} />
        <p className="sr-only" role="status">
          {attachments.uploading ? `Uploading ${attachments.uploading === 1 ? "a file" : `${attachments.uploading} files`}…` : files ? `${files} ${files === 1 ? "file" : "files"} attached` : ""}
        </p>
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
            <Tip content={attachBlocked ?? "Attach files, or paste or drop them into the box"}>
              <button type="button" className="toggle" aria-label="Attach files" aria-disabled={attachBlocked ? true : undefined} onClick={() => (attachBlocked ? setNote(attachBlocked) : attachments.open())}>
                {storageDown ? <CloudOff size={14} aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
                <span className="toggle-label">Attach</span>
              </button>
            </Tip>
            {attachments.picker}
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
