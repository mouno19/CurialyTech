import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ApprovalDecision, SecretOutcome } from "@shared/agent";
import type { Emit } from "./bus";
import { redactDeep, type SecretValue } from "./redact";
import { setCommandSecrets } from "./sandbox";

// What the agent asks the user in the middle of a run: approval for a change on GitHub (shown
// exactly), or a secret typed into a masked box. The run waits for the answer, until it expires or
// the run stops. A secret given here lives in this process's memory only, for its task: commands
// get it as an environment variable, and every line the run shows or stores has it wiped out.

export const REQUEST_TTL_MS = 15 * 60_000;
/** A task's secrets are forgotten an hour after they were last used (and on a restart). */
const SECRET_IDLE_MS = 60 * 60_000;
/** "Approve for this task" lasts this long. */
const TASK_APPROVAL_MS = 24 * 60 * 60_000;

export type RequestContext = { taskId: string; emit: Emit; signal: AbortSignal };

type Answer = { decision: "approved" | "approved_task" | "denied" } | { value: string; save: boolean } | { decline: true };
type Pending = { kind: "approval" | "secret"; taskId: string; resolve: (answer: Answer | null) => void };

const pending = new Map<string, Pending>();
const approvedTasks = new Map<string, number>();
const secrets = new Map<string, { values: Map<string, string>; usedAt: number }>();

/** Wait for the answer to one request: null when it expires or the run stops first. */
function wait(ctx: RequestContext, requestId: string, kind: Pending["kind"], ttlMs: number): Promise<Answer | null> {
  return new Promise(resolve => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (answer: Answer | null) => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(answer);
    };
    const onAbort = () => finish(null);
    pending.set(requestId, { kind, taskId: ctx.taskId, resolve: finish });
    timer = setTimeout(() => finish(null), ttlMs);
    timer.unref?.();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    if (ctx.signal.aborted) onAbort();
  });
}

const stopped = (ctx: RequestContext) => {
  if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error("Cancelled");
};

export type ApprovalRequest = {
  /** The tool or kind of change, e.g. "github_commit_and_push". */
  action: string;
  /** One line: "Push 3 files to owner/repo (main)". */
  title: string;
  /** Exactly what will change, one fact per line. */
  details: string[];
};

/**
 * Ask before a change. autoApprove: the account turned asking off (it still shows in the log).
 * Resolves approved or not, with what to tell the model when not; throws when the run stops.
 */
export async function askApproval(ctx: RequestContext, request: ApprovalRequest, opts: { autoApprove: boolean; ttlMs?: number }): Promise<{ approved: boolean; message: string }> {
  const requestId = randomUUID();
  const result = (decision: ApprovalDecision) => ctx.emit({ type: "approval_result", requestId, title: request.title, decision });
  if (opts.autoApprove) {
    result("auto");
    return { approved: true, message: "" };
  }
  const earlier = approvedTasks.get(ctx.taskId);
  if (earlier && Date.now() - earlier < TASK_APPROVAL_MS) {
    result("task");
    return { approved: true, message: "" };
  }
  const ttlMs = opts.ttlMs ?? REQUEST_TTL_MS;
  ctx.emit({ type: "approval_request", requestId, action: request.action, title: request.title, details: request.details.slice(0, 40).map(line => line.slice(0, 500)), expiresAt: new Date(Date.now() + ttlMs).toISOString() });
  const answer = await wait(ctx, requestId, "approval", ttlMs);
  if (!answer || !("decision" in answer)) {
    result("expired");
    stopped(ctx);
    return { approved: false, message: `The user didn't answer the approval request within ${Math.round(ttlMs / 60_000)} minutes, so nothing was changed. Tell them what you were about to do and that it waits for their approval; don't try again unless they ask.` };
  }
  result(answer.decision);
  if (answer.decision === "denied") return { approved: false, message: "The user denied this, so nothing was changed. Don't try it again, or a variation of it, unless they ask: tell them what you would have done." };
  if (answer.decision === "approved_task") approvedTasks.set(ctx.taskId, Date.now());
  return { approved: true, message: "" };
}

/** Where saved secrets come from (the account's Secrets page); null: this account can't save any. */
export type SecretStore = { load: (name: string) => Promise<string | null>; save: (name: string, value: string) => Promise<void> } | null;

/**
 * A secret for this task: one already given, else one the account saved, else asked for in a
 * masked box. The value goes to the task's commands only: what comes back is a description.
 */
export async function askSecret(ctx: RequestContext, request: { name: string; reason: string }, store: SecretStore, opts: { ttlMs?: number } = {}): Promise<{ ok: boolean; outcome: SecretOutcome | "known"; message: string }> {
  const { name } = request;
  const usage = `It is available to run_command as the environment variable $${name} (also to background commands and checks). You never see its value, and it is wiped from every output as [secret ${name}]. Never print it, write it into a file that could be committed, or pass it anywhere but where it's needed.`;
  if (secrets.get(ctx.taskId)?.values.has(name)) return { ok: true, outcome: "known", message: `${name} is already set for this task. ${usage}` };
  const requestId = randomUUID();
  const result = (outcome: SecretOutcome) => ctx.emit({ type: "secret_result", requestId, name, outcome });
  const saved = store ? await store.load(name).catch(() => null) : null;
  if (saved) {
    remember(ctx.taskId, name, saved);
    result("from_vault");
    return { ok: true, outcome: "from_vault", message: `Using ${name} from the user's saved secrets. ${usage}` };
  }
  const ttlMs = opts.ttlMs ?? REQUEST_TTL_MS;
  ctx.emit({ type: "secret_request", requestId, name, reason: request.reason.slice(0, 300), expiresAt: new Date(Date.now() + ttlMs).toISOString(), canSave: Boolean(store) });
  const answer = await wait(ctx, requestId, "secret", ttlMs);
  if (!answer || !("value" in answer)) {
    const outcome = answer ? "declined" : "expired";
    result(outcome);
    stopped(ctx);
    return { ok: false, outcome, message: outcome === "declined" ? `The user chose not to give ${name}. Continue without it if you can, or explain what it's needed for.` : `The user didn't enter ${name} within ${Math.round(ttlMs / 60_000)} minutes. Continue without it if you can, or explain what it's needed for.` };
  }
  remember(ctx.taskId, name, answer.value);
  let outcome: SecretOutcome = "provided";
  if (answer.save && store) {
    try {
      await store.save(name, answer.value);
      outcome = "saved";
    } catch (error) {
      ctx.emit({ type: "notice", level: "warn", message: `${name} is set for this task, but it couldn't be saved to your secrets: ${error instanceof Error ? error.message : "an error"}` });
    }
  }
  result(outcome);
  return { ok: true, outcome, message: `The user entered ${name}${outcome === "saved" ? " and saved it for later tasks" : ""}. ${usage}` };
}

export type AnswerResult = "ok" | "not_found" | "wrong_kind";

/** The user's answer from the page (the route checked the task is theirs). */
export function answerRequest(taskId: string, requestId: string, answer: Answer): AnswerResult {
  const entry = pending.get(requestId);
  if (!entry || entry.taskId !== taskId) return "not_found";
  if ((entry.kind === "approval") !== ("decision" in answer)) return "wrong_kind";
  entry.resolve(answer);
  return "ok";
}

function remember(taskId: string, name: string, value: string) {
  const entry = secrets.get(taskId) ?? { values: new Map<string, string>(), usedAt: Date.now() };
  entry.values.set(name, value);
  entry.usedAt = Date.now();
  secrets.set(taskId, entry);
}

/** The task's secrets for a command (null when it has none); using them keeps them another hour. */
export function taskSecrets(taskId: string): SecretValue[] {
  const entry = secrets.get(taskId);
  if (!entry) return [];
  if (Date.now() - entry.usedAt > SECRET_IDLE_MS) {
    secrets.delete(taskId);
    return [];
  }
  entry.usedAt = Date.now();
  return [...entry.values].map(([name, value]) => ({ name, value }));
}

/** Names only, for the model's context. */
export const taskSecretNames = (taskId: string) => [...(secrets.get(taskId)?.values.keys() ?? [])];

/** Without keeping them alive: for wiping values out of what a run shows and stores. */
export function redactForTask<T>(taskId: string, value: T): T {
  const entry = secrets.get(taskId);
  return entry ? redactDeep(value, [...entry.values].map(([name, secret]) => ({ name, value: secret }))) : value;
}

export function forgetTask(taskId: string) {
  secrets.delete(taskId);
  approvedTasks.delete(taskId);
}

/** Tests. */
export function resetRequests() {
  for (const entry of pending.values()) entry.resolve(null);
  pending.clear();
  approvedTasks.clear();
  secrets.clear();
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [taskId, entry] of secrets) if (now - entry.usedAt > SECRET_IDLE_MS) secrets.delete(taskId);
  for (const [taskId, at] of approvedTasks) if (now - at > TASK_APPROVAL_MS) approvedTasks.delete(taskId);
}, 10 * 60_000);
sweep.unref?.();

// Every command a task runs (its own, checks, background ones) gets the task's secrets.
setCommandSecrets(root => taskSecrets(path.basename(root)));
