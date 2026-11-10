import { brandText } from "@shared/brand";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import multer from "multer";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { MODELS, type AgentEvent, type AgentEventBody } from "@shared/agent";
import { isActiveStatus, isFinalStatus } from "@shared/taskStatus";
import { countMedia, deleteMedia, getMedia, isElsewhere, listMedia, markMediaMissing, mediaIds, mediaStatus, openMedia, storageConfig, storeMedia, assertStorageAvailable, type MediaCursor } from "../media/snowflake";
import { deleteFiles, vaultFullError, vaultState } from "../media/vault";
import { DELETE_BATCH, MAX_SELECT_IDS, MAX_UPLOAD_BYTES, MEDIA_KINDS, UPLOADS_AT_ONCE, vaultFull, type MediaKind } from "@shared/media";
import { accountOf, rateLimited, requireAdmin } from "../auth";
import { charge, getBalance, outOfCreditsMessage } from "../credits";
import { speakStandard, transcribe, voiceConfigured, VoiceError } from "../voice/engines";
import { MAX_DICTATION_BYTES, MAX_DICTATION_SECONDS, READ_ALOUD_INPUT_CHARS, READ_ALOUD_MAX_CHARS, speakableText, VOICES, worstCaseSeconds } from "@shared/voice";
import { voiceCredits } from "@shared/credits";
import { redact, StorageError } from "../media/storage-errors";
import { isLive, liveChannel } from "./bus";
import { deployConfigured, deploymentSession, destroyDeployment, listDeployments, listTaskDeployments } from "./deploy";
import { appendTaskEvent } from "./events";
import { countActiveRuns, getLifecycleRow, judgeStaleness } from "./lifecycle";
import { PROVIDER_ENV, probeProviders } from "./providers";
import { activeTaskCount, followUp, followUpRepoBlocked, followUpSpec, isBusy, isRunning, requestCancel, RESTARTING, retryTask, startDeployRun, startTask, TaskRejected, type FollowUpRepo } from "./runner";
import { admissionRefusal, oneAtATime } from "./admission";
import { drainQueue, editQueued, listQueue, queueMessage, QueueRejected, removeQueued, requeue } from "./queue";
import { listWorkspaceTree, removeWorkspace, resolveInWorkspace, SANDBOX_MODE, SandboxError, workspacePath } from "./sandbox";
import { activeRunsOf, agentStats, deleteAgentTask, getAgentTask, lastSeq, listAgentTasks, listEventsAfter, listWorkspaceSnapshot, loadWorkspaceSnapshot, readSnapshotFile, taskOwner } from "./store";
import { findArchivedBuild, findBuildDirs, isPublishExcluded, isUnbuiltTemplate, materializeWorkspace, readWorkspaceFiles, restoreWorkspace, withWorkspaceLock } from "./workspaces";
import { query } from "../db/pg";
import { branchHead, createRepo, describeGitHubError, disconnect, getConnection, GITHUB_SCOPES, githubApi, GitHubError, isValidRepoName, listRepos, oauthConfigured, pushProjectToRepo, RemoteChangedError, workflowFilesBlocked, workflowScopeMessage } from "../services/github";
import { cloneIntoWorkspace, commitAndPush, linkedRepo } from "./repos";
import { absoluteAssetWarnings, detectPreviewRoot, previewBaseUrl } from "./preview";
import { browse, sessionStatus } from "./browser";

const createSchema = z.object({
  prompt: z.string().trim().min(2, "Describe what you want to accomplish.").max(20_000),
  model: z.string().trim().max(120).default("auto"),
  mode: z.enum(["agent", "chat"]).default("agent"),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  webSearch: z.boolean().default(false),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be owner/name").nullish(),
  repoBranch: z.string().trim().max(200).nullish(),
  team: z.boolean().default(false),
  clientMessageId: z.string().trim().max(80).optional(),
});
const linkSchema = z.object({ repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), branch: z.string().trim().max(200).optional() });

const followUpSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  clientMessageId: z.string().trim().max(80).optional(),
  expectedRunId: z.string().uuid().nullish(),
  /** Continue on another model (same conversation format). */
  model: z.string().trim().max(80).nullish(),
  /** Link a repository (a task without one): cloned as the run's first step. */
  repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be owner/name").nullish(),
  repoBranch: z.string().trim().max(200).nullish(),
  /** The task has another repository: switch to this one (it stays in the workspace as files). */
  replaceRepo: z.boolean().optional(),
});
const queueEditSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** runId: the run the client saw (a stale tab cannot cancel or retry a newer run by accident). */
const runRefSchema = z.object({ runId: z.string().uuid().nullish() });
const deploySchema = z.object({ confirm: z.literal(true, "Confirm the deploy to start it."), runId: z.string().uuid().nullish() });

/** Resolve uploaded media ids (from /media) into attachment references; only the account's own files. */
async function resolveAttachments(ids: string[], userId: string) {
  const refs = [];
  for (const id of Array.from(new Set(ids))) {
    const media = await getMedia(id);
    if (!media || media.user_id !== userId) throw new TaskRejected(`Attachment ${id} not found.`);
    if (media.state === "missing") throw new TaskRejected(`${media.filename} is no longer available; attach it again.`);
    if (isElsewhere(media)) throw new TaskRejected(`${media.filename} is in an earlier storage location this server no longer reads; attach it again.`);
    refs.push({ id: media.id, filename: media.filename, stagePath: media.stage_path, mimeType: media.mime_type, sizeBytes: media.size_bytes });
  }
  return refs;
}

/**
 * Export: creating a repository needs its name and an explicit visibility, and a public one an
 * explicit confirmation; pushing to a linked repository's default branch needs its own confirmation;
 * re-exporting over commits that weren't pushed from the workspace needs confirmOverwrite.
 * Nothing here is ever defaulted to public.
 */
const exportSchema = z.object({
  repoName: z.string().trim().max(100).optional(),
  visibility: z.enum(["private", "public"]).optional(),
  confirmPublic: z.literal(true).optional(),
  message: z.string().trim().max(2000).optional(),
  branch: z.string().trim().max(200).optional(),
  confirmDefaultBranch: z.literal(true).optional(),
  confirmOverwrite: z.literal(true).optional(),
});

/** GET repositories for the picker: the shape the UI (and /api/github/repos) promises. */
export async function githubReposHandler(req: Request, res: Response) {
  const connection = await getConnection(accountOf(req).id);
  if (!connection) return res.status(409).json({ error: "Connect GitHub first.", repos: [] });
  const repos = await listRepos(connection.token, 50);
  res.json({ login: connection.login, repos: repos.map(({ id, name, full_name, private: isPrivate, default_branch, description, updated_at, language }) => ({ id, name, full_name, private: isPrivate, default_branch, description, updated_at, language })) });
}

// Uploads are held in memory and streamed straight to the file store; they never touch the VPS disk.
// Free accounts get a bounded vault; the operator's and a plan's are unbounded (media/vault.ts).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/** The vault list's filter and page (?kind=&q=&cursor=&limit=); the cursor is the server's own. */
const mediaListQuery = z.object({
  kind: z.enum(MEDIA_KINDS as [MediaKind, ...MediaKind[]]).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().regex(/^\d{1,17}_[0-9a-f-]{36}$/i, "That page link isn't valid; reload the list.").optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const cursorOf = (row: { createdAtUs: string; id: string }) => `${row.createdAtUs}_${row.id}`;
const parseCursor = (value: string): MediaCursor => ({ createdAtUs: value.slice(0, value.indexOf("_")), id: value.slice(value.indexOf("_") + 1).toLowerCase() });
const mediaDeleteBody = z.object({ ids: z.array(z.string().regex(UUID, "Name files by their id.")).min(1, "Choose at least one file.").max(DELETE_BATCH, `Delete up to ${DELETE_BATCH} files at a time.`) });

function sendStorageError(res: Response, error: StorageError) {
  if (error.kind === "object_missing") return res.status(410).json({ error: error.message, code: "media_gone" });
  if (error.kind === "elsewhere") return res.status(410).json({ error: error.message, code: "media_elsewhere" });
  if (error.unavailable) {
    const retryAfter = Math.max(5, error.retryAfterSec || 30);
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: error.message, code: "storage_unavailable", retryAfter });
  }
  return res.status(422).json({ error: error.message, code: "storage_rejected" });
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
  if (error instanceof StorageError) return sendStorageError(res, error);
  if (error instanceof TaskRejected) return res.status(error.message === RESTARTING ? 503 : 409).json({ error: brandText(error.message) });
  if (error instanceof QueueRejected) return res.status(error.status).json({ error: error.message });
  if (error instanceof SandboxError) return res.status(400).json({ error: error.message });
  if (error instanceof VoiceError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof RemoteChangedError) return res.status(409).json({ error: `${error.message} Pushing replaces their files; confirm to push anyway.`, code: "remote_changed", branch: error.branch });
  if (error instanceof GitHubError) {
    console.error(`[agent] GitHub ${error.status}: ${redact(error.message).slice(0, 200)}`);
    const message = brandText(describeGitHubError(error));
    return res.status(error.status === 401 ? 409 : error.status === 422 ? 422 : 502).json({ error: message, ...(error.status === 401 ? { code: "github_reconnect" } : {}) });
  }
  // Never log raw error objects: driver errors can carry request bodies with credentials.
  console.error("[agent]", error instanceof Error ? `${error.name}: ${redact(error.message)}` : redact(String(error)));
  return res.status(500).json({ error: error instanceof Error ? `Execution Error: ${brandText(redact(error.message))}` : "Unexpected error" });
}

/** Wrap async handlers so rejections become JSON errors instead of hanging requests. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => (res.headersSent ? res.end() : sendError(res, error)));
};

/** The task, if it exists and the signed-in account may see it (its owner, or the operator); else 404. */
async function taskOr404(req: Request, res: Response) {
  const user = accountOf(req);
  const id = String(req.params.id);
  const owner = await taskOwner(id);
  const task = owner === user.id || (owner && user.role === "admin") ? await getAgentTask(id) : undefined;
  if (!task) res.status(404).json({ error: "Task not found." });
  return task;
}

/** A media file the signed-in account owns (the operator may open any); else undefined (answered 404). */
async function mediaFor(req: Request) {
  const user = accountOf(req);
  const media = await getMedia(String(req.params.id));
  return media && (media.user_id === user.id || user.role === "admin") ? media : undefined;
}

/**
 * Voice for free accounts: paid in credits (they need `need`, the request's worst case, available),
 * at most 40 requests in ten minutes and one at a time, so parallel requests can't spend the same
 * credits twice. The operator is not limited. Returns a release function, or null when refused.
 */
const voiceInFlight = new Set<string>();
async function voiceAllowed(req: Request, res: Response, need: number): Promise<(() => void) | null> {
  if (!voiceConfigured()) {
    res.status(503).json({ error: "Voice isn't set up on this server.", code: "not_configured" });
    return null;
  }
  const user = accountOf(req);
  if (user.role === "admin") return () => undefined;
  if (voiceInFlight.has(user.id)) {
    res.status(429).json({ error: "Wait for your other voice request to finish.", code: "busy" });
    return null;
  }
  if (rateLimited(`voice:${user.id}`, 40)) {
    res.status(429).json({ error: "That's a lot of voice requests. Wait a few minutes, then try again.", code: "busy" });
    return null;
  }
  voiceInFlight.add(user.id);
  const release = () => voiceInFlight.delete(user.id);
  try {
    const balance = await getBalance(user.id);
    if (balance.available < need) {
      release();
      res.status(402).json({ error: outOfCreditsMessage(balance), code: "no_credits", credits: balance });
      return null;
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

const speechSchema = z.object({ text: z.string().min(1).max(READ_ALOUD_INPUT_CHARS * 2), voice: z.enum(VOICES.map(voice => voice.id) as [string, ...string[]]).optional() });
// Dictation audio is held in memory, sent for transcription and dropped: never stored.
const dictationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DICTATION_BYTES, files: 1 } });

/** The live browser view is clickable: only the operator gets its address (see browser.ts liveBrowser). */
function viewerFor<T extends { viewer: string | null }>(req: Request, status: T): T {
  return accountOf(req).role === "admin" ? status : { ...status, viewer: null };
}

/** Whether the signed-in account may start a run now (see admission.ts); answers the refusal if not. */
async function admitRun(req: Request, res: Response) {
  const refusal = await admissionRefusal(accountOf(req));
  if (!refusal) return true;
  res.status(refusal.status).json({ error: refusal.error, code: refusal.code, ...(refusal.credits ? { credits: refusal.credits } : {}) });
  return false;
}

/**
 * What a follow-up asks for besides its text, checked before it starts or waits: the model it runs
 * on and the repository it links, with the task owner's GitHub connected for that (the run clones
 * with it). A queued message keeps its model even when it is the task's current one, since an
 * earlier queued message may switch the task to another before this one starts.
 */
async function followUpExtras(task: NonNullable<Awaited<ReturnType<typeof getAgentTask>>>, input: z.infer<typeof followUpSchema>, opts: { queued?: boolean } = {}) {
  const model = input.model && (opts.queued || input.model !== task.model) ? followUpSpec(task, input.model).spec.id : null;
  const repo: FollowUpRepo | null = input.repo ? { fullName: input.repo, branch: input.repoBranch ?? null, replace: Boolean(input.replaceRepo) } : null;
  if (repo) {
    const blocked = followUpRepoBlocked(task, repo);
    if (blocked) throw new TaskRejected(blocked);
    const owner = await taskOwner(task.id);
    if (!owner || !(await getConnection(owner))) throw new TaskRejected("Connect GitHub first to work on a repository.");
  }
  const same = Boolean(repo && task.githubRepo && task.githubRepo.toLowerCase() === repo.fullName.toLowerCase());
  return { model, repo: same ? null : repo };
}

const MAX_VIEW_BYTES = 25 * 1024 * 1024;
/** Inline in raw mode: images, and audio/video for players (everything else downloads). */
const IMAGE_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", weba: "audio/webm", mp4: "video/mp4", webm: "video/webm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  bmp: "image/bmp", ico: "image/x-icon", svg: "image/svg+xml",
};
const SANDBOX_CSP = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
const PDF_CSP = "default-src 'none'; script-src 'none'; frame-ancestors 'self'";

let healthCache: { at: number; result: Awaited<ReturnType<typeof probeProviders>> } | null = null;

async function activeRunsAnywhere() {
  return countActiveRuns().catch(() => activeTaskCount());
}

export function agentRouter() {
  const router = Router();

  router.get("/models", (_req, res) => res.json({ models: MODELS }));

  router.get("/health", handle(async (req, res) => {
    const user = accountOf(req);
    // A deep check probes every provider: the operator's tool. Accounts see their own active runs.
    const deep = req.query.deep === "1" && user.role === "admin";
    const activeTasks = () => (user.role === "admin" ? activeRunsAnywhere() : activeRunsOf(user.id));
    if (!deep && healthCache && Date.now() - healthCache.at < 20_000) return res.json({ providers: healthCache.result, activeTasks: await activeTasks() });
    const [providers, media, database] = await Promise.all([
      probeProviders(deep),
      // Answered from the storage breaker (no I/O) unless a deep check was asked for.
      mediaStatus(deep).then(status => ({ id: "vault", label: "Curialy Vault (media)", ok: status.ok, latencyMs: 0, detail: status.detail, configured: status.state !== "not_configured" })),
      (async () => {
        const started = Date.now();
        try {
          await query("SELECT 1");
          return { id: "data", label: "Curialy Data", ok: true, latencyMs: Date.now() - started, detail: "Database connected", configured: true };
        } catch (error) {
          return { id: "data", label: "Curialy Data", ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? brandText(redact(error.message)) : "error", configured: Boolean(process.env.TIGER_DATABASE_URL) };
        }
      })(),
    ]);
    const result = [database, ...providers, media];
    if (!deep) healthCache = { at: Date.now(), result };
    res.json({ providers: result, activeTasks: await activeTasks() });
  }));

  router.get("/keys", requireAdmin, (_req, res) => {
    const mask = (value: string | undefined) => (value ? `••••${value.slice(-4)}` : null);
    const env = process.env;
    res.json({
      keys: [
        { id: "core", label: "Curialy Core engine", configured: Boolean(env.SNOWFLAKE_PAT), masked: mask(env.SNOWFLAKE_PAT) },
        { id: "fast", label: "Fast Reasoning engine", configured: Boolean(PROVIDER_ENV.paperKey), masked: mask(PROVIDER_ENV.paperKey) },
        { id: "relay", label: "Relay engine (Claude & Gemini routes)", configured: Boolean(PROVIDER_ENV.relayKey), masked: mask(PROVIDER_ENV.relayKey) },
        { id: "research", label: "Research Agent", configured: Boolean(PROVIDER_ENV.manusKey), masked: mask(PROVIDER_ENV.manusKey) },
        { id: "browser", label: "Live Browser", configured: Boolean(PROVIDER_ENV.browserbaseKey), masked: mask(PROVIDER_ENV.browserbaseKey) },
        { id: "deploy", label: "Cloud Deploy", configured: Boolean(PROVIDER_ENV.renderKey), masked: mask(PROVIDER_ENV.renderKey) },
        {
          id: "sandbox", label: "Cloud Sandbox (agent commands)", configured: SANDBOX_MODE === "e2b" && Boolean(env.E2B_API_KEY), masked: mask(env.E2B_API_KEY),
          note: SANDBOX_MODE === "e2b" ? "Every task's commands, installs and builds run in a sandbox of its own, not on this server." : "Not in use: commands run on this server as the sandbox user.",
        },
        { id: "data", label: "Curialy Data (database)", configured: Boolean(env.TIGER_DATABASE_URL), masked: env.TIGER_DATABASE_URL ? "connected" : null },
        { id: "voice", label: "Curialy Voice (dictation, transcripts, narration)", configured: Boolean(env.DEEPGRAM_API_KEY), masked: mask(env.DEEPGRAM_API_KEY) },
        { id: "voice-studio", label: "Curialy Voice Studio (expressive speech)", configured: Boolean(env.ELEVENLABS_API_KEY), masked: mask(env.ELEVENLABS_API_KEY), note: "Used only for emotion and voice acting on the operator's tasks, never past a reserve of the monthly budget." },
        // The vault's own login (it may be a separate account): only whether it is complete.
        { id: "vault", label: "Curialy Vault (media storage)", configured: storageConfig().ok, masked: storageConfig().ok ? "set" : null },
        { id: "tuning", label: "Model tuning", configured: Boolean(env.TINKER_API_KEY), masked: mask(env.TINKER_API_KEY), note: "Stored for fine-tuning; no tuned models are routable yet." },
        { id: "github-oauth", label: "GitHub app", configured: oauthConfigured(), masked: env.GITHUB_CLIENT_ID ? `••••${env.GITHUB_CLIENT_ID.slice(-4)}` : null, note: "Connected-account tokens are stored encrypted (AES-256-GCM)." },
        { id: "session", label: "Session signing secret", configured: (env.SESSION_SECRET ?? "").length >= 32, masked: env.SESSION_SECRET ? "set" : null },
        { id: "admin", label: "Admin password", configured: Boolean(env.ADMIN_PASSWORD_HASH), masked: env.ADMIN_PASSWORD_HASH ? "scrypt hash" : null },
      ],
    });
  });

  router.get("/stats", handle(async (req, res) => {
    const user = accountOf(req);
    res.json({ ...(await agentStats(user.id)), active: await activeRunsOf(user.id) });
  }));

  router.get("/tasks", handle(async (req, res) => res.json({ tasks: await listAgentTasks(accountOf(req).id) })));

  router.post("/tasks", handle(async (req, res) => {
    const input = createSchema.parse(req.body);
    const user = accountOf(req);
    await oneAtATime(user.id, async () => {
      if (!(await admitRun(req, res))) return;
      const taskId = await startTask(input, await resolveAttachments(input.attachmentIds, user.id), { clientMessageId: input.clientMessageId, userId: user.id, operator: user.role === "admin" });
      res.status(201).json({ taskId });
    });
  }));

  router.get("/tasks/:id", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (task) res.json({ task, live: isLive(task.id), running: isRunning(task.id), queue: await listQueue(task) });
  }));

  router.delete("/tasks/:id", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isBusy(task.id)) return res.status(409).json({ error: "Cancel the task before deleting it.", status: task.status });
    const row = await getLifecycleRow(task.id);
    // Only a run some live worker still owns blocks deletion; a stale "running" row does not.
    if (row && isActiveStatus(row.status) && !judgeStaleness({ workerId: row.workerId, leaseLive: row.leaseLive, leaseExpiredFor: row.leaseExpiredFor }).stale) {
      return res.status(409).json({ error: "Cancel the task before deleting it.", status: row.status });
    }
    // A deleted task leaves nothing running or stored behind: previews come down, stored files go.
    let previewsRemoved = 0;
    for (const deployment of await listTaskDeployments(task.id, false)) {
      if (deployment.removedAt) continue;
      await destroyDeployment(deployment.id, "user").then(() => { previewsRemoved++; }).catch(error => console.error(`[agent] delete ${task.id}: preview ${deployment.id}:`, redact(error.message)));
    }
    const { rows: files } = await query<{ id: string }>("SELECT id FROM curialy.file_metadata WHERE session_id = $1", [task.id]);
    // Kept: storage refused the delete, or the copy lives in another storage account.
    let filesKept = 0;
    for (const file of files) await deleteMedia(file.id).then(result => { if (result === "kept") filesKept++; }, () => { filesKept++; });
    await withWorkspaceLock(task.id, async () => removeWorkspace(task.id));
    res.json({ deleted: await deleteAgentTask(task.id), previewsRemoved, filesRemoved: files.length - filesKept, filesKept });
  }));

  // Cancel only ever stops this task's run: no publishing, pushing, deploying or repository creation.
  router.post("/tasks/:id/cancel", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const { runId } = runRefSchema.parse(req.body ?? {});
    const result = await requestCancel(task.id, runId);
    res.status(result.status === "cancelling" ? 202 : 200).json(result);
  }));

  router.post("/tasks/:id/retry", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const { runId } = runRefSchema.parse(req.body ?? {});
    await oneAtATime(accountOf(req).id, async () => {
      if (!(await admitRun(req, res))) return;
      const started = await retryTask(task.id, { expectedRunId: runId === undefined ? undefined : runId });
      res.status(202).json({ status: "queued", ...started });
    });
  }));

  router.post("/tasks/:id/messages", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const input = followUpSchema.parse(req.body);
    const extras = await followUpExtras(task, input);
    await oneAtATime(accountOf(req).id, async () => {
      if (!(await admitRun(req, res))) return;
      const started = await followUp(task.id, input.prompt, await resolveAttachments(input.attachmentIds, accountOf(req).id), { clientMessageId: input.clientMessageId, expectedRunId: input.expectedRunId, ...extras });
      res.status(202).json({ ok: true, status: "queued", ...started });
    });
  }));

  // Follow-ups sent while a run is active: they wait, and start by themselves when it ends (queue.ts).
  // Credits and "one run at a time" are checked when each one starts, not here.
  router.post("/tasks/:id/queue", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const input = followUpSchema.parse(req.body);
    const extras = await followUpExtras(task, input, { queued: true });
    const item = await queueMessage(task.id, accountOf(req).id, { prompt: input.prompt, attachments: await resolveAttachments(input.attachmentIds, accountOf(req).id), clientMessageId: input.clientMessageId, ...extras });
    // The run may have ended while this was on its way: then it starts now.
    const drained = await drainQueue(task.id).catch(() => null);
    const fresh = await getAgentTask(task.id);
    res.status(201).json({ item, started: drained?.kind === "started" ? { runId: drained.runId, itemId: drained.itemId } : null, queue: fresh ? await listQueue(fresh) : { items: [item], held: null } });
  }));

  router.patch("/tasks/:id/queue/:item", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (!UUID.test(String(req.params.item))) return res.status(404).json({ error: "Queued message not found." });
    const input = queueEditSchema.parse(req.body);
    const item = await editQueued(task.id, String(req.params.item), input.prompt);
    if (!item) return res.status(409).json({ error: "That message already started (or was removed)." });
    res.json({ item, queue: await listQueue(task) });
  }));

  router.delete("/tasks/:id/queue/:item", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (!UUID.test(String(req.params.item))) return res.status(404).json({ error: "Queued message not found." });
    if (!(await removeQueued(task.id, String(req.params.item)))) return res.status(409).json({ error: "That message already started (or was removed)." });
    res.json({ removed: true, queue: await listQueue(task) });
  }));

  // Try a message that could not start again: back in line at its place.
  router.post("/tasks/:id/queue/:item/retry", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (!UUID.test(String(req.params.item))) return res.status(404).json({ error: "Queued message not found." });
    if (!(await requeue(task.id, String(req.params.item)))) return res.status(409).json({ error: "That message is not waiting to be tried again." });
    const drained = await drainQueue(task.id).catch(() => null);
    const fresh = await getAgentTask(task.id);
    res.json({ started: drained?.kind === "started" ? { runId: drained.runId, itemId: drained.itemId } : null, queue: await listQueue(fresh ?? task) });
  }));

  // Start the next waiting message now, also when the queue waits for the user (after a stop).
  router.post("/tasks/:id/queue/next", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const drained = await drainQueue(task.id, { force: true });
    if (drained.kind === "refused") return res.status(drained.refusal.status).json({ error: drained.refusal.error, code: drained.refusal.code, ...(drained.refusal.credits ? { credits: drained.refusal.credits } : {}) });
    if (drained.kind === "running" || drained.kind === "busy") return res.status(409).json({ error: "This task is still running; the next message starts when it ends." });
    if (drained.kind === "deferred") return res.status(409).json({ error: drained.error });
    const fresh = await getAgentTask(task.id);
    res.status(drained.kind === "started" ? 202 : 200).json({ started: drained.kind === "started" ? { runId: drained.runId, itemId: drained.itemId } : null, queue: await listQueue(fresh ?? task) });
  }));

  // The Deploy action: a confirmed, separate run that may publish one temporary private preview.
  // Operator only: a public preview is built from a repository in the operator's GitHub account and
  // hosted on the operator's hosting account, so it is never offered for other accounts' code.
  router.post("/tasks/:id/deploy", requireAdmin, handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const input = deploySchema.parse(req.body ?? {});
    if (!deployConfigured().ok) return res.status(409).json({ error: "Live previews are not configured on this server." });
    if (!(await getConnection(accountOf(req).id))) return res.status(409).json({ error: "Connect GitHub first: previews are built from a temporary private repository in your account." });
    const started = await startDeployRun(task.id, { expectedRunId: input.runId === undefined ? undefined : input.runId });
    res.status(202).json({ status: "queued", ...started });
  }));

  // Server-sent events. The first message is "sync" (the server's view: last persisted seq, status,
  // run); then everything after ?after=<seq> is replayed in order, then the live run streams. Live
  // events that arrive during the replay are buffered, so nothing is dropped or reordered.
  router.get("/tasks/:id/events", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const after = Number(req.query.after ?? req.headers["last-event-id"] ?? 0) || 0;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let closed = false;
    let ended = false;
    req.on("close", () => { closed = true; });
    res.on("error", () => { closed = true; });
    const write = (chunk: string) => { if (!closed && !res.writableEnded) res.write(chunk); };
    let lastSent = after;
    const send = (event: AgentEvent) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const end = () => {
      if (ended) return;
      ended = true;
      write("event: end\ndata: {}\n\n");
      if (!res.writableEnded) res.end();
    };
    const live = liveChannel(task.id);
    // A client that saw events this server never persisted (a worker died before writing them) is
    // ahead of maxSeq; it must reset and replay, or it would never see the terminal events.
    const maxSeq = Math.max(live?.seq ?? 0, await lastSeq(task.id));
    write(`event: sync\ndata: ${JSON.stringify({ maxSeq, status: task.status, statusReason: task.statusReason ?? null, runId: task.runId ?? null, live: Boolean(live) })}\n\n`);

    if (!live) {
      for (const event of await listEventsAfter(task.id, after)) send(event);
      // Another live worker runs this task (a second instance): follow its log until the run ends.
      if (isActiveStatus(task.status)) {
        const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
        try {
          for (let polls = 0; !closed && polls < 2400; polls++) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            for (const event of await listEventsAfter(task.id, lastSent)) send(event);
            const row = await getLifecycleRow(task.id);
            if (!row || isFinalStatus(row.status)) {
              for (const event of await listEventsAfter(task.id, lastSent)) send(event);
              break;
            }
            if (liveChannel(task.id)) break; // the run moved to this process: the client reconnects
          }
        } finally {
          clearInterval(heartbeat);
        }
      }
      return end();
    }
    let replaying = true;
    let closedDuringReplay = false;
    const buffered: AgentEvent[] = [];
    const onEvent = (event: AgentEvent) => (replaying ? buffered.push(event) : send(event));
    const onClosed = () => (replaying ? (closedDuringReplay = true) : end());
    live.emitter.on("event", onEvent);
    live.emitter.once("closed", onClosed);
    const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      live.emitter.off("event", onEvent);
      live.emitter.off("closed", onClosed);
    });
    const history = live.history.slice();
    const firstLive = history[0]?.seq ?? Number.POSITIVE_INFINITY;
    if (after + 1 < firstLive) for (const event of await listEventsAfter(task.id, after, firstLive)) send(event);
    for (const event of history) send(event);
    replaying = false;
    for (const event of buffered.sort((a, b) => a.seq - b.seq)) send(event);
    if (closedDuringReplay || live.closed) {
      clearInterval(heartbeat);
      end();
    }
  }));

  router.get("/tasks/:id/tree", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const dir = workspacePath(task.id);
    if (fs.existsSync(dir)) return res.json({ source: "live", entries: listWorkspaceTree(dir, ".", 8, 2000) });
    const files = await listWorkspaceSnapshot(task.id);
    const dirs = new Set<string>();
    for (const file of files) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    const entries = [
      ...Array.from(dirs).map(dirPath => ({ path: dirPath, type: "dir" as const, size: 0 })),
      ...files.map(file => ({ path: file.path, type: "file" as const, size: file.size_bytes })),
    ].sort((a, b) => a.path.localeCompare(b.path));
    res.json({ source: "archived", entries });
  }));

  router.get("/tasks/:id/file", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const requested = String(req.query.path ?? "");
    const mode = req.query.raw === "1" ? "raw" : req.query.download === "1" ? "download" : "json";
    const dir = workspacePath(task.id);
    let content: Buffer | undefined;
    let relative = requested;
    if (fs.existsSync(dir)) {
      const { absolute, relative: rel } = resolveInWorkspace(dir, requested);
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat?.isFile()) return res.status(404).json({ error: "File not found." });
      if (stat.size > MAX_VIEW_BYTES) return res.status(413).json({ error: `File is larger than ${MAX_VIEW_BYTES / 1024 / 1024} MB.` });
      relative = rel;
      const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { content = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
    } else {
      content = await readSnapshotFile(task.id, requested);
      if (!content) return res.status(404).json({ error: "File not found." });
    }
    const name = path.basename(relative).replace(/["\\\r\n]/g, "");
    if (mode === "download") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      return res.end(content);
    }
    if (mode === "raw") {
      // Inline rendering is limited to image types; anything else is offered as a download.
      // Workspace files are agent-controlled (an SVG can carry script), so the response is
      // sandboxed: no script execution, no same-origin access to this app.
      const mime = IMAGE_TYPES[path.extname(relative).slice(1).toLowerCase()];
      res.setHeader("Content-Type", mime ?? "application/octet-stream");
      res.setHeader("Content-Disposition", `${mime ? "inline" : "attachment"}; filename="${name}"`);
      res.setHeader("Content-Security-Policy", SANDBOX_CSP);
      res.setHeader("Cache-Control", "private, max-age=300");
      // Audio and video players ask for byte ranges (Safari plays nothing without them).
      if (mime && /^(audio|video)\//.test(mime)) {
        res.setHeader("Accept-Ranges", "bytes");
        const range = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(String(req.headers.range ?? ""));
        if (range && (range[1] || range[2])) {
          const size = content.length;
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (!(start <= end && end < size)) {
            res.setHeader("Content-Range", `bytes */${size}`);
            return res.status(416).end();
          }
          res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          return res.end(content.subarray(start, end + 1));
        }
      }
      return res.end(content);
    }
    // Text view: report binary content instead of returning mojibake.
    const binary = content.subarray(0, 8000).includes(0);
    if (binary) return res.json({ path: relative, content: "", bytes: content.length, binary: true });
    if (content.length > 2 * 1024 * 1024) return res.json({ path: relative, content: content.subarray(0, 2 * 1024 * 1024).toString("utf8"), bytes: content.length, truncated: true });
    res.json({ path: relative, content: content.toString("utf8"), bytes: content.length });
  }));

  // ---- Media (file storage) ----

  // A page of the account's files (newest first, 200 by default), with what the whole vault holds and
  // its limit. nextCursor continues the same filter; matching counts every file the filter matches.
  router.get("/media", handle(async (req, res) => {
    const user = accountOf(req);
    const params = mediaListQuery.parse(req.query);
    const filter = { kind: params.kind, q: params.q || undefined };
    const limit = params.limit ?? 200;
    const [storage, rows, vault, found] = await Promise.all([
      mediaStatus(),
      listMedia(user.id, { limit: limit + 1, filter, after: params.cursor ? parseCursor(params.cursor) : undefined }),
      vaultState(user),
      filter.q ? countMedia(user.id, filter) : null,
    ]);
    const page = rows.slice(0, limit);
    const files = page.map(({ createdAtUs: _cursor, ...file }) => file);
    const matching = found ?? (filter.kind ? vault.summary.byKind[filter.kind] : vault.summary.total);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      files, nextCursor: rows.length > limit ? cursorOf(page[page.length - 1]) : null, matching,
      summary: vault.summary, quota: vault.quota, stage: { ok: storage.ok, detail: storage.detail }, storage,
    });
  }));

  /** Every file the filter matches, by id (newest first, up to MAX_SELECT_IDS): "select all" and "delete all". */
  router.get("/media/ids", handle(async (req, res) => {
    const { kind, q } = mediaListQuery.parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json(await mediaIds(accountOf(req).id, { kind, q: q || undefined }, MAX_SELECT_IDS));
  }));

  // Delete up to DELETE_BATCH of the account's own files: each one's outcome. 503 only when storage is
  // down and so nothing at all could be deleted; one batch per account at a time.
  const deleting = new Set<string>();
  router.post("/media/delete", handle(async (req, res) => {
    const user = accountOf(req);
    const { ids } = mediaDeleteBody.parse(req.body ?? {});
    if (deleting.has(user.id)) {
      res.setHeader("Retry-After", "2");
      return res.status(429).json({ error: "Your other files are still being deleted.", code: "busy", retryAfter: 2 });
    }
    deleting.add(user.id);
    try {
      const result = await deleteFiles(user.id, ids);
      const nothing = !result.deleted.length && !result.kept.length;
      if (nothing && result.failed.length && result.failed.every(failure => failure.code === "storage_unavailable")) {
        const retryAfter = Math.max(5, result.retryAfter ?? 30);
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(503).json({ error: "File storage isn't available right now, so nothing was deleted.", code: "storage_unavailable", ...result, retryAfter });
      }
      res.json(result);
    } finally {
      deleting.delete(user.id);
    }
  }));

  /** Storage health from memory; ?probe=1 runs one real check (rate-limited server-side). */
  router.get("/media/health", handle(async (req, res) => {
    const health = await mediaStatus(req.query.probe === "1");
    res.setHeader("Cache-Control", "no-store");
    res.json(health);
  }));

  // Refuse before buffering 25 MB in memory when storage is known to be down.
  const uploadGuard = (_req: Request, res: Response, next: NextFunction) => {
    try {
      assertStorageAvailable();
      next();
    } catch (error) {
      if (error instanceof StorageError) {
        const retryAfter = Math.max(5, error.retryAfterSec || 30);
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(503).json({ error: `${error.message} You can still send your message without attachments.`, code: "storage_unavailable", retryAfter });
      }
      next(error);
    }
  };
  const uploadOne = (req: Request, res: Response, next: NextFunction) => upload.single("file")(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Files are limited to 25 MB." : "Attach one file at a time.", code: error.code === "LIMIT_FILE_SIZE" ? "too_large" : "bad_upload" });
    next(error);
  });

  // Accounts other than the operator: at most UPLOADS_AT_ONCE uploads in memory each (the slot is
  // taken before anything is awaited, so a burst can't pass it), and a free vault is refused before
  // 25 MB is buffered (from the declared size). A plan's vault has no limit.
  const uploading = new Map<string, number>();
  const uploadQuota = (req: Request, res: Response, next: NextFunction) => {
    const user = accountOf(req);
    if (user.role === "admin") return next();
    const held = uploading.get(user.id) ?? 0;
    if (held >= UPLOADS_AT_ONCE) {
      res.setHeader("Retry-After", "2");
      return res.status(429).json({ error: "Wait for your other uploads to finish.", code: "busy", retryAfter: 2 });
    }
    uploading.set(user.id, held + 1);
    let released = false;
    res.on("close", () => {
      if (released) return;
      released = true;
      const left = (uploading.get(user.id) ?? 1) - 1;
      if (left > 0) uploading.set(user.id, left);
      else uploading.delete(user.id);
    });
    void vaultState(user).then(({ summary, quota }) => {
      if (vaultFull(summary, quota, Number(req.headers["content-length"]) || 0, 64 * 1024)) return res.status(413).json(vaultFullError(quota));
      next();
    }, next);
  };

  router.post("/media", uploadGuard, uploadQuota, uploadOne, handle(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Attach a file up to 25 MB." });
    const user = accountOf(req);
    if (user.role !== "admin") {
      // Again with the real size, now that it's known (another upload may have finished meanwhile).
      const { summary, quota } = await vaultState(user);
      if (vaultFull(summary, quota, req.file.size)) return res.status(413).json(vaultFullError(quota));
    }
    const stored = await storeMedia({ buffer: req.file.buffer, filename: path.basename(req.file.originalname), mimeType: req.file.mimetype || "application/octet-stream", kind: "upload", userId: user.id });
    res.status(201).json({ file: { id: stored.id, filename: stored.filename, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, kind: stored.kind } });
  }));

  /** Whether snapshotFallback would serve this file (size check only, no bytes read). */
  async function snapshotMatches(media: NonNullable<Awaited<ReturnType<typeof getMedia>>>) {
    if (media.kind !== "artifact" || !media.session_id || !media.source_path) return false;
    const { rows } = await query<{ size_bytes: number }>("SELECT size_bytes FROM curialy.workspace_files WHERE session_id = $1 AND path = $2", [media.session_id, media.source_path]).catch(() => ({ rows: [] as { size_bytes: number }[] }));
    return rows[0]?.size_bytes === media.size_bytes;
  }

  /** An artifact whose stored copy is gone or unreachable, served from the task's archived workspace when it matches. */
  async function snapshotFallback(media: NonNullable<Awaited<ReturnType<typeof getMedia>>>) {
    if (media.kind !== "artifact" || !media.session_id || !media.source_path) return null;
    const content = await readSnapshotFile(media.session_id, media.source_path).catch(() => undefined);
    return content && content.length === media.size_bytes ? content : null;
  }

  const mediaHeaders = (res: Response, media: { id: string; filename: string; mime_type: string }, download: boolean) => {
    const image = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(media.mime_type); // SVG is safe under the sandbox CSP
    const pdf = media.mime_type === "application/pdf";
    // Played by <audio>/<video> on this origin (never run as a document: the sandbox CSP still applies).
    const playable = /^(audio\/(mpeg|mp4|aac|ogg|wav|webm|flac)|video\/(mp4|webm))$/.test(media.mime_type);
    const inline = !download && (image || pdf || playable);
    if (playable) res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", inline ? media.mime_type : "application/octet-stream");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${media.filename.replace(/["\\\r\n]/g, "")}"`);
    // Agent-produced content: no script, no same-origin access. Chrome's PDF viewer will not render
    // inside a CSP sandbox, so PDFs get a script-free policy instead.
    res.setHeader("Content-Security-Policy", pdf && inline ? PDF_CSP : SANDBOX_CSP);
    if (pdf && inline) res.setHeader("X-Frame-Options", "SAMEORIGIN"); // allow the in-app PDF viewer
    // Stored objects never change (one id, one object): cache them for good.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("ETag", `"${media.id}"`);
  };

  /** Explains a failed <img> without touching storage: from the row and the storage breaker only. */
  router.head("/media/:id", handle(async (req, res) => {
    const media = await mediaFor(req);
    if (!media) return res.status(404).end();
    const health = await mediaStatus();
    // Same answer as GET: an artifact whose archived workspace copy matches is served from there.
    const elsewhere = media.state !== "missing" && isElsewhere(media);
    if ((media.state === "missing" || elsewhere || !health.ok) && (await snapshotMatches(media))) return res.status(200).end();
    if (media.state === "missing" || elsewhere) return res.status(410).end();
    if (!health.ok) {
      res.setHeader("Retry-After", String(Math.max(5, health.retryAfter || 30)));
      return res.status(503).end();
    }
    res.status(200).end();
  }));

  // Streams through this origin (white-label: the storage host never appears in the browser).
  // 404 unknown, 410 gone, 503 storage unavailable (with Retry-After); never a 500 for storage.
  router.get("/media/:id", handle(async (req, res) => {
    const media = await mediaFor(req);
    if (!media) return res.status(404).json({ error: "Not found.", code: "media_not_found" });
    const download = req.query.download === "1";
    if (req.headers["if-none-match"] === `"${media.id}"`) return res.status(304).end();
    const fallback = async (error: StorageError) => {
      const content = await snapshotFallback(media);
      if (!content) return sendStorageError(res, error);
      mediaHeaders(res, media, download);
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.end(content);
    };
    if (media.state === "missing") return fallback(new StorageError("object_missing"));
    const abort = new AbortController();
    req.on("close", () => abort.abort());
    let upstream: globalThis.Response;
    try {
      // openMedia never looks up another account's file, and never reports an unrecorded one as missing.
      // Audio and video players ask for byte ranges (Safari plays nothing without them).
      const range = typeof req.headers.range === "string" && /^bytes=(\d{1,15}-\d{0,15}|-\d{1,15})$/.test(req.headers.range) ? req.headers.range : undefined;
      upstream = await openMedia(media, abort.signal, range);
    } catch (error) {
      if (abort.signal.aborted) return; // the viewer went away; nothing to answer
      if (!(error instanceof StorageError)) throw error;
      if (error.kind === "object_missing") await markMediaMissing(media.id).catch(() => undefined);
      return fallback(error);
    }
    mediaHeaders(res, media, download);
    const length = upstream.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    if (upstream.status === 206) {
      res.status(206);
      const contentRange = upstream.headers.get("content-range");
      if (contentRange) res.setHeader("Content-Range", contentRange);
    }
    try {
      await pipeline(Readable.fromWeb(upstream.body as never), res);
    } catch (error) {
      // A broken upstream or a client that went away: end this response, never the process.
      if (!abort.signal.aborted) console.error(`[vault] stream ${media.id} interrupted: ${redact(error instanceof Error ? error.message : String(error))}`);
      if (!res.headersSent) sendStorageError(res, new StorageError("unreachable"));
      else res.destroy();
    }
  }));

  // Text preview (Markdown, code, CSV, JSON...): first 512 KB as JSON, binary content refused.
  router.get("/media/:id/text", handle(async (req, res) => {
    const media = await mediaFor(req);
    if (!media) return res.status(404).json({ error: "Not found.", code: "media_not_found" });
    if (media.size_bytes > 5 * 1024 * 1024) return res.status(413).json({ error: "Too large to preview; download it instead." });
    let buffer: Buffer | null = null;
    if (media.state !== "missing") {
      try {
        const upstream = await openMedia(media);
        buffer = Buffer.from(await upstream.arrayBuffer());
      } catch (error) {
        if (!(error instanceof StorageError)) throw error;
        if (error.kind === "object_missing") await markMediaMissing(media.id).catch(() => undefined);
        buffer = await snapshotFallback(media);
        if (!buffer) return sendStorageError(res, error);
      }
    } else {
      buffer = await snapshotFallback(media);
      if (!buffer) return sendStorageError(res, new StorageError("object_missing"));
    }
    if (buffer.subarray(0, 8000).includes(0)) return res.status(415).json({ error: "Binary file; download it instead." });
    const limit = 512 * 1024;
    res.json({ filename: media.filename, content: buffer.subarray(0, limit).toString("utf8"), truncated: buffer.length > limit, bytes: buffer.length });
  }));

  router.delete("/media/:id", handle(async (req, res) => {
    const media = await mediaFor(req);
    const deleted = media ? await deleteMedia(media.id) : false;
    if (!deleted) return res.status(404).json({ error: "Not found.", code: "media_not_found" });
    // kept: the record is gone, but the stored copy is in another storage account (not removed there).
    res.json({ deleted: true, kept: deleted === "kept" });
  }));

  // ---- Voice ----

  // Dictation: a recording from the composer to text (charged per audio minute).
  router.post("/voice/transcribe", (req, res, next) => dictationUpload.single("audio")(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? `Recordings are limited to ${Math.round(MAX_DICTATION_BYTES / 1024 / 1024)} MB (about ${MAX_DICTATION_SECONDS / 60} minutes).` : "Send one recording at a time.", code: error.code === "LIMIT_FILE_SIZE" ? "too_large" : "bad_upload" });
    next(error);
  }), handle(async (req, res) => {
    if (!req.file?.buffer.length) return res.status(400).json({ error: "The recording was empty. Try again.", code: "empty" });
    // Paid for the longest this recording could be, so a low bit rate can't stretch a few credits.
    const release = await voiceAllowed(req, res, voiceCredits({ seconds: worstCaseSeconds(req.file.buffer.length) }));
    if (!release) return;
    try {
      const user = accountOf(req);
      // The language is detected: speakers often dictate in a language other than the browser's.
      const transcript = await transcribe(req.file.buffer, req.file.mimetype || "audio/webm");
      await charge(user.id, voiceCredits({ seconds: transcript.seconds }), null, `dictation (${Math.round(transcript.seconds)} s)`).catch(error => console.error("[voice] charge:", error instanceof Error ? error.message : error));
      res.setHeader("Cache-Control", "no-store");
      res.json({ text: transcript.text, seconds: transcript.seconds, language: transcript.language });
    } finally {
      release();
    }
  }));

  // Read aloud: an answer's prose as speech (code, tables and links are skipped), charged per character.
  router.post("/tasks/:id/speech", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const input = speechSchema.parse(req.body ?? {});
    // Limits first (cheap), then the text: the most it could cost is READ_ALOUD_MAX_CHARS of speech.
    const release = await voiceAllowed(req, res, voiceCredits({ characters: Math.min(input.text.length, READ_ALOUD_MAX_CHARS) }));
    if (!release) return;
    try {
      const spoken = speakableText(input.text).slice(0, READ_ALOUD_MAX_CHARS);
      if (!spoken) return res.status(400).json({ error: "There's nothing to read aloud in that answer.", code: "empty" });
      // The listener left: stop synthesizing (res "close" fires when the connection goes away).
      const abort = new AbortController();
      res.on("close", () => { if (!res.writableFinished) abort.abort(); });
      const speech = await speakStandard(spoken, input.voice, abort.signal);
      await charge(accountOf(req).id, voiceCredits({ characters: spoken.length }), task.id, `read aloud (${spoken.length} characters)`).catch(error => console.error("[voice] charge:", error instanceof Error ? error.message : error));
      res.setHeader("Content-Type", speech.mimeType);
      res.setHeader("Content-Length", String(speech.audio.length));
      res.setHeader("Cache-Control", "no-store");
      res.end(speech.audio);
    } finally {
      release();
    }
  }));

  // ---- GitHub ----

  router.get("/github", handle(async (req, res) => {
    const connection = await getConnection(accountOf(req).id);
    const granted = new Set((connection?.scopes ?? "").split(/[,\s]+/).filter(Boolean));
    res.json({
      configured: oauthConfigured(),
      connected: Boolean(connection),
      login: connection?.login ?? null,
      name: connection?.name ?? null,
      avatarUrl: connection?.avatarUrl ?? null,
      scopes: Array.from(granted),
      missingScopes: connection ? GITHUB_SCOPES.filter(scope => !granted.has(scope)) : [],
      connectedAt: connection?.connectedAt ?? null,
    });
  }));

  router.delete("/github", handle(async (req, res) => {
    await disconnect(accountOf(req).id);
    res.json({ disconnected: true });
  }));

  router.get("/github/repos", handle(githubReposHandler));

  // Attach one of the user's repositories to an idle task: fetch it into the workspace.
  router.post("/tasks/:id/repo", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isBusy(task.id) || isActiveStatus(task.status)) return res.status(409).json({ error: "Wait for the task to finish before selecting a repository." });
    // An exported task's columns name its export target: linking would overwrite them.
    if (task.githubRepo && task.githubMode !== "linked") return res.status(409).json({ error: `This task exports to ${task.githubRepo}; start a new task to work on a repository.` });
    const input = linkSchema.parse(req.body ?? {});
    const connection = await getConnection(accountOf(req).id);
    if (!connection) return res.status(409).json({ error: "Connect GitHub first." });
    const result = await withWorkspaceLock(task.id, async () => {
      const { dir } = await materializeWorkspace(task.id);
      const cloned = await cloneIntoWorkspace({ sessionId: task.id, root: dir, fullName: input.repo, branch: input.branch, token: connection.token });
      await query("UPDATE curialy.chat_sessions SET workspace_state = 'live', last_activity_at = now() WHERE id = $1", [task.id]);
      return cloned;
    });
    res.json({ repo: result.fullName, branch: result.branch, baseSha: result.baseSha, repoPath: result.repoPath, url: result.url, files: result.files });
  }));

  /** The files an export would publish (sources only, never uploads or local secrets). */
  async function exportFiles(taskId: string) {
    const dir = workspacePath(taskId);
    const all = fs.existsSync(dir) ? (await readWorkspaceFiles(dir)).files : (await loadWorkspaceSnapshot(taskId, ["source"])).map(file => ({ path: file.path, content: file.content }));
    const files = all.filter(file => !isPublishExcluded(file.path));
    return { files, excluded: all.filter(file => isPublishExcluded(file.path)).map(file => file.path) };
  }

  /** The commit an export last pushed to each branch of the task's repository. */
  async function exportedHeads(taskId: string) {
    const { rows } = await query<{ github_pushed: Record<string, string> | null }>("SELECT github_pushed FROM curialy.chat_sessions WHERE id = $1", [taskId]);
    return rows[0]?.github_pushed ?? {};
  }

  /**
   * The branch a re-export replaces, and whether its head is still the workspace's last push
   * ("ours"), has commits from elsewhere ("changed"), or can't be told ("unknown": no push was
   * recorded, or GitHub didn't answer). Anything but "ours" needs confirmOverwrite.
   */
  async function exportBranchState(token: string | undefined, taskId: string, fullName: string): Promise<{ branch: string | null; remote: "ours" | "changed" | "unknown" }> {
    if (!token) return { branch: null, remote: "unknown" };
    try {
      const { default_branch: branch } = await githubApi<{ default_branch: string }>(token, `/repos/${fullName}`);
      const [head, heads] = await Promise.all([branchHead(token, fullName, branch), exportedHeads(taskId)]);
      return { branch, remote: !heads[branch] ? "unknown" : heads[branch] === head ? "ours" : "changed" };
    } catch (error) {
      console.warn(`[agent] export plan: couldn't read ${fullName}: ${error instanceof Error ? redact(error.message) : "unknown error"}`);
      return { branch: null, remote: "unknown" };
    }
  }

  // What Export would do, for the confirmation dialog (no side effects).
  router.post("/tasks/:id/export/plan", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const connection = await getConnection(accountOf(req).id);
    const linked = await linkedRepo(task.id);
    if (linked) return res.json({ target: { kind: "linked", repo: linked.fullName, defaultBranch: linked.branch, url: linked.url }, login: connection?.login ?? null });
    const { files, excluded } = await exportFiles(task.id);
    res.json({
      target: task.githubRepo
        ? { kind: "existing", repo: task.githubRepo, url: task.githubRepoUrl ?? null, ...(await exportBranchState(connection?.token, task.id, task.githubRepo)) }
        : { kind: "new", owner: connection?.login ?? null, suggestedName: `curialy-${slugify(task.prompt)}` },
      files: files.length, bytes: files.reduce((sum, file) => sum + file.content.length, 0), excluded,
      login: connection?.login ?? null,
    });
  }));

  // Export the session's workspace to a repo in the connected account (re-export adds a commit).
  // For a linked repository this pushes the workspace changes back instead.
  router.post("/tasks/:id/export", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isBusy(task.id) || isActiveStatus(task.status)) return res.status(409).json({ error: "Wait for the task to finish before exporting." });
    const input = exportSchema.parse(req.body ?? {});
    const connection = await getConnection(accountOf(req).id);
    if (!connection) return res.status(409).json({ error: "Connect GitHub first." });
    const linked = await linkedRepo(task.id);
    if (linked) {
      const branch = input.branch?.trim();
      if (!branch) return res.status(400).json({ error: "Choose the branch to push to." });
      if (branch === linked.branch && !input.confirmDefaultBranch) return res.status(400).json({ error: `Pushing to ${linked.branch} needs explicit confirmation.`, code: "confirm_default_branch" });
      const pushed = await withWorkspaceLock(task.id, async () => {
        const { dir } = await materializeWorkspace(task.id);
        // No merge from the dialog: nobody would be there to resolve its conflicts.
        return commitAndPush({ sessionId: task.id, root: dir, repo: linked, token: connection.token, message: input.message || `Curialy AI: ${task.prompt.split("\n")[0].slice(0, 60)}`, branch, scopes: connection.scopes, autoSync: false });
      });
      if (pushed.nothingToPush) return res.json({ repo: linked.fullName, url: linked.url, commitUrl: linked.url, files: 0, created: false, nothingToPush: true });
      return res.json({ repo: linked.fullName, url: linked.url, commitUrl: pushed.commitUrl, files: pushed.changed + pushed.deleted, created: false, branch: pushed.branch });
    }
    const { files } = await exportFiles(task.id);
    if (!files.length) return res.status(409).json({ error: "This task has no files to export." });
    // GitHub takes workflow files only from a connection with the workflow permission: said before anything is created.
    const workflows = workflowFilesBlocked(files.map(file => file.path), connection.scopes);
    if (workflows.length) return res.status(409).json({ error: workflowScopeMessage(workflows), code: "github_reconnect" });
    let fullName = task.githubRepo;
    let created = false;
    if (!fullName) {
      const name = input.repoName?.trim();
      if (!name) return res.status(400).json({ error: "Name the new repository." });
      if (!isValidRepoName(name)) return res.status(422).json({ error: "Repository names may only contain letters, digits, '.', '-' and '_'." });
      if (!input.visibility) return res.status(400).json({ error: "Choose whether the new repository is private or public.", code: "visibility_required" });
      if (input.visibility === "public" && !input.confirmPublic) return res.status(400).json({ error: "Creating a public repository needs explicit confirmation.", code: "confirm_public" });
      const repo = await createRepo(connection.token, name, input.visibility !== "public", "Created by Curialy AI");
      fullName = repo.full_name;
      created = true;
      // Its first commit (GitHub's README) counts as the workspace's own, so a retry after a failed
      // push below replaces it without asking. Best effort: unrecorded, the retry asks first.
      const initial = await branchHead(connection.token, fullName, repo.default_branch).catch(() => null);
      // Recorded at once: if the push below fails, the next Export pushes into this repository
      // instead of trying to create it again (and nothing is left behind unrecorded).
      await query("UPDATE curialy.chat_sessions SET github_repo = $2, github_repo_url = $3, github_mode = 'export', github_pushed = $4::jsonb, updated_at = now() WHERE id = $1", [task.id, fullName, repo.html_url, JSON.stringify(initial ? { [repo.default_branch]: initial } : {})]);
    }
    // A re-export replaces the branch's files with the workspace's: only over the workspace's own
    // last push, unless the user confirmed replacing commits made elsewhere.
    const onlyOver = created || input.confirmOverwrite ? undefined : await exportedHeads(task.id);
    const pushed = await pushProjectToRepo(connection.token, fullName, files, created ? "Initial export from Curialy AI" : "Update from Curialy AI", { onlyOver });
    await query(
      "UPDATE curialy.chat_sessions SET github_repo = $2, github_repo_url = $3, github_pushed_at = now(), github_pushed = github_pushed || jsonb_build_object($4::text, $5::text), github_mode = 'export', updated_at = now() WHERE id = $1",
      [task.id, fullName, pushed.repoUrl, pushed.branch, pushed.commitSha],
    );
    res.json({ repo: fullName, url: pushed.repoUrl, commitUrl: pushed.commitUrl, files: files.length, created, branch: pushed.branch });
  }));

  // ---- Workspace preview (served by this app; see preview.ts) ----

  async function findPreview(taskId: string, dir?: string) {
    if (dir) return detectPreviewRoot(taskId, dir);
    const root = workspacePath(taskId);
    if (!fs.existsSync(root)) return null;
    const repo = await linkedRepo(taskId);
    if (repo && repo.repoPath !== ".") {
      for (const candidate of ["dist", "build", "out"]) {
        const found = detectPreviewRoot(taskId, path.join(repo.repoPath, candidate));
        if (found) return found;
      }
    }
    // Built output first (also nested, e.g. frontend/dist), then a plain static site; never an
    // unbuilt dev-server template (it would render blank).
    const built = findBuildDirs(root)[0];
    if (built) return detectPreviewRoot(taskId, built);
    for (const candidate of ["public", "."]) {
      const found = detectPreviewRoot(taskId, candidate);
      if (found && !isUnbuiltTemplate(fs.readFileSync(path.join(found.absolute, "index.html"), "utf8"))) return found;
    }
    return null;
  }

  router.get("/tasks/:id/preview", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const live = fs.existsSync(workspacePath(task.id));
    const site = live ? await findPreview(task.id, typeof req.query.dir === "string" && req.query.dir ? req.query.dir : undefined) : null;
    if (!site) {
      // The truth about an archived workspace comes from its snapshot, not from the empty scratch dir.
      const build = live ? null : await findArchivedBuild(task.id);
      return res.json({ available: false, workspace: live, archived: !live, build, restorable: !live && !isBusy(task.id), running: isRunning(task.id) });
    }
    const warnings = absoluteAssetWarnings(fs.readFileSync(path.join(site.absolute, "index.html"), "utf8"));
    // Relative URL for the iframe (same origin as the UI); the token is short-lived, task-scoped and
    // carries the build folder, so the site's relative assets load from the same folder.
    const url = new URL(previewBaseUrl(task.id, undefined, site.dir)).pathname;
    res.json({ available: true, workspace: true, dir: site.dir, url, warnings });
  }));

  // Bring an archived workspace back (for previews and file views) without starting a run.
  router.post("/tasks/:id/workspace/restore", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isBusy(task.id) || isActiveStatus(task.status)) return res.status(409).json({ error: "The task is running; its workspace is already live." });
    const { restored } = await restoreWorkspace(task.id);
    const site = await findPreview(task.id);
    res.json({ restored, preview: site ? { dir: site.dir } : null });
  }));

  router.post("/tasks/:id/preview/screenshot", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isRunning(task.id)) return res.status(409).json({ error: "Wait for the run to finish; the agent is using the browser." });
    // Each screenshot opens a cloud browser: capped for free accounts.
    const user = accountOf(req);
    if (user.role !== "admin" && rateLimited(`screenshot:${user.id}`, 10)) return res.status(429).json({ error: "That's a lot of screenshots. Wait a few minutes, then try again.", code: "busy" });
    const site = await findPreview(task.id);
    if (!site) return res.status(404).json({ error: "No built web output to screenshot." });
    const result = await browse({ url: previewBaseUrl(task.id, undefined, site.dir), screenshot: true, fullPage: true, waitMs: 1500, signal: AbortSignal.timeout(120_000) });
    res.json({
      status: result.status, title: result.title, consoleErrors: result.consoleErrors,
      image: result.screenshot ? `data:image/jpeg;base64,${result.screenshot.toString("base64")}` : null,
    });
  }));

  // ---- Live browser sessions ----

  router.get("/tasks/:id/browser/:sessionId", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(viewerFor(req, await sessionStatus(task.id, String(req.params.sessionId), req.query.fresh === "1")));
  }));

  // Reconnect the live view: only a session this process still drives is live. Anything else has
  // ended; if the log still shows it live, the log is corrected.
  const reconnects = new Map<string, number>();
  router.post("/tasks/:id/browser/:sessionId/reconnect", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const sessionId = String(req.params.sessionId);
    const key = `${task.id}:${sessionId}`;
    if (Date.now() - (reconnects.get(key) ?? 0) < 5000) return res.status(429).json({ error: "Wait a few seconds before reconnecting again." });
    reconnects.set(key, Date.now());
    const status = viewerFor(req, await sessionStatus(task.id, sessionId, true));
    if (status.status === "live") return res.json(status);
    const events = await listEventsAfter(task.id, 0).catch(() => [] as AgentEvent[]);
    const last = [...events].reverse().find(event => event.type === "browser_session" && event.sessionId === sessionId);
    if (last && last.type === "browser_session" && last.status === "live") {
      const ended: AgentEventBody = { type: "browser_session", sessionId, status: "ended", liveUrl: null, replayUrl: "", reason: isRunning(task.id) ? "disconnected" : "interrupted" };
      await appendTaskEvent(task.id, ended).catch(() => undefined);
    }
    res.status(410).json(status);
  }));

  // ---- Live previews (cloud deploys) ----

  router.get("/tasks/:id/deployments", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    res.setHeader("Cache-Control", "no-store");
    const user = accountOf(req);
    const github = await getConnection(user.id).then(Boolean).catch(() => false);
    // allowed: public previews are an operator feature (see POST /tasks/:id/deploy).
    res.json({ deployments: await listTaskDeployments(task.id, isRunning(task.id)), capabilities: { configured: deployConfigured().ok, github, allowed: user.role === "admin" } });
  }));

  // Links and frames point here instead of at the hosting provider: a redirect while the preview is
  // live, a clear "gone" page once it expired or was taken down.
  router.get("/tasks/:id/deployments/:deploymentId/open", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const id = String(req.params.deploymentId);
    const view = /^[0-9a-f-]{36}$/i.test(id) ? (await listTaskDeployments(task.id, isRunning(task.id))).find(item => item.id === id) : undefined;
    res.setHeader("Cache-Control", "no-store");
    // The preview itself decides whether it can be framed (the app shell's policies forbid framing).
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    if (view?.state === "live" && view.url && /^https:\/\//.test(view.url)) return res.redirect(302, view.url);
    res.status(410).type("html").send(`<!doctype html><meta charset="utf-8"><title>Preview unavailable</title><body style="font:15px system-ui;padding:2rem;color:#14130f;background:#f3efe6">This preview is no longer live (${view ? view.state : "not found"}). Start a new one from the task's Preview tab.</body>`);
  }));

  router.delete("/tasks/:id/deployments/:deploymentId", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const id = String(req.params.deploymentId);
    if (!/^[0-9a-f-]{36}$/i.test(id) || (await deploymentSession(id)) !== task.id) return res.status(404).json({ error: "Not found." });
    await destroyDeployment(id, "user");
    res.json({ deployments: await listTaskDeployments(task.id, isRunning(task.id)) });
  }));

  router.get("/deployments", requireAdmin, handle(async (_req, res) => res.json({ deployments: await listDeployments(), configured: { ok: deployConfigured().ok } })));

  router.delete("/deployments/:id", requireAdmin, handle(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: "Not found." });
    res.json({ deleted: await destroyDeployment(id, "user") });
  }));

  return router;
}

const slugify = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
