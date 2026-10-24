import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { authConfigured, loginHandler, logoutHandler, requireAdmin, sameOriginOnly } from "../auth";
import { agentRouter, githubReposHandler } from "../agent/routes";
import { failOrphanedTasks } from "../agent/store";
import { isRunning } from "../agent/runner";
import { startWorkspaceSweeper } from "../agent/workspaces";
import { startDeploymentSweeper } from "../agent/deploy";
import { migrate } from "../db/pg";
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
  const orphaned = await failOrphanedTasks();
  if (orphaned) console.warn(`[agent] marked ${orphaned} interrupted task(s) as failed`);
  if (!authConfigured()) console.warn("[auth] ADMIN_PASSWORD_HASH / SESSION_SECRET missing: the workspace is locked until they are set.");
  startWorkspaceSweeper(isRunning);
  startDeploymentSweeper();
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
    next();
  });
  app.use("/api", sameOriginOnly);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  registerGitHubAuth(app);
  app.use("/api/agent", requireAdmin, agentRouter());
  app.get("/api/github/repos", requireAdmin, (req, res) => void githubReposHandler(req, res).catch(error => res.status(502).json({ error: error instanceof Error ? error.message : "GitHub request failed" })));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
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
}

startServer().catch(error => { console.error(error); process.exit(1); });
