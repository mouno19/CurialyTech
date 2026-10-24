import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { deleteLibraryFile, listLibraryFiles, saveLibraryFile } from "../curialy-store";
import { authConfigured, loginHandler, logoutHandler, requireAdmin, sameOriginOnly } from "../auth";
import { agentRouter } from "../agent/routes";
import { failOrphanedTasks } from "../agent/store";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // nginx terminates TLS on this host and forwards X-Forwarded-* from loopback.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  const orphaned = failOrphanedTasks();
  if (orphaned) console.warn(`[agent] marked ${orphaned} interrupted task(s) as failed`);
  if (!authConfigured()) console.warn("[auth] ADMIN_PASSWORD_HASH / SESSION_SECRET missing: the workspace is locked until they are set.");
  const uploadDir = process.env.CURIALY_UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/csv", "application/json"]);
      // Browsers label source files inconsistently (.ts arrives as video/mp2t), so also allow by extension.
      const codeExtension = /\.(txt|md|csv|json|ya?ml|toml|ini|env\.example|[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|sql|sh|html|css|scss|xml|svg|log)$/i;
      cb(null, allowed.has(file.mimetype) || file.mimetype.startsWith("text/") || codeExtension.test(file.originalname));
    },
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
  app.use("/api/files", requireAdmin);
  app.use("/api/agent", requireAdmin, agentRouter());
  app.get("/api/files", (_req, res) => res.json({ files: listLibraryFiles() }));
  app.post("/api/files", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Upload a supported TXT, PDF, DOCX, CSV, or JSON file up to 10 MB." });
    const id = randomUUID();
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    const target = path.join(uploadDir, `${id}-${safeName}`);
    fs.renameSync(req.file.path, target);
    const saved = saveLibraryFile({ id, filename: safeName, mimeType: req.file.mimetype, sizeBytes: req.file.size, storagePath: target, status: "uploaded" });
    res.status(201).json({ file: saved, fileId: id, filename: safeName });
  });
  app.delete("/api/files/:id", (req, res) => {
    const deleted = deleteLibraryFile(req.params.id);
    res.json({ deleted });
  });
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
