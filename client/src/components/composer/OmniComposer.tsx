import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, ChevronDown, Globe, Loader2, MessageSquare, Paperclip, Sparkles, Users, X } from "lucide-react";
import { aliasEffort, effortApplies, getModel, PICKER_MODELS, REPLACED, teamCapable, type CreateTaskRequest, type TaskMode, type ThinkingLevel } from "@shared/agent";
import { type GitHubRepo } from "@/lib/api";
import { AttachmentTray, useAttachments } from "@/lib/useAttachments";
import { RepoSelector } from "@/components/RepoSelector";
import { useGitHub } from "@/components/shell/AppShell";

type Prefs = { model: string; mode: TaskMode; effort: ThinkingLevel; webSearch: boolean; team: boolean };
const PREFS_KEY = "curialy.composer.v2";
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

export function ModelPicker({ value, onChange, mode, team = false, openDown = false }: { value: string; onChange: (id: string) => void; mode: TaskMode; team?: boolean; openDown?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = getModel(value);
  return (
    <div className="model-picker" ref={ref}>
      <button type="button" className="model-trigger" onClick={() => setOpen(value => !value)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="dot" style={{ background: "var(--violet)" }} />
        <span className="truncate">{current ? current.label : "Auto"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`model-menu${openDown ? " down" : ""}`} role="listbox">
          <button type="button" role="option" aria-selected={value === "auto"} className={`model-option plain${value === "auto" ? " on" : ""}`} onClick={() => { onChange("auto"); setOpen(false); }}>
            <strong>Auto</strong>
            {value === "auto" && <Check size={14} style={{ marginLeft: "auto" }} />}
          </button>
          <div className="model-sep" />
          {PICKER_MODELS.map(model => {
            const unusable = mode === "agent" && (!model.tools || (team && !teamCapable(model)));
            return (
              <button key={model.id} type="button" role="option" aria-selected={value === model.id} disabled={unusable} title={unusable ? (model.tools ? "Not available in Dev Team mode" : "Chat mode only") : undefined} className={`model-option plain${value === model.id ? " on" : ""}`} onClick={() => { onChange(model.id); setOpen(false); }}>
                <strong>{model.label}</strong>
                {value === model.id && <Check size={14} style={{ marginLeft: "auto", flex: "0 0 auto" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OmniComposer({ onSubmit, busy, autoFocus, seed }: { onSubmit: (request: CreateTaskRequest) => Promise<void>; busy: boolean; autoFocus?: boolean; seed?: { text: string; nonce: number } }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [prompt, setPrompt] = useState("");
  const attachments = useAttachments();
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const { status: github } = useGitHub();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }, [prefs]);
  useEffect(() => {
    if (!seed) return;
    setPrompt(seed.text);
    textarea.current?.focus();
  }, [seed]);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(320, element.scrollHeight)}px`;
  }, [prompt]);

  const update = (patch: Partial<Prefs>) => setPrefs(current => {
    const next = { ...current, ...patch };
    const spec = getModel(next.model);
    if (next.mode === "agent" && spec && (!spec.tools || (next.team && !teamCapable(spec)))) next.model = "auto";
    return next;
  });

  const submit = async () => {
    const text = prompt.trim();
    if (text.length < 2 || busy || attachments.uploading) return;
    const sent = attachments.ids;
    setError(null);
    try {
      await onSubmit({ prompt: text, model: prefs.model, mode: prefs.mode, effort: prefs.effort, webSearch: prefs.webSearch && webApplies, team: prefs.mode === "agent" && prefs.team, attachmentIds: sent, repo: prefs.mode === "agent" ? repo?.full_name ?? null : null, repoBranch: prefs.mode === "agent" ? repo?.default_branch ?? null : null });
      setPrompt("");
      attachments.clear(sent);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not start the task.");
    }
  };

  const spec = getModel(prefs.model);
  const showEffort = prefs.model === "auto" || Boolean(spec && effortApplies(spec));
  const webApplies = prefs.model === "auto" || Boolean(spec?.tools);

  return (
    <div>
      <div className={`composer${attachments.dragging ? " dragging" : ""}`} {...attachments.dropProps}>
        <label className="sr-only" htmlFor="omni-prompt">Task</label>
        <textarea
          id="omni-prompt"
          ref={textarea}
          value={prompt}
          autoFocus={autoFocus}
          placeholder={prefs.mode === "agent" ? (repo ? `Work on ${repo.full_name}: e.g. "Refactor the auth middleware and open a PR"…` : "Describe what to build, fix or refactor, or name one of your repos (\"check my easyeps repo\")…") : "Ask anything. Toggle Web Search to let the model fetch pages…"}
          onChange={event => setPrompt(event.target.value)}
          onPaste={attachments.onPaste}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <AttachmentTray files={attachments.files} uploading={attachments.uploading} onRemove={attachments.remove} />
        <div className="composer-bar">
          <ModelPicker value={prefs.model} mode={prefs.mode} team={prefs.mode === "agent" && prefs.team} onChange={model => update({ model })} />
          {github?.connected && prefs.mode === "agent" && <RepoSelector value={repo?.full_name ?? null} onChange={setRepo} />}
          <div className="segmented" role="radiogroup" aria-label="Mode">
            <button type="button" className={prefs.mode === "agent" ? "on" : ""} onClick={() => update({ mode: "agent" })} title="Autonomous coding agent with tools"><Bot size={12} style={{ verticalAlign: -2 }} /> Agent</button>
            <button type="button" className={prefs.mode === "chat" ? "on" : ""} onClick={() => update({ mode: "chat" })} title="Conversational answer"><MessageSquare size={12} style={{ verticalAlign: -2 }} /> Chat</button>
          </div>
          <span className="divider" />
          <div className="segmented" role="radiogroup" aria-label="Adaptive thinking level" title={showEffort ? "Thinking level" : `${spec?.label} does not take a thinking level`}>
            {(["low", "medium", "high"] as const).map(level => (
              <button key={level} type="button" disabled={!showEffort} className={prefs.effort === level ? "on" : ""} onClick={() => update({ effort: level })}>
                {level === "high" && <Sparkles size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}
                {level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          {prefs.mode === "agent" && (
            <button type="button" className={`toggle${prefs.team ? " on" : ""}`} onClick={() => update({ team: !prefs.team })} aria-pressed={prefs.team} title="Dev Team: an Architect plans, an Engineer builds, a Reviewer reviews and tests, with fix rounds until approved">
              <Users size={14} /> Dev Team
            </button>
          )}
          <button type="button" className={`toggle${prefs.webSearch && webApplies ? " on" : ""}`} disabled={!webApplies} onClick={() => update({ webSearch: !prefs.webSearch })} aria-pressed={prefs.webSearch && webApplies} title={webApplies ? "Let the agent fetch pages, use the Live Browser and the Research Agent" : `${spec?.label} cannot fetch pages`}>
            <Globe size={14} /> Web
          </button>
          <button type="button" className="toggle" onClick={attachments.open} disabled={attachments.full} title="Attach files, or paste / drop screenshots into the box">
            <Paperclip size={14} /> Attach
          </button>
          {attachments.picker}
          <span className="composer-hint"><span className="kbd">Enter</span> to run · <span className="kbd">Shift+Enter</span> newline</span>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy || attachments.uploading > 0 || prompt.trim().length < 2} aria-label="Start task">
            {busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />} Run
          </button>
        </div>
      </div>
      {(error || attachments.error) && <div className="alert error" style={{ marginTop: 10 }}>{error ?? attachments.error}</div>}
    </div>
  );
}
