import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, Clock, ListPlus, Paperclip, Pencil, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import { followUpModelBlocked, getModel, MAX_QUEUED_MESSAGES, type AgentTaskSummary, type QueuedMessage, type TaskQueue, type TaskStatus } from "@shared/agent";
import { isActiveStatus } from "@shared/taskStatus";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { DictationButton } from "@/components/composer/DictationButton";
import { SkillPicker } from "@/components/composer/SkillPicker";
import { ModelPicker } from "@/components/composer/OmniComposer";
import { RepoSelector } from "@/components/RepoSelector";
import { errorMessage, type GitHubRepo } from "@/lib/api";
import { useGitHub } from "@/lib/appStatus";
import { insertAtCursor } from "@/lib/insertText";
import { AttachmentTray, useAttachments, type PendingAttachment } from "@/lib/useAttachments";

const PLACEHOLDER: Record<TaskStatus, string> = {
  queued: "Waiting to start. A message sent now runs after this run…",
  running: "Working. Send a follow-up now and it runs when this run finishes…",
  cancelling: "Stopping… A message sent now waits until you start it.",
  completed: "Ask for changes, fixes or explanations (paste or drop screenshots)…",
  failed: "Describe what to change and send, or use Retry to run it again…",
  cancelled: "Send new instructions to continue, or use Retry…",
  interrupted: "Send a follow-up to continue from here, or use Retry…",
};

/** After a Deploy run the way to try again is a new deploy (a retry can't deploy). */
const REDEPLOY: Partial<Record<TaskStatus, string>> = {
  failed: "Describe what to change and send, or use Deploy again…",
  cancelled: "Send new instructions to continue, or use Deploy again…",
  interrupted: "Send a follow-up to continue from here, or use Deploy again…",
};

/**
 * What the next message asks for besides its text: null keeps the task's model, or its repository.
 * replaceRepo: the task has another repository and the message switches it to `repo`.
 */
export type FollowUpChoice = { model: string | null; repo: GitHubRepo | null; replaceRepo: boolean; /** set when this message changes the task's skills, including clearing them */ skillIds?: string[] };

export type QueueActions = {
  edit: (itemId: string, prompt: string) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  retry: (itemId: string) => Promise<void>;
  /** Start the next waiting message now (a queue held after a stop). */
  runNext: () => Promise<void>;
};

// The unsent follow-up survives a reload (per task, this tab only).
const draftKey = (taskId: string) => `curialy.followup.${taskId}`;
function readDraft(taskId: string) {
  try { return sessionStorage.getItem(draftKey(taskId)) ?? ""; } catch { return ""; }
}
function writeDraft(taskId: string, text: string) {
  try {
    if (text) sessionStorage.setItem(draftKey(taskId), text);
    else sessionStorage.removeItem(draftKey(taskId));
  } catch { /* storage unavailable */ }
}

/**
 * The follow-up bar. While a run is active a message is queued instead of sent: it starts by
 * itself when the run ends (or, after a stop, when the user starts it), and waits in the list
 * above the box, where it can be edited or removed until then. The model, a repository (linked,
 * or switched to) and dictation are available at any time. The text clears at once and comes back
 * if the send fails.
 */
export function FollowUpComposer({ taskId, task, status, onSend, redeploy = false, queue, queueActions }: {
  taskId: string;
  task: AgentTaskSummary | null;
  status: TaskStatus | null;
  onSend: (text: string, attachments: PendingAttachment[], choice: FollowUpChoice) => Promise<void>;
  redeploy?: boolean;
  queue: TaskQueue | null;
  queueActions: QueueActions;
}) {
  const [text, setText] = useState(() => readDraft(taskId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [skillIds, setSkillIds] = useState<string[]>(task?.skillIds ?? []);
  const [skillsReady, setSkillsReady] = useState(false);
  const attachedKey = (task?.skillIds ?? []).join(",");
  useEffect(() => { setSkillIds(task?.skillIds ?? []); }, [task?.id, attachedKey]);
  const attachments = useAttachments();
  const { status: github } = useGitHub();
  const input = useRef<HTMLTextAreaElement>(null);
  // Where the cursor was when the box lost focus (the microphone takes the focus).
  const selection = useRef<{ start: number; end: number } | null>(null);
  const active = isActiveStatus(status);
  // A message queued while the run is stopping waits for the user (the queue holds after a stop).
  const stopping = status === "cancelling";
  const items = queue?.items ?? [];
  const full = active && items.length >= MAX_QUEUED_MESSAGES;
  const blocked = !status ? "Loading the task…" : full ? `Up to ${MAX_QUEUED_MESSAGES} messages can wait` : null;
  const empty = !text.trim() && attachments.files.length === 0;
  const canSend = !blocked && !sending && attachments.uploading === 0 && !empty;
  const shownError = error ?? dictationError ?? attachments.error;

  useEffect(() => writeDraft(taskId, text), [taskId, text]);

  // The model: the task's own unless another is picked (one that reads this task's conversation).
  // A queued message keeps the one the picker shows only when picked, or when an earlier queued
  // message switches the model; otherwise it follows the task's model when it starts (which the run
  // may change meanwhile, escalating or failing over).
  const format = task?.format ?? "anthropic";
  const shownModel = model ?? task?.model ?? null;
  const picked = model && model !== task?.model ? model : null;
  // A repository for an agent task: linked by the next message, or switched to from the linked one
  // (an exported task keeps its export target; a waiting message that links one goes first).
  const repoQueued = items.some(item => item.repo);
  const canPickRepo = Boolean(task && task.mode === "agent" && github?.connected && (!task.githubRepo || task.githubMode === "linked") && !repoQueued);
  const current = task?.githubRepo ?? null;
  const switching = Boolean(repo && current);
  const pickRepo = (next: GitHubRepo | null) => setRepo(next && current && next.full_name.toLowerCase() === current.toLowerCase() ? null : next);

  const send = async () => {
    if (!canSend) return;
    const message = text.trim() || "See the attached file(s).";
    const files = attachments.files.slice();
    const pinned = picked ?? (active && items.some(item => item.model) ? shownModel : null);
    const serverIds = task?.skillIds ?? [];
    const skillsChanged = skillsReady && (skillIds.length !== serverIds.length || skillIds.some((id, index) => id !== serverIds[index]));
    const choice: FollowUpChoice = { model: active ? pinned : picked, repo: canPickRepo ? repo : null, replaceRepo: canPickRepo && switching, ...(skillsChanged ? { skillIds } : {}) };
    setSending(true);
    setError(null);
    setDictationError(null);
    setText("");
    try {
      await onSend(message, files, choice);
      attachments.clear(files.map(file => file.id));
      if (choice.repo) setRepo(null);
    } catch (failure) {
      setText(current => current || text);
      setError(errorMessage(failure, active ? "Couldn't queue the follow-up." : "Couldn't send the follow-up."));
      input.current?.focus();
    } finally {
      setSending(false);
    }
  };

  const insertDictated = (spoken: string) => {
    const at = selection.current;
    setText(current => insertAtCursor(current, spoken, at));
    selection.current = null;
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };

  const action = active ? "Queue" : "Send";
  const hint = !active ? null : stopping ? "Waits until you start it" : "Runs when this run finishes";

  return (
    <div className="convo-foot">
      <div className="convo-foot-inner">
        {items.length > 0 && <QueuedList queue={queue!} active={active} stopping={stopping} currentModel={task?.model ?? null} actions={queueActions} />}
        <div className={cx("composer compact", attachments.dragging && "dragging")} {...attachments.dropProps}>
          <label className="sr-only" htmlFor="follow-up">Follow-up message</label>
          <textarea
            id="follow-up"
            ref={input}
            className="composer-input"
            value={text}
            rows={2}
            placeholder={status ? (redeploy && REDEPLOY[status]) || PLACEHOLDER[status] : "Loading…"}
            aria-describedby={shownError ? "follow-up-error" : blocked || hint ? "follow-up-hint" : undefined}
            onChange={event => setText(event.target.value)}
            onBlur={event => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }}
            onPaste={attachments.onPaste}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <AttachmentTray files={attachments.files} uploading={attachments.uploading} onRemove={attachments.remove} />
          <p className="sr-only" role="status">{note}</p>
          <div className="composer-bar">
            <div className="composer-tools">
              {task && (
                <ModelPicker
                  value={shownModel ?? task.model}
                  onChange={id => setModel(id === task.model ? null : id)}
                  mode={task.mode}
                  team={Boolean(task.team)}
                  auto={false}
                  label="Model for the next message"
                  blocked={spec => followUpModelBlocked(spec, { mode: task.mode, team: task.team, format })}
                />
              )}
              {canPickRepo && <RepoSelector value={repo?.full_name ?? current} onChange={pickRepo} compact className="omni-repo" clearable={Boolean(repo)} />}
              <SkillPicker selected={skillIds} onChange={setSkillIds} onReady={setSkillsReady} />
              <button type="button" className="toggle" onClick={attachments.open} disabled={attachments.full} title="Attach files, or paste or drop screenshots into the box">
                <Paperclip size={14} aria-hidden="true" />
                <span className="toggle-label">Attach</span>
              </button>
              {attachments.picker}
              <DictationButton onText={insertDictated} onNote={(message, tone) => { setNote(message); setDictationError(tone === "error" ? message : null); }} tip="Dictate: speak your follow-up" />
            </div>
            <div className="composer-send">
              {blocked || hint
                ? <span id="follow-up-hint" className="composer-hint" data-show="">{blocked ?? hint}</span>
                : <span className="composer-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>}
              <Button variant="accent" pill icon={active ? ListPlus : ArrowUp} busy={sending} aria-disabled={!canSend || undefined} title={blocked ?? (empty ? "Write a message first" : !active ? undefined : stopping ? "Queue it: it waits until you start it" : "Queue it: it runs when this run finishes")} onClick={() => void send()}>
                {sending ? (active ? "Queueing…" : "Sending…") : action}
              </Button>
            </div>
          </div>
        </div>
        {canPickRepo && switching && repo && (
          <p className="followup-switch" role="status">
            <span>This message switches the task to <strong>{repo.full_name}</strong>. {current} stays in the workspace as files, but pushes go to {repo.full_name}.</span>
            <Button size="sm" variant="ghost" onClick={() => setRepo(null)}>Keep {current}</Button>
          </p>
        )}
        {shownError && (
          <p id="follow-up-error" className="field-error convo-error" role="alert">
            <TriangleAlert size={14} aria-hidden="true" />
            {shownError}
          </p>
        )}
      </div>
    </div>
  );
}

/** After a row leaves the list: the Edit button of the row that took its place (or the one before), else the message box. */
function refocus(listRef: RefObject<HTMLElement | null>, ids: (string | undefined)[]) {
  requestAnimationFrame(() => {
    const button = ids.map(id => (id ? listRef.current?.querySelector<HTMLButtonElement>(`[data-queued-edit="${id}"]`) : null)).find(Boolean);
    (button ?? document.getElementById("follow-up"))?.focus();
  });
}

/** The messages waiting for the run to end, oldest (next) first. */
function QueuedList({ queue, active, stopping, currentModel, actions }: { queue: TaskQueue; active: boolean; stopping: boolean; currentModel: string | null; actions: QueueActions }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const waiting = queue.items.filter(item => item.state === "waiting");
  const runNext = async () => {
    setStarting(true);
    setError(null);
    try {
      await actions.runNext();
      refocus(list, queue.items.slice(1).map(item => item.id));
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't start the next message."));
    } finally {
      setStarting(false);
    }
  };
  // Why nothing has started yet: the queue waits for the user, the run is still going, or the next
  // message is refused for now (its row says why).
  const status = queue.held && !active ? queue.held
    : active ? (stopping ? "They wait until you start them, after the stop." : "They run in order when this run finishes.")
    : waiting[0]?.error ? "Waiting to start…"
    : waiting.length ? "Starting the next one…" : "";
  return (
    <section className="followup-queue" aria-label="Queued follow-ups">
      <div className="followup-queue-head">
        <span className="followup-queue-title"><Clock size={13} aria-hidden="true" />{queue.items.length === 1 ? "1 message queued" : `${queue.items.length} messages queued`}</span>
        <span className="followup-queue-note">{status}</span>
        {queue.held && !active && waiting.length > 0 && <Button size="sm" icon={Play} busy={starting} onClick={() => void runNext()}>Run next</Button>}
      </div>
      {error && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
      <ol className="followup-queue-list" ref={list}>
        {queue.items.map((item, index) => <QueuedRow key={item.id} item={item} currentModel={currentModel} actions={actions} onRemoved={() => refocus(list, [queue.items[index + 1]?.id, queue.items[index - 1]?.id])} />)}
      </ol>
    </section>
  );
}

function QueuedRow({ item, currentModel, actions, onRemoved }: { item: QueuedMessage; currentModel: string | null; actions: QueueActions; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.prompt);
  const [busy, setBusy] = useState<"save" | "remove" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const starting = item.state === "starting";
  const leaveEdit = () => {
    setEditing(false);
    setDraft(item.prompt);
    setError(null);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const run = async (kind: "save" | "remove" | "retry", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === "save") {
        setEditing(false);
        requestAnimationFrame(() => editButton.current?.focus());
      }
      if (kind === "remove") onRemoved();
      // Try again unmounts its button (the row waits again, or started and left the list).
      if (kind === "retry") requestAnimationFrame(() => (editButton.current?.isConnected ? editButton.current.focus() : onRemoved()));
    } catch (failure) {
      setError(errorMessage(failure, kind === "remove" ? "Couldn't remove it." : kind === "retry" ? "Couldn't queue it again." : "Couldn't save the change."));
    } finally {
      setBusy(null);
    }
  };
  // Shown only when it differs from the task's model now (every queued message keeps its model).
  const canonical = (id: string | null) => (id ? getModel(id)?.id ?? id : null);
  const model = item.model && canonical(item.model) !== canonical(currentModel) ? getModel(item.model)?.label ?? item.model : null;
  return (
    <li className="followup-queued" data-state={item.state}>
      {editing ? (
        <form className="followup-queued-edit" onSubmit={event => { event.preventDefault(); if (draft.trim()) void run("save", () => actions.edit(item.id, draft.trim())); }}>
          <label className="sr-only" htmlFor={`queued-${item.id}`}>Edit the queued message</label>
          <textarea id={`queued-${item.id}`} className="input" value={draft} rows={3} autoFocus onChange={event => setDraft(event.target.value)}
            aria-describedby={error ? `queued-${item.id}-error` : undefined}
            onKeyDown={event => { if (event.key === "Escape") leaveEdit(); }} />
          {error && <p id={`queued-${item.id}-error`} className="followup-queued-error" data-tone="danger" role="alert">{error}</p>}
          <div className="followup-queued-actions">
            <Button size="sm" variant="ghost" onClick={leaveEdit}>Cancel</Button>
            <Button size="sm" type="submit" busy={busy === "save"} aria-disabled={!draft.trim() || undefined}>Save</Button>
          </div>
        </form>
      ) : (
        <>
          <div className="followup-queued-body">
            <p className="followup-queued-text">{item.prompt}</p>
            {(model || item.repo || item.attachments.length > 0 || starting) && (
              <p className="followup-queued-meta">
                {starting && <span className="chip"><Spinner size={11} /> Starting…</span>}
                {model && <span className="chip">On {model}</span>}
                {item.repo && <span className="chip">{item.repo.replace ? "Switches to" : "Links"} {item.repo.fullName}</span>}
                {item.attachments.length > 0 && <span className="chip">{item.attachments.length === 1 ? item.attachments[0].filename : `${item.attachments.length} files`}</span>}
              </p>
            )}
            {item.error && <p className="followup-queued-error" data-tone={item.state === "failed" ? "danger" : "warning"}>{item.state === "failed" ? `Couldn't start: ${item.error}` : `Waiting: ${item.error}`}</p>}
            {error && <p className="followup-queued-error" data-tone="danger" role="alert">{error}</p>}
          </div>
          {!starting && (
            <div className="followup-queued-actions">
              {item.state === "failed" && <Button size="sm" icon={RotateCcw} busy={busy === "retry"} onClick={() => void run("retry", () => actions.retry(item.id))}>Try again</Button>}
              <IconButton ref={editButton} data-queued-edit={item.id} size="sm" label="Edit" icon={Pencil} onClick={() => { setDraft(item.prompt); setError(null); setEditing(true); }} />
              <IconButton size="sm" label="Remove from the queue" icon={X} busy={busy === "remove"} onClick={() => void run("remove", () => actions.remove(item.id))} />
            </div>
          )}
        </>
      )}
    </li>
  );
}
