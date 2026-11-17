import fs from "node:fs";
import type { Request, Response } from "express";
import { packagePath, uiSnapshot } from "./ui-system";

// GET /ui-kit/<file>.tgz: the design system's repacked packages, as projects install them
// (npm install https://<site>/ui-kit/curialy-ui-<version>.tgz). Public and immutable: a release's
// file never changes (a new release is a new name), and npm checks the lockfile's integrity hash.

export function uiKitHandler(req: Request, res: Response) {
  const snapshot = uiSnapshot();
  const file = snapshot ? packagePath(snapshot, String(req.params.file ?? "")) : null;
  if (!file) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  let size = 0;
  try { size = fs.statSync(file).size; } catch { res.status(404).type("text/plain").send("Not found"); return; }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}
