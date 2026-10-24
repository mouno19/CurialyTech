import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, ChevronDown, Globe, Loader2, MessageSquare, Paperclip, Sparkles, X } from "lucide-react";
import { CAPABILITIES, getModel, MODELS, type CreateTaskRequest, type TaskMode, type ThinkingLevel } from "@shared/agent";
import { agentApi, type GitHubRepo, type UploadedFile } from "@/lib/api";
import { RepoSelector } from "@/components/RepoSelector";
import { useGitHub } from "@/components/shell/AppShell";

type Prefs = { model: string; mode: TaskMode; effort: ThinkingLevel; webSearch: boolean };
const PREFS_KEY = "curialy.composer.v2";
const DEFAULT_PREFS: Prefs = { model: "auto", mode: "agent", effort: "medium", webSearch: false };

function readPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; }
}

const GROUP_COLORS: Record<string, string> = { Core: "#7cb7ff", Relay: "#8b75ff", Fast: "#f6b3bd", Research: "#f2bd72", Gemini: "#52d6b1" };

export function ModelPicker({ value, onChange, mode, openDown = false }: { value: string; onChange: (id: string) => void; mode: TaskMode; openDown?: boolean }) {
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
        <span className="dot" style={{ background: current ? GROUP_COLORS[current.group] : "var(--violet)" }} />
        <span className="truncate">{current ? current.label : "Auto dispatch"}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`model-menu${openDown ? " down" : ""}`} role="listbox">
          <button type="button" className={`model-option${value === "auto" ? " on" : ""}`} onClick={() => { onChange("auto"); setOpen(false); }}>
            <span className="dot" style={{ background: "var(--violet)" }} />
            <span>
              <strong>Auto dispatch</strong>
              <small>Opus 5.5 for architecture & debugging, Sonnet 4.5 for routine edits, the Research Agent for browsing. Escalates to Opus when self-healing stalls.</small>
            </span>
            {value === "auto" && <Check size={14} style={{ marginLeft: "auto" }} />}
          </button>
          {CAPABILITIES.map(capability => (
            <div key={capability}>
              <div className="model-group">{capability}</div>
              {MODELS.filter(model => model.capability === capability).map(model => {
                const unusable = mode === "agent" && !model.tools && model.provider !== "research";
                return (
                  <button key={model.id} type="button" disabled={unusable} className={`model-option${value === model.id ? " on" : ""}`} onClick={() => { onChange(model.id); setOpen(false); }} title={unusable ? "Chat mode only (no tool calling)" : undefined}>
                    <span className="dot" style={{ background: GROUP_COLORS[model.group] }} />
                    <span style={{ minWidth: 0 }}>
                      <strong>{model.label}</strong>
                      <small>{model.description}</small>
                      <span className="caps">
                        {model.tools && <span>tools</span>}
                        {model.thinking !== "none" && <span>{model.thinking === "reasoning-content" ? "reasoning stream" : "thinking"}</span>}
                        {model.vision && <span>vision</span>}
                        {model.effort && <span>effort</span>}
                      </span>
                    </span>
                    {value === model.id && <Check size={14} style={{ marginLeft: "auto", flex: "0 0 auto" }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function OmniComposer({ onSubmit, busy, autoFocus, seed }: { onSubmit: (request: CreateTaskRequest) => Promise<void>; busy: boolean; autoFocus?: boolean; seed?: { text: string; nonce: number } }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const { status: github } = useGitHub();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    if (next.mode === "agent" && spec && !spec.tools && spec.provider !== "research") next.model = "auto";
    return next;
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    for (const file of Array.from(list).slice(0, 10 - files.length)) {
      setUploading(count => count + 1);
      try {
        const uploaded = await agentApi.upload(file);
        setFiles(current => [...current, uploaded]);
      } catch (uploadError) {
        setError(`${file.name}: ${uploadError instanceof Error ? uploadError.message : "upload failed"}`);
      } finally {
        setUploading(count => count - 1);
      }
    }
  };

  const submit = async () => {
    const text = prompt.trim();
    if (text.length < 2 || busy || uploading) return;
    setError(null);
    try {
      await onSubmit({ prompt: text, model: prefs.model, mode: prefs.mode, effort: prefs.effort, webSearch: prefs.webSearch, attachmentIds: files.map(file => file.id), repo: prefs.mode === "agent" ? repo?.full_name ?? null : null, repoBranch: prefs.mode === "agent" ? repo?.default_branch ?? null : null });
      setPrompt("");
      setFiles([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not start the task.");
    }
  };

  const spec = getModel(prefs.model);
  const effortApplies = prefs.model === "auto" || Boolean(spec?.effort);

  return (
    <div>
      <div className="composer">
        <label className="sr-only" htmlFor="omni-prompt">Task</label>
        <textarea
          id="omni-prompt"
          ref={textarea}
          value={prompt}
          autoFocus={autoFocus}
          placeholder={prefs.mode === "agent" ? (repo ? `Work on ${repo.full_name}: e.g. "Refactor the auth middleware and open a PR"…` : "Describe what to build, fix or refactor, or name one of your repos (\"check my easyeps repo\")…") : "Ask anything. Toggle Web Search to let the model fetch pages…"}
          onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {(files.length > 0 || uploading > 0) && (
          <div className="composer-attachments">
            {files.map(file => (
              <span key={file.id} className="chip">
                <Paperclip size={11} /> {file.filename}
                <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}><X size={11} /></button>
              </span>
            ))}
            {uploading > 0 && <span className="chip"><Loader2 size={11} className="spin" /> Uploading…</span>}
          </div>
        )}
        <div className="composer-bar">
          <ModelPicker value={prefs.model} mode={prefs.mode} onChange={model => update({ model })} />
          {github?.connected && prefs.mode === "agent" && <RepoSelector value={repo?.full_name ?? null} onChange={setRepo} />}
          <div className="segmented" role="radiogroup" aria-label="Mode">
            <button type="button" className={prefs.mode === "agent" ? "on" : ""} onClick={() => update({ mode: "agent" })} title="Autonomous coding agent with tools"><Bot size={12} style={{ verticalAlign: -2 }} /> Agent</button>
            <button type="button" className={prefs.mode === "chat" ? "on" : ""} onClick={() => update({ mode: "chat" })} title="Conversational answer"><MessageSquare size={12} style={{ verticalAlign: -2 }} /> Chat</button>
          </div>
          <span className="divider" />
          <div className="segmented" role="radiogroup" aria-label="Adaptive thinking level" title={effortApplies ? "Adaptive thinking effort" : `${spec?.label} does not take an effort level`}>
            {(["low", "medium", "high"] as const).map(level => (
              <button key={level} type="button" disabled={!effortApplies} className={prefs.effort === level ? "on" : ""} onClick={() => update({ effort: level })}>
                {level === "high" && <Sparkles size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}
                {level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className={`toggle${prefs.webSearch ? " on" : ""}`} onClick={() => update({ webSearch: !prefs.webSearch })} aria-pressed={prefs.webSearch} title="Let the agent fetch pages, use the Live Browser and the Research Agent">
            <Globe size={14} /> Web
          </button>
          <button type="button" className="toggle" onClick={() => fileInput.current?.click()} disabled={files.length >= 10} title="Attach files (copied into the task workspace)">
            <Paperclip size={14} /> Attach
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={event => { void addFiles(event.target.files); event.target.value = ""; }} />
          <span className="composer-hint"><span className="kbd">Enter</span> to run · <span className="kbd">Shift+Enter</span> newline</span>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy || uploading > 0 || prompt.trim().length < 2} aria-label="Start task">
            {busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />} Run
          </button>
        </div>
      </div>
      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
