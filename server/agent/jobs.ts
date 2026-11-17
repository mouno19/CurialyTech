import { randomBytes } from "node:crypto";
import type { Emit } from "./bus";
import { digestOutput } from "./output";
import { MAX_COMMAND_SEC, runCommand, SANDBOX_MODE, type CommandOptions, type CommandResult } from "./sandbox";

// Background commands. A long install, build or dev server runs on after the run_command call that
// started it has returned, so the agent writes code meanwhile instead of waiting. Each belongs to one
// run and streams into the tool card that started it; that card's result arrives when it ends. It
// ends when it exits, at its own time limit, on stop_command, and always when its run ends or is
// stopped, so nothing is left running in the sandbox. Only the cloud sandbox runs commands side by
// side: on this server they run one at a time, so there every command is waited for.

/** Background commands one run may have going at once. */
export const MAX_JOBS = 3;
/** Default time limits: an install or build, and a dev server (which lasts until it is stopped). */
export const TASK_JOB_SEC = 600;
export const SERVER_JOB_SEC = MAX_COMMAND_SEC;
/** What a job keeps of its output: its start, and a rolling tail. */
const HEAD_CHARS = 4000;
const TAIL_CHARS = 48_000;
/** How long a stop waits for the command (and the sync after it) to end. */
const STOP_WAIT_MS = 15_000;

export type JobKind = "server" | "task";
export type JobState = "running" | "exited" | "stopped" | "timed_out";

export type Job = {
  /** The token the agent uses for it (bg-1a2b). */
  id: string;
  command: string;
  kind: JobKind;
  callId: string;
  timeoutSec: number;
  startedAt: number;
  endedAt: number | null;
  state: JobState;
  exitCode: number | null;
  /** Why it was stopped: stop_command, the agent finishing its turn, the end of the run. */
  stopReason?: string;
  /** run_command returned while it still ran: its card's result is sent when it ends. */
  detached: boolean;
  /** The model has been given its final state (a status call, or the note after it ended). */
  reported: boolean;
  /** The runner's workspace counter once it started (see runner.ts WorkLog). */
  startSeq?: number;
};

type Entry = Job & { controller: AbortController; done: Promise<void>; head: string; tail: string; total: number; emit: Emit; listeners: Set<() => void> };

let run: (opts: CommandOptions) => Promise<CommandResult> = runCommand;
let available = SANDBOX_MODE === "remote";

/** Whether commands can run in the background here (only the cloud sandbox runs them side by side). */
export const backgroundAvailable = () => available;

/** Tests run background commands through a runner of their own. */
export function useJobRunnerForTests(runner: typeof run) {
  run = runner;
  available = true;
}

const anyOf = (parts: string[]) => new RegExp(`(?:^|[\\s;&|(])(?:${parts.join("|")})`);

/** Commands that never end by themselves: dev servers and watchers. */
const SERVER = anyOf([
  String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b`,
  String.raw`npx\s+(?:-y\s+)?(?:vite|next|serve|http-server|live-server|nodemon|json-server)(?=\s|$)(?!\s+(?:build|export|lint))`,
  String.raw`vite(?:\s+(?:dev|serve|preview))?(?=\s|$)(?!\s+(?:build|optimize))`,
  String.raw`next\s+(?:dev|start)\b`,
  String.raw`(?:http-server|live-server|nodemon|json-server)(?=\s|$)`,
  String.raw`python3?\s+(?:-\S+\s+)*-m\s+http\.server\b`,
  String.raw`(?:uvicorn|gunicorn|hypercorn)\s`,
  String.raw`flask\s+run\b`,
  String.raw`php\s+-S\s`,
  String.raw`rails\s+s(?:erver)?\b`,
  String.raw`manage\.py\s+runserver\b`,
  String.raw`webpack(?:-dev-server|\s+serve)\b`,
  String.raw`tsc\s+(?:.*\s)?(?:-w|--watch)\b`,
  String.raw`(?:node|tsx|ts-node|bun)\s+(?:\S+\/)?(?:server|app)\.[cm]?[jt]s\b`,
]);

/** Commands that end but take a while: installs, scaffolding, builds, downloads. */
const LONG_TASK = anyOf([
  String.raw`(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|update|upgrade|rebuild|create|dlx)\b`,
  String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b`,
  String.raw`npm\s+(?:init|exec)\s+\S`,
  String.raw`npx\s+(?:-y\s+|--yes\s+)?(?:create-[\w-]+|degit|@[\w-]+\/create[\w-]*|playwright\s+install)`,
  String.raw`(?:pip3?|uv\s+pip|python3?\s+-m\s+pip)\s+install\b`,
  String.raw`uv\s+(?:sync|add)\b`,
  String.raw`poetry\s+(?:install|add)\b`,
  String.raw`pipenv\s+install\b`,
  String.raw`conda\s+(?:install|create)\b`,
  String.raw`(?:apt|apt-get)\s+(?:-\S+\s+)*(?:install|update|upgrade)\b`,
  String.raw`apk\s+add\b`,
  String.raw`cargo\s+(?:build|install|fetch)\b`,
  String.raw`go\s+(?:build|install|get|mod\s+download)\b`,
  String.raw`(?:\.\/)?(?:mvnw?|gradlew?)\s`,
  String.raw`docker\s+(?:build|pull|compose\s+(?:build|pull))\b`,
  String.raw`composer\s+(?:install|require|update)\b`,
  String.raw`(?:bundle|gem)\s+install\b`,
  String.raw`(?:vite|next|nuxt|astro|ng|remix)\s+build\b`,
  String.raw`nuxt\s+generate\b`,
  String.raw`(?:webpack|rollup)(?=\s|$)`,
  String.raw`parcel\s+build\b`,
  String.raw`git\s+clone\b`,
  String.raw`wget\s`,
  String.raw`curl\b[^|;&\n]*\s-(?:[A-Za-z]*[oO]\b|-output\b|-remote-name\b)`,
]);

/** Whether a command is one to run in the background, and which kind (null: an ordinary command). */
export function jobKind(command: string): JobKind | null {
  if (SERVER.test(command)) return "server";
  if (LONG_TASK.test(command)) return "task";
  return null;
}

/** A dev server says it is ready; no need to wait out the rest of its start-up allowance. */
const SERVER_READY = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?|\blistening\b|\bready in\b|\bstarted server\b|\brunning (?:on|at)\b|\bserving\b/i;

const newId = (taken: Map<string, unknown>) => {
  for (;;) {
    const id = `bg-${randomBytes(2).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
};

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))} s`;

/** The command as it appears in status lines: its first line, shortened. */
export const shortCommand = (command: string) => {
  const line = command.trim().split("\n")[0];
  return line.length > 80 || command.trim().includes("\n") ? `${line.slice(0, 77)}…` : line;
};

export const succeeded = (job: Job) => job.state === "exited" && job.exitCode === 0;
/** Ended in a way the agent has to deal with (not stopped on purpose). */
export const failed = (job: Job) => job.state === "timed_out" || (job.state === "exited" && job.exitCode !== 0);

/** One line on where a job stands. */
export function describeJob(job: Job, now = Date.now()) {
  const took = seconds((job.endedAt ?? now) - job.startedAt);
  const what = `${job.id} \`${shortCommand(job.command)}\``;
  switch (job.state) {
    case "running": return `${what} is still running (${took} so far).`;
    case "timed_out": return `${what} reached its ${job.timeoutSec} s limit and was stopped.`;
    case "stopped": return `${what} was stopped after ${took} (${job.stopReason ?? "stopped"}).`;
    default: return job.exitCode === 0 ? `${what} finished after ${took} (exit code 0).` : `${what} failed after ${took} (${job.exitCode === null ? "it did not run to the end" : `exit code ${job.exitCode}`}).`;
  }
}

/** The tool card's summary when a background command ends. */
function summaryOf(job: Job) {
  if (job.state === "timed_out") return `timed out after ${job.timeoutSec}s`;
  if (job.state === "stopped") return "stopped";
  return job.exitCode === null ? "did not finish" : `exit code ${job.exitCode}`;
}

function keep(entry: Entry, chunk: string) {
  entry.total += chunk.length;
  if (entry.head.length < HEAD_CHARS) {
    const room = HEAD_CHARS - entry.head.length;
    entry.head += chunk.slice(0, room);
    chunk = chunk.slice(room);
  }
  if (chunk) entry.tail = (entry.tail + chunk).slice(-TAIL_CHARS);
  for (const listener of entry.listeners) listener();
}

/** The background commands of one run (shared by its Dev Team members). */
export class JobRegistry {
  private entries = new Map<string, Entry>();

  constructor(private opts: { root: string; signal: AbortSignal; onEnd?: (job: Job) => void }) {}

  get(id: string): Job | undefined {
    return this.entries.get(id.trim());
  }

  list(): Job[] {
    return Array.from(this.entries.values());
  }

  running(): Job[] {
    return this.list().filter(job => job.state === "running");
  }

  /** Start a command in the background. A string says why it could not start. */
  start(spec: { command: string; kind: JobKind; timeoutSec: number; callId: string; emit: Emit }): Job | string {
    if (this.opts.signal.aborted) return "The run is stopping; nothing new starts now.";
    const busy = this.running();
    if (busy.length >= MAX_JOBS) return `${MAX_JOBS} background commands are already running (${busy.map(job => job.id).join(", ")}). Wait for one with command_status, or stop one with stop_command, before starting another.`;
    const controller = new AbortController();
    const timeoutSec = Math.max(5, Math.min(MAX_COMMAND_SEC, Math.round(spec.timeoutSec)));
    const entry: Entry = {
      id: newId(this.entries), command: spec.command, kind: spec.kind, callId: spec.callId, timeoutSec, startedAt: Date.now(), endedAt: null, state: "running", exitCode: null,
      detached: false, reported: false, controller, done: Promise.resolve(), head: "", tail: "", total: 0, emit: spec.emit, listeners: new Set(),
    };
    // The run stopping (cancel, shutdown, its end) stops every command it started.
    const stop = () => {
      entry.stopReason ??= "the run was stopped";
      controller.abort();
    };
    this.opts.signal.addEventListener("abort", stop, { once: true });
    entry.done = run({
      root: this.opts.root, command: spec.command, timeoutSec, signal: controller.signal,
      onOutput: (stream, chunk) => {
        keep(entry, chunk);
        spec.emit({ type: "tool_output", callId: spec.callId, stream, chunk });
      },
    })
      .catch((error): CommandResult => ({ exitCode: null, timedOut: false, output: `Failed to start command: ${error instanceof Error ? error.message : String(error)}`, durationMs: 0 }))
      .then(result => {
        this.opts.signal.removeEventListener("abort", stop);
        this.settle(entry, result);
      });
    this.entries.set(entry.id, entry);
    return entry;
  }

  private settle(entry: Entry, result: CommandResult) {
    entry.endedAt = Date.now();
    entry.exitCode = result.exitCode;
    entry.state = entry.stopReason ? "stopped" : result.timedOut ? "timed_out" : "exited";
    if (!entry.total && result.output) keep(entry, result.output);
    for (const listener of entry.listeners) listener();
    if (entry.detached) entry.emit({ type: "tool_result", callId: entry.callId, ok: succeeded(entry), summary: summaryOf(entry), exitCode: entry.exitCode, durationMs: entry.endedAt - entry.startedAt });
    try {
      this.opts.onEnd?.(entry);
    } catch (error) {
      console.error("[jobs] end listener:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Wait until one of `jobs` ends (all of them with `all`), `ms` pass or the signal aborts. With
   * `ready`, a job whose output matches it also ends the wait (a dev server that says it is up).
   */
  async wait(jobs: Job[], ms: number, opts: { all?: boolean; signal?: AbortSignal; ready?: RegExp } = {}) {
    const pending = jobs.map(job => this.entries.get(job.id)).filter((entry): entry is Entry => Boolean(entry && entry.state === "running"));
    const ready = (entry: Entry) => Boolean(opts.ready?.test(entry.head + entry.tail.slice(-4000)));
    if (!pending.length || ms <= 0 || opts.signal?.aborted || pending.some(ready)) return;
    let finish!: () => void;
    const over = new Promise<void>(resolve => { finish = resolve; });
    const timer = setTimeout(finish, ms);
    opts.signal?.addEventListener("abort", finish, { once: true });
    const watchers = pending.map(entry => {
      const listener = () => {
        if (entry.state !== "running" ? !opts.all || pending.every(other => other.state !== "running") : ready(entry)) finish();
      };
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    });
    await over;
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", finish);
    for (const unwatch of watchers) unwatch();
  }

  /** Wait for a dev server to say it is up, or `ms`. */
  waitUntilReady(job: Job, ms: number, signal?: AbortSignal) {
    return this.wait([job], ms, { signal, ready: job.kind === "server" ? SERVER_READY : undefined });
  }

  /** Stop a command and everything it started; resolves once it has ended (or after a while). */
  async stop(id: string, reason: string) {
    const entry = this.entries.get(id.trim());
    if (!entry) return undefined;
    if (entry.state === "running") {
      entry.stopReason ??= reason;
      entry.controller.abort();
      await this.wait([entry], STOP_WAIT_MS);
    }
    return entry as Job;
  }

  /** Stop everything still running (the agent finished, or the run ends). */
  async stopAll(reason: string, filter: (job: Job) => boolean = () => true) {
    await Promise.all(this.running().filter(filter).map(job => this.stop(job.id, reason)));
  }

  /** The output a job kept: its start and its tail, with a mark where the middle was dropped. */
  text(id: string) {
    const entry = this.entries.get(id.trim());
    if (!entry) return "";
    const dropped = entry.total - entry.head.length - entry.tail.length;
    return dropped > 0 ? `${entry.head}\n… [${dropped} characters not kept] …\n${entry.tail}` : entry.head + entry.tail;
  }

  /** A job's state and the part of its output that matters, for the model. */
  report(id: string, maxChars = 6000) {
    const job = this.get(id);
    if (!job) return "";
    const output = this.text(job.id).trim();
    if (!output) return `${describeJob(job)}\n(no output${job.state === "running" ? " yet" : ""})`;
    if (job.state === "running") return `${describeJob(job)}\nOutput so far:\n${digestOutput(output, { maxChars })}`;
    return `${describeJob(job)}\n${digestOutput(output, { maxChars })}`;
  }

  /**
   * What ended in the background since the agent last heard, to add to its next tool result: one
   * line each, with the error output of a failure and the last lines of a success.
   */
  takeNotes() {
    const ended = this.list().filter(job => job.detached && !job.reported && job.state !== "running");
    return ended.map(job => {
      job.reported = true;
      const output = this.text(job.id).trim();
      const detail = !output || job.state === "stopped" ? ""
        : failed(job) ? `\n${digestOutput(output, { maxChars: 3000 })}`
          : `\nLast lines:\n${digestOutput(output.split("\n").slice(-6).join("\n"), { maxChars: 600 })}`;
      return `\n\n[Background] ${describeJob(job)}${detail}`;
    }).join("");
  }
}
