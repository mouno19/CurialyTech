import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { loginHandler, logoutHandler, requireUser, sameOriginOnly, sessionsConfigured } from "../auth";
import { accountRouter, adminRouter } from "../admin";
import { supportRouter } from "../support";
import { agentRouter, githubReposHandler } from "../agent/routes";
import { isBusy, shutdownRuns, startLifecycle } from "../agent/runner";
import { startWorkspaceSweeper } from "../agent/workspaces";
import { startDeploymentSweeper } from "../agent/deploy";
import { closeDb, migrate } from "../db/pg";
import { registerGitHubAuth } from "../auth-github";
import { previewHandler } from "../agent/preview";
import { servePublishedPreview } from "../agent/deploy-proxy";
import { SANDBOX_MODE } from "../agent/sandbox";
import { startCloudSandbox, stopCloudSandboxes } from "../agent/e2b";
import { gatewayRouter, keysRouter } from "../gateway";
import { startFollowUpQueue } from "../agent/queue";
import { billingAdminRouter, billingRouter } from "../billing/routes";
import { startPaymentWatcher } from "../billing/watcher";

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
  // Submitted payments are checked on-chain and applied; unpaid orders expire.
  const stopPaymentWatcher = startPaymentWatcher();
  if (!sessionsConfigured()) console.warn("[auth] SESSION_SECRET missing: nobody can sign in until it is set.");
  // Agent commands run in a cloud sandbox per task when it is configured, never on this server.
  if (SANDBOX_MODE === "e2b") startCloudSandbox();
  // Follow-ups sent during a run start when it ends (after the sandbox, which free accounts need).
  startFollowUpQueue();
  console.log(`[sandbox] agent commands run ${SANDBOX_MODE === "e2b" ? "in a cloud sandbox per task" : SANDBOX_MODE === "systemd" ? "on this server as the sandbox user" : "unsandboxed (development)"}`);
  startWorkspaceSweeper(isBusy);
  startDeploymentSweeper(isBusy);
  // Agent previews: token-authenticated, sandboxed (CSP), and mounted before the body parsers so
  // requests can be streamed untouched to a dev server running in the sandbox.
  // Published previews: a temporary address on this site. Mounted before the app's framing policy,
  // which would otherwise refuse to show the page, and before the body parsers so a form can stream.
  app.use("/p/:id", (req, res) => { void servePublishedPreview(req, res); });
  app.use("/api/workspace/preview/:taskId/:token", (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    previewHandler(req, res);
  });
  // The Developer API: key-authenticated, cross-origin by design, with its own body limit, so it is
  // mounted before the app's body parsers, security headers and same-origin check.
  const gateway = gatewayRouter();
  app.use("/v1", gateway);
  app.use("/api/v1", gateway);
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
  // Express 4 does not catch rejected async handlers.
  app.post("/api/auth/login", (req, res) => void loginHandler(req, res).catch(error => {
    console.error("[auth] sign-in failed:", error instanceof Error ? error.message : error);
    if (!res.headersSent) res.status(503).json({ error: "Sign-in isn't available right now. Try again in a moment." });
  }));
  app.post("/api/auth/logout", logoutHandler);
  registerGitHubAuth(app);
  // Every account reaches the agent; each route checks that the task, file or repository is its own.
  app.use("/api/agent", requireUser, agentRouter());
  app.use("/api/account", accountRouter());
  app.use("/api/support", supportRouter());
  app.use("/api/keys", keysRouter());
  // Plans, API top-ups and crypto payments (the catalog is public; the rest checks the account itself).
  app.use("/api/billing", billingRouter());
  app.use("/api/admin/billing", billingAdminRouter());
  app.use("/api/admin", adminRouter());
  app.get("/api/github/repos", requireUser, (req, res) => void githubReposHandler(req, res).catch(error => res.status(502).json({ error: error instanceof Error ? error.message : "GitHub request failed" })));
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
    stopPaymentWatcher();
    try {
      const stopped = await shutdownRuns(15_000);
      if (stopped) console.log(`[server] interrupted ${stopped} running task(s)`);
      // Cloud sandboxes belong to this process; the next one would stop them anyway.
      if (SANDBOX_MODE === "e2b") await Promise.race([stopCloudSandboxes(), new Promise(resolve => setTimeout(resolve, 5000))]);
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
