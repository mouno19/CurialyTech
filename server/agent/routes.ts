import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { MODELS, type AgentEvent } from "@shared/agent";
import { deleteMedia, getMedia, listMedia, mediaStatus, presignedUrl, storeMedia } from "../media/snowflake";
import { isLive, liveChannel } from "./bus";
import { deployConfigured, destroyDeployment, listDeployments } from "./deploy";
import { PROVIDER_ENV, probeProviders } from "./providers";
import { activeTaskCount, cancelTask, followUp, isRunning, startTask, TaskRejected } from "./runner";
import { listWorkspaceTree, readWorkspaceFile, removeWorkspace, resolveInWorkspace, SandboxError, workspacePath } from "./sandbox";
import { agentStats, deleteAgentTask, getAgentTask, listAgentTasks, listEventsAfter, listWorkspaceSnapshot, loadWorkspaceSnapshot, readSnapshotFile } from "./store";
import { collectWorkspaceFiles } from "./workspaces";
import { query } from "../db/pg";
import { createRepo, disconnect, getConnection, GITHUB_SCOPES, GitHubError, isValidRepoName, listRepos, oauthConfigured, pushProjectToRepo } from "../services/github";
import { cloneIntoWorkspace, commitAndPush, linkedRepo } from "./repos";
import { materializeWorkspace } from "./workspaces";
import { absoluteAssetWarnings, detectPreviewRoot, previewBaseUrl } from "./preview";
import { browse } from "./browser";

const createSchema = z.object({
  prompt: z.string().trim().min(2, "Describe what you want to accomplish.").max(20_000),
  model: z.string().trim().max(120).default("auto"),
  mode: z.enum(["agent", "chat"]).default("agent"),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  webSearch: z.boolean().default(false),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Repository must be owner/name").nullish(),
  repoBranch: z.string().trim().max(200).nullish(),
});
const linkSchema = z.object({ repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), branch: z.string().trim().max(200).optional() });

const followUpSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) });
const exportSchema = z.object({ repoName: z.string().trim().max(100).optional(), private: z.boolean().default(true), message: z.string().trim().max(2000).optional(), branch: z.string().trim().max(200).optional() });

/** GET repositories for the picker: the shape the UI (and /api/github/repos) promises. */
export async function githubReposHandler(_req: Request, res: Response) {
  const connection = await getConnection();
  if (!connection) return res.status(409).json({ error: "Connect GitHub first.", repos: [] });
  const repos = await listRepos(connection.token, 50);
  res.json({ login: connection.login, repos: repos.map(({ id, name, full_name, private: isPrivate, default_branch, description, updated_at, language }) => ({ id, name, full_name, private: isPrivate, default_branch, description, updated_at, language })) });
}

const slugify = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

// Uploads are held in memory and streamed straight to the Snowflake stage; they never touch the VPS disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
  if (error instanceof TaskRejected) return res.status(409).json({ error: error.message });
  if (error instanceof SandboxError) return res.status(400).json({ error: error.message });
  if (error instanceof GitHubError) return res.status(error.status === 422 ? 422 : 502).json({ error: error.message });
  console.error("[agent]", error);
  return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
}

/** Wrap async handlers so rejections become JSON errors instead of hanging requests. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => (res.headersSent ? res.end() : sendError(res, error)));
};

async function taskOr404(req: Request, res: Response) {
  const task = await getAgentTask(String(req.params.id));
  if (!task) res.status(404).json({ error: "Task not found." });
  return task;
}

let healthCache: { at: number; result: Awaited<ReturnType<typeof probeProviders>> } | null = null;

export function agentRouter() {
  const router = Router();

  router.get("/models", (_req, res) => res.json({ models: MODELS }));

  router.get("/health", handle(async (req, res) => {
    const deep = req.query.deep === "1";
    if (!deep && healthCache && Date.now() - healthCache.at < 20_000) return res.json({ providers: healthCache.result, activeTasks: activeTaskCount() });
    const [providers, media, database] = await Promise.all([
      probeProviders(deep),
      mediaStatus(deep).then(status => ({ id: "media", label: "Snowflake media stage", ok: status.ok, latencyMs: 0, detail: status.detail, configured: Boolean(process.env.SNOWFLAKE_PAT) })),
      (async () => {
        const started = Date.now();
        try {
          await agentStats();
          return { id: "tiger", label: "Tiger Cloud (PostgreSQL)", ok: true, latencyMs: Date.now() - started, detail: "Connected", configured: true };
        } catch (error) {
          return { id: "tiger", label: "Tiger Cloud (PostgreSQL)", ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : "error", configured: Boolean(process.env.TIGER_DATABASE_URL) };
        }
      })(),
    ]);
    const result = [database, ...providers, media];
    if (!deep) healthCache = { at: Date.now(), result };
    res.json({ providers: result, activeTasks: activeTaskCount() });
  }));

  router.get("/keys", (_req, res) => {
    const mask = (value: string | undefined) => (value ? `••••${value.slice(-4)}` : null);
    const env = process.env;
    res.json({
      keys: [
        { id: "tiger", label: "Tiger Cloud connection", envVar: "TIGER_DATABASE_URL", location: "/etc/curialyai.env", configured: Boolean(env.TIGER_DATABASE_URL), masked: env.TIGER_DATABASE_URL ? new URL(env.TIGER_DATABASE_URL).host : null },
        { id: "cortex", label: "Snowflake PAT", envVar: "SNOWFLAKE_PAT", location: "/etc/curialyai.env + /etc/snowflake-proxy.env", configured: Boolean(env.SNOWFLAKE_PAT), masked: mask(env.SNOWFLAKE_PAT), note: "Model calls go through the local bridge; the app uses the PAT directly only for the media stage." },
        { id: "paper", label: "Paper Instruments API key", envVar: "PAPER_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.paperKey), masked: mask(PROVIDER_ENV.paperKey) },
        { id: "relay", label: "RelayStation API key", envVar: "RELAY_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.relayKey), masked: mask(PROVIDER_ENV.relayKey) },
        { id: "browserbase", label: "Browserbase API key", envVar: "BROWSERBASE_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.browserbaseKey), masked: mask(PROVIDER_ENV.browserbaseKey) },
        { id: "render", label: "Render API key", envVar: "RENDER_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.renderKey), masked: mask(PROVIDER_ENV.renderKey) },
        { id: "github-oauth", label: "GitHub OAuth app", envVar: "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET", location: "/etc/curialyai.env", configured: oauthConfigured(), masked: env.GITHUB_CLIENT_ID ?? null, note: "The connected account's token is stored AES-256-GCM encrypted in Tiger (key: GITHUB_TOKEN_KEY)." },
        { id: "manus", label: "Manus API key", envVar: "MANUS_AGENT_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.manusKey), masked: mask(PROVIDER_ENV.manusKey) },
        { id: "tinker", label: "Thinking Machines Tinker key", envVar: "TINKER_API_KEY", location: "/etc/curialyai.env", configured: Boolean(env.TINKER_API_KEY), masked: mask(env.TINKER_API_KEY), note: "Stored for fine-tuning; no Tinker models are routable yet." },
        { id: "session", label: "Session signing secret", envVar: "SESSION_SECRET", location: "/etc/curialyai.env", configured: (env.SESSION_SECRET ?? "").length >= 32, masked: env.SESSION_SECRET ? "set" : null },
        { id: "admin", label: "Admin password hash", envVar: "ADMIN_PASSWORD_HASH", location: "/etc/curialyai.env", configured: Boolean(env.ADMIN_PASSWORD_HASH), masked: env.ADMIN_PASSWORD_HASH ? "scrypt" : null },
      ],
    });
  });

  router.get("/stats", handle(async (_req, res) => res.json({ ...(await agentStats()), active: activeTaskCount() })));

  router.get("/tasks", handle(async (_req, res) => res.json({ tasks: await listAgentTasks() })));

  router.post("/tasks", handle(async (req, res) => {
    const input = createSchema.parse(req.body);
    const attachments = [];
    for (const id of input.attachmentIds) {
      const media = await getMedia(id);
      if (!media) throw new TaskRejected(`Attachment ${id} not found.`);
      attachments.push({ filename: media.filename, stagePath: media.stage_path });
    }
    const taskId = await startTask(input, attachments);
    res.status(201).json({ taskId });
  }));

  router.get("/tasks/:id", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (task) res.json({ task, live: isLive(task.id) });
  }));

  router.delete("/tasks/:id", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isRunning(task.id) || isLive(task.id)) return res.status(409).json({ error: "Cancel the task before deleting it." });
    removeWorkspace(task.id);
    res.json({ deleted: await deleteAgentTask(task.id) });
  }));

  router.post("/tasks/:id/cancel", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (task) res.json({ cancelled: cancelTask(task.id) });
  }));

  router.post("/tasks/:id/messages", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    await followUp(task.id, followUpSchema.parse(req.body).prompt);
    res.status(202).json({ ok: true });
  }));

  // Server-sent events: replay everything after ?after=<seq>, then stream live until the run ends.
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
    let lastSent = after;
    const send = (event: AgentEvent) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const end = () => {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    };
    const live = liveChannel(task.id);
    if (!live) {
      for (const event of await listEventsAfter(task.id, after)) send(event);
      return end();
    }
    // Live run: everything committed so far is in memory (the database may still be catching up).
    const onEvent = (event: AgentEvent) => send(event);
    const onClosed = () => end();
    live.emitter.on("event", onEvent);
    live.emitter.once("closed", onClosed);
    const firstLive = live.history[0]?.seq ?? Number.POSITIVE_INFINITY;
    if (after + 1 < firstLive) for (const event of await listEventsAfter(task.id, after)) if (event.seq < firstLive) send(event);
    for (const event of live.history) send(event);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      live.emitter.off("event", onEvent);
      live.emitter.off("closed", onClosed);
    });
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
    const dir = workspacePath(task.id);
    let content: Buffer | undefined;
    let relative = requested;
    if (fs.existsSync(dir)) {
      const { absolute, relative: rel } = resolveInWorkspace(dir, requested);
      const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
      if (!stat?.isFile()) return res.status(404).json({ error: "File not found." });
      relative = rel;
      if (req.query.download === "1") content = fs.readFileSync(absolute);
      else {
        const file = readWorkspaceFile(dir, requested);
        content = Buffer.from(file.exists ? file.content : "");
      }
    } else {
      content = await readSnapshotFile(task.id, requested);
      if (!content) return res.status(404).json({ error: "File not found." });
    }
    if (req.query.download === "1") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(relative).replace(/"/g, "")}"`);
      return res.end(content);
    }
    res.json({ path: relative, content: content.toString("utf8"), bytes: content.length });
  }));

  // ---- Media (Snowflake stage) ----

  router.get("/media", handle(async (_req, res) => res.json({ files: await listMedia(), stage: await mediaStatus() })));

  router.post("/media", upload.single("file"), handle(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Attach a file up to 25 MB." });
    const status = await mediaStatus();
    if (!status.ok) return res.status(503).json({ error: `Media storage is not ready: ${status.detail}` });
    const stored = await storeMedia({ buffer: req.file.buffer, filename: path.basename(req.file.originalname), mimeType: req.file.mimetype || "application/octet-stream", kind: "upload" });
    res.status(201).json({ file: stored });
  }));

  // Redirect to a short-lived presigned URL so the browser loads bytes straight from Snowflake.
  router.get("/media/:id", handle(async (req, res) => {
    const media = await getMedia(String(req.params.id));
    if (!media) return res.status(404).json({ error: "Not found." });
    res.setHeader("Cache-Control", "private, max-age=600");
    res.redirect(302, await presignedUrl(media.stage_path, 3600));
  }));

  router.delete("/media/:id", handle(async (req, res) => res.json({ deleted: await deleteMedia(String(req.params.id)) })));

  // ---- GitHub ----

  router.get("/github", handle(async (_req, res) => {
    const connection = await getConnection();
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

  router.delete("/github", handle(async (_req, res) => {
    await disconnect();
    res.json({ disconnected: true });
  }));

  router.get("/github/repos", handle(githubReposHandler));

  // Attach one of the user's repositories to an idle task: fetch it into the workspace.
  router.post("/tasks/:id/repo", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isRunning(task.id)) return res.status(409).json({ error: "Wait for the task to finish before selecting a repository." });
    const input = linkSchema.parse(req.body ?? {});
    const connection = await getConnection();
    if (!connection) return res.status(409).json({ error: "Connect GitHub first." });
    const { dir } = await materializeWorkspace(task.id);
    const result = await cloneIntoWorkspace({ sessionId: task.id, root: dir, fullName: input.repo, branch: input.branch, token: connection.token });
    await query("UPDATE curialy.chat_sessions SET workspace_state = 'live', last_activity_at = now() WHERE id = $1", [task.id]);
    res.json({ repo: result.fullName, branch: result.branch, baseSha: result.baseSha, repoPath: result.repoPath, url: result.url, files: result.files });
  }));

  // Export the session's workspace to a repo in the connected account (re-export adds a commit).
  // For a linked repository this pushes the workspace changes back instead.
  router.post("/tasks/:id/export", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    if (isRunning(task.id)) return res.status(409).json({ error: "Wait for the task to finish before exporting." });
    const input = exportSchema.parse(req.body ?? {});
    const connection = await getConnection();
    if (!connection) return res.status(409).json({ error: "Connect GitHub first." });
    const linked = await linkedRepo(task.id);
    if (linked) {
      const { dir } = await materializeWorkspace(task.id);
      const pushed = await commitAndPush({ sessionId: task.id, root: dir, repo: linked, token: connection.token, message: input.message || `Curialy AI: ${task.prompt.split("\n")[0].slice(0, 60)}`, branch: input.branch });
      if (pushed.nothingToPush) return res.json({ repo: linked.fullName, url: linked.url, commitUrl: linked.url, files: 0, created: false, nothingToPush: true });
      return res.json({ repo: linked.fullName, url: linked.url, commitUrl: pushed.commitUrl, files: pushed.changed + pushed.deleted, created: false, branch: pushed.branch });
    }
    const dir = workspacePath(task.id);
    const files = fs.existsSync(dir) ? collectWorkspaceFiles(dir).files : (await loadWorkspaceSnapshot(task.id)).map(file => ({ path: file.path, content: file.content }));
    if (!files.length) return res.status(409).json({ error: "This task has no files to export." });
    let fullName = task.githubRepo;
    let created = false;
    if (!fullName) {
      const name = input.repoName || `curialy-${slugify(task.prompt)}`;
      if (!isValidRepoName(name)) return res.status(422).json({ error: "Repository names may only contain letters, digits, '.', '-' and '_'." });
      const repo = await createRepo(connection.token, name, input.private, `Created by Curialy AI: ${task.prompt.slice(0, 200)}`);
      fullName = repo.full_name;
      created = true;
    }
    const pushed = await pushProjectToRepo(connection.token, fullName, files, created ? "Initial export from Curialy AI" : "Update from Curialy AI");
    await query("UPDATE curialy.chat_sessions SET github_repo = $2, github_repo_url = $3, github_pushed_at = now(), updated_at = now() WHERE id = $1", [task.id, fullName, pushed.repoUrl]);
    res.json({ repo: fullName, url: pushed.repoUrl, commitUrl: pushed.commitUrl, files: files.length, created });
  }));

  // ---- Workspace preview (served by this app; see preview.ts) ----

  async function findPreview(taskId: string, dir?: string) {
    if (dir) return detectPreviewRoot(taskId, dir);
    const repo = await linkedRepo(taskId);
    if (repo && repo.repoPath !== ".") {
      for (const candidate of ["dist", "build", "out", "public", "."]) {
        const found = detectPreviewRoot(taskId, path.join(repo.repoPath, candidate));
        if (found) return found;
      }
    }
    return detectPreviewRoot(taskId);
  }

  router.get("/tasks/:id/preview", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const site = await findPreview(task.id, typeof req.query.dir === "string" ? req.query.dir : undefined);
    if (!site) return res.json({ available: false, workspace: fs.existsSync(workspacePath(task.id)) });
    const warnings = absoluteAssetWarnings(fs.readFileSync(path.join(site.absolute, "index.html"), "utf8"));
    const query = site.dir === "." ? "" : `?dir=${encodeURIComponent(site.dir)}`;
    // Relative URL for the iframe (same origin as the UI); the token is short-lived and task-scoped.
    const url = new URL(previewBaseUrl(task.id)).pathname + query;
    res.json({ available: true, dir: site.dir, url, warnings });
  }));

  router.post("/tasks/:id/preview/screenshot", handle(async (req, res) => {
    const task = await taskOr404(req, res);
    if (!task) return;
    const site = await findPreview(task.id);
    if (!site) return res.status(404).json({ error: "No built web output to screenshot." });
    const query = site.dir === "." ? "" : `?dir=${encodeURIComponent(site.dir)}`;
    const result = await browse({ url: `${previewBaseUrl(task.id)}${query}`, screenshot: true, fullPage: true, waitMs: 1500, signal: AbortSignal.timeout(120_000) });
    res.json({
      status: result.status, title: result.title, consoleErrors: result.consoleErrors, replayUrl: result.replayUrl,
      image: result.screenshot ? `data:image/jpeg;base64,${result.screenshot.toString("base64")}` : null,
    });
  }));

  // ---- Live previews ----

  router.get("/deployments", handle(async (_req, res) => res.json({ deployments: await listDeployments(), configured: deployConfigured() })));

  router.delete("/deployments/:id", handle(async (req, res) => res.json({ deleted: await destroyDeployment(String(req.params.id)) })));

  return router;
}
