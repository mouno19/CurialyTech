import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { authConfigured, loginHandler, logoutHandler, requireAdmin, sameOriginOnly } from "../auth";
import { agentRouter, githubReposHandler } from "../agent/routes";
import { isBusy, shutdownRuns, startLifecycle } from "../agent/runner";
import { startWorkspaceSweeper } from "../agent/workspaces";
import { startDeploymentSweeper } from "../agent/deploy";
import { closeDb, migrate } from "../db/pg";
import { registerGitHubAuth } from "../auth-github";
import { previewHandler } from "../agent/preview";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // nginx terminates TLS on this host and forwards X-Forwarded-* from loopback.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  // All durable state is in Tiger Cloud; refuse to start without it rather than silently writing locally.
  await migrate();
  // Runs whose worker is gone become interrupted (with terminal events), never "running" forever.
  await startLifecycle();
  if (!authConfigured()) console.warn("[auth] ADMIN_PASSWORD_HASH / SESSION_SECRET missing: the workspace is locked until they are set.");
  startWorkspaceSweeper(isBusy);
  startDeploymentSweeper(isBusy);
  // Agent previews: token-authenticated, sandboxed (CSP), and mounted before the body parsers so
  // requests can be streamed untouched to a dev server running in the sandbox.
  app.use("/api/workspace/preview/:taskId/:token", (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    previewHandler(req, res);
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    // Defence in depth for rendered agent/model content: forms can only post here, images come from
    // this origin (plus data:/blob: and GitHub avatars), no plugins, no <base> hijack. Routes that
    // serve agent files set their own, stricter policy.
    res.setHeader("Content-Security-Policy", "form-action 'self'; img-src 'self' data: blob: https://avatars.githubusercontent.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use("/api", sameOriginOnly);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  registerGitHubAuth(app);
  app.use("/api/agent", requireAdmin, agentRouter());
  app.get("/api/github/repos", requireAdmin, (req, res) => void githubReposHandler(req, res).catch(error => res.status(502).json({ error: error instanceof Error ? error.message : "GitHub request failed" })));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`Server listening on ${host}:${port}`));

  // A restart interrupts running tasks truthfully (interrupted, not failed or still "running"),
  // ends live event streams, and exits within systemd's stop timeout.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal}: stopping`);
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    try {
      const stopped = await shutdownRuns(15_000);
      if (stopped) console.log(`[server] interrupted ${stopped} running task(s)`);
    } catch (error) {
      console.error("[server] shutdown:", error instanceof Error ? error.message : error);
    }
    server.close();
    server.closeAllConnections();
    await closeDb().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

startServer().catch(error => { console.error(error); process.exit(1); });
