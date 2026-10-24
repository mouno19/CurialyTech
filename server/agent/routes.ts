import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { MODELS, type AgentEvent } from "@shared/agent";
import { db } from "../curialy-store";
import { channel, isLive } from "./bus";
import { PROVIDER_ENV, probeProviders } from "./providers";
import { activeTaskCount, cancelTask, followUp, startTask, TaskRejected } from "./runner";
import { listWorkspaceTree, readWorkspaceFile, resolveInWorkspace, SandboxError, workspacePath, WORKSPACE_ROOT } from "./sandbox";
import { agentStats, deleteAgentTask, getAgentTask, listAgentTasks, listEventsAfter } from "./store";

const createSchema = z.object({
  prompt: z.string().trim().min(2, "Describe what you want to accomplish.").max(20_000),
  model: z.string().trim().max(120).default("auto"),
  mode: z.enum(["agent", "chat"]).default("agent"),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  webSearch: z.boolean().default(false),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
});

const followUpSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) });

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
  if (error instanceof TaskRejected) return res.status(409).json({ error: error.message });
  if (error instanceof SandboxError) return res.status(400).json({ error: error.message });
  console.error("[agent]", error);
  return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
}

function taskOr404(req: Request, res: Response) {
  const task = getAgentTask(String(req.params.id));
  if (!task) res.status(404).json({ error: "Task not found." });
  return task;
}

let healthCache: { at: number; result: Awaited<ReturnType<typeof probeProviders>> } | null = null;

export function agentRouter() {
  const router = Router();

  router.get("/models", (_req, res) => res.json({ models: MODELS }));

  router.get("/health", async (req, res) => {
    const deep = req.query.deep === "1";
    if (!deep && healthCache && Date.now() - healthCache.at < 20_000) return res.json({ providers: healthCache.result, activeTasks: activeTaskCount() });
    const result = await probeProviders(deep);
    if (!deep) healthCache = { at: Date.now(), result };
    res.json({ providers: result, activeTasks: activeTaskCount() });
  });

  router.get("/keys", (_req, res) => {
    const mask = (value: string) => (value ? `••••${value.slice(-4)}` : null);
    res.json({
      keys: [
        { id: "cortex", label: "Snowflake Cortex PAT", envVar: "SNOWFLAKE_PAT", location: "/etc/snowflake-proxy.env (bridge)", configured: true, masked: "held by bridge", note: `App talks to the bridge at ${PROVIDER_ENV.cortexBridgeUrl}; the PAT never enters the app process.` },
        { id: "relay", label: "RelayStation API key", envVar: "RELAY_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.relayKey), masked: mask(PROVIDER_ENV.relayKey) },
        { id: "manus", label: "Manus API key", envVar: "MANUS_AGENT_API_KEY", location: "/etc/curialyai.env", configured: Boolean(PROVIDER_ENV.manusKey), masked: mask(PROVIDER_ENV.manusKey) },
        { id: "session", label: "Session signing secret", envVar: "SESSION_SECRET", location: "/etc/curialyai.env", configured: (process.env.SESSION_SECRET ?? "").length >= 32, masked: process.env.SESSION_SECRET ? "set" : null },
        { id: "admin", label: "Admin password hash", envVar: "ADMIN_PASSWORD_HASH", location: "/etc/curialyai.env", configured: Boolean(process.env.ADMIN_PASSWORD_HASH), masked: process.env.ADMIN_PASSWORD_HASH ? "scrypt" : null },
      ],
    });
  });

  router.get("/stats", (_req, res) => res.json({ ...agentStats(), active: activeTaskCount() }));

  router.get("/tasks", (_req, res) => res.json({ tasks: listAgentTasks() }));

  router.post("/tasks", (req, res) => {
    try {
      const input = createSchema.parse(req.body);
      const attachments = input.attachmentIds.map(id => {
        const row = db.prepare("SELECT filename, storage_path AS storagePath FROM curialy_files WHERE id = ?").get(id) as { filename: string; storagePath: string } | undefined;
        if (!row) throw new TaskRejected(`Attachment ${id} not found.`);
        return row;
      });
      const taskId = startTask(input, attachments);
      res.status(201).json({ taskId });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/tasks/:id", (req, res) => {
    const task = taskOr404(req, res);
    if (task) res.json({ task, live: isLive(task.id) });
  });

  router.delete("/tasks/:id", (req, res) => {
    const task = taskOr404(req, res);
    if (!task) return;
    if (isLive(task.id)) return res.status(409).json({ error: "Cancel the task before deleting it." });
    const dir = workspacePath(task.id);
    if (fs.existsSync(dir) && path.dirname(dir) === WORKSPACE_ROOT) {
      // The sandbox user may own files here; remove with its privileges, never root.
      spawnSync("sudo", ["-n", "-u", process.env.AGENT_SANDBOX_USER || "curialy-agent", "rm", "-rf", "--", dir], { stdio: "ignore" });
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    res.json({ deleted: deleteAgentTask(task.id) });
  });

  router.post("/tasks/:id/cancel", (req, res) => {
    const task = taskOr404(req, res);
    if (task) res.json({ cancelled: cancelTask(task.id) });
  });

  router.post("/tasks/:id/messages", (req, res) => {
    try {
      const task = taskOr404(req, res);
      if (!task) return;
      followUp(task.id, followUpSchema.parse(req.body).prompt);
      res.status(202).json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Server-sent events: replay everything after ?after=<seq>, then stream live until the run ends.
  router.get("/tasks/:id/events", (req, res) => {
    const task = taskOr404(req, res);
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
    const live = isLive(task.id) ? channel(task.id) : null;
    const buffered: AgentEvent[] = [];
    let replaying = true;
    const onEvent = (event: AgentEvent) => (replaying ? buffered.push(event) : send(event));
    const onClosed = () => {
      res.write("event: end\ndata: {}\n\n");
      res.end();
    };
    live?.emitter.on("event", onEvent);
    live?.emitter.once("closed", onClosed);
    for (const event of listEventsAfter(task.id, after)) send(event);
    replaying = false;
    for (const event of buffered) send(event);
    if (!live) return onClosed();
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      live.emitter.off("event", onEvent);
      live.emitter.off("closed", onClosed);
    });
  });

  router.get("/tasks/:id/tree", (req, res) => {
    const task = taskOr404(req, res);
    if (!task) return;
    const dir = workspacePath(task.id);
    if (!fs.existsSync(dir)) return res.json({ entries: [] });
    try {
      res.json({ entries: listWorkspaceTree(dir, ".", 8, 2000) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/tasks/:id/file", (req, res) => {
    const task = taskOr404(req, res);
    if (!task) return;
    try {
      const dir = workspacePath(task.id);
      const requested = String(req.query.path ?? "");
      if (req.query.download === "1") {
        const { absolute, relative } = resolveInWorkspace(dir, requested);
        const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat?.isFile()) return res.status(404).json({ error: "File not found." });
        res.setHeader("Content-Type", "application/octet-stream");
        return res.download(absolute, path.basename(relative), { dotfiles: "allow" });
      }
      const file = readWorkspaceFile(dir, requested);
      if (!file.exists) return res.status(404).json({ error: "File not found." });
      res.json({ path: file.relative, content: file.content, bytes: Buffer.byteLength(file.content) });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
