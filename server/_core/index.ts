import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { deleteLibraryFile, listLibraryFiles, saveLibraryFile } from "../curialy-store";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const uploadDir = process.env.CURIALY_UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/csv", "application/json"]);
      cb(null, allowed.has(file.mimetype));
    },
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
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
  registerOAuthRoutes(app);
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
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
