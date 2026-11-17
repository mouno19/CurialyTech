import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { accountOf, requireUser } from "../auth";
import { renderAgentMjs, renderColabNotebook, renderConnectSh } from "./agent-script";
import { disconnectEnvironment, liveEnvironmentState, refreshLiveSpecs } from "./hub";
import {
  ComputeConfigError,
  createEnvironmentRow,
  deleteEnvironmentRow,
  getEnvironmentRow,
  listEnvironmentRows,
  rotateEnvironmentTokenRow,
  toEnvironmentSummary,
  updateEnvironmentRow,
} from "./store";

function requestOrigin(req: Request): string {
  const host = typeof req.headers.host === "string" ? req.headers.host.trim() : "";
  if (host && /^[A-Za-z0-9_.:-]+$/.test(host)) {
    const fwdProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"].split(",")[0].trim() : "";
    const proto = fwdProto === "https" || fwdProto === "http" ? fwdProto : req.secure ? "https" : "http";
    return `${proto}://${host}`;
  }
  return (process.env.PUBLIC_BASE_URL || "https://curialy.tech").replace(/\/+$/, "");
}

const createSchema = z.object({
  name: z.string().trim().max(80).optional(),
  kind: z.enum(["colab", "vps"]),
  workDir: z.string().trim().max(240).nullish(),
  isDefault: z.boolean().optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  workDir: z.string().trim().max(240).nullish(),
  isDefault: z.boolean().optional(),
});

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(err => {
      if (res.headersSent) return next(err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request." });
      }
      if (err instanceof ComputeConfigError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("[compute]", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Could not complete that compute environment action." });
    });
  };
}

export function computeRouter(): Router {
  const router = Router();

  // Public bootstrap scripts fetched by curl inside Google Colab or a user's VPS.
  router.get("/connect.sh", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("text/x-shellscript; charset=utf-8").send(renderConnectSh(requestOrigin(req)));
  });

  router.get("/agent.mjs", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("text/javascript; charset=utf-8").send(renderAgentMjs());
  });

  // Authenticated management endpoints (available to all signed-in accounts).
  router.use(requireUser);

  router.get(
    "/environments",
    handle(async (req, res) => {
      const user = accountOf(req);
      const rows = await listEnvironmentRows(user.id);
      const environments = rows.map(row => toEnvironmentSummary(row, liveEnvironmentState(row.id)));
      res.json({ environments });
    }),
  );

  router.post(
    "/environments",
    handle(async (req, res) => {
      const user = accountOf(req);
      const input = createSchema.parse(req.body);
      const { row, token } = await createEnvironmentRow(user.id, input);
      res.status(201).json({
        environment: toEnvironmentSummary(row, liveEnvironmentState(row.id)),
        token,
      });
    }),
  );

  router.patch(
    "/environments/:id",
    handle(async (req, res) => {
      const user = accountOf(req);
      const id = String(req.params.id);
      if (!z.string().uuid().safeParse(id).success) return res.status(404).json({ error: "Environment not found." });
      const patch = patchSchema.parse(req.body);
      const updated = await updateEnvironmentRow(user.id, id, patch);
      if (!updated) return res.status(404).json({ error: "Environment not found." });
      res.json({ environment: toEnvironmentSummary(updated, liveEnvironmentState(updated.id)) });
    }),
  );

  router.post(
    "/environments/:id/rotate",
    handle(async (req, res) => {
      const user = accountOf(req);
      const id = String(req.params.id);
      if (!z.string().uuid().safeParse(id).success) return res.status(404).json({ error: "Environment not found." });
      disconnectEnvironment(id, 4001, "Token rotated");
      const rotated = await rotateEnvironmentTokenRow(user.id, id);
      if (!rotated) return res.status(404).json({ error: "Environment not found." });
      res.json({
        environment: toEnvironmentSummary(rotated.row, liveEnvironmentState(rotated.row.id)),
        token: rotated.token,
      });
    }),
  );

  router.post(
    "/environments/:id/test",
    handle(async (req, res) => {
      const user = accountOf(req);
      const id = String(req.params.id);
      if (!z.string().uuid().safeParse(id).success) return res.status(404).json({ error: "Environment not found." });
      const row = await getEnvironmentRow(id, user.id);
      if (!row) return res.status(404).json({ error: "Environment not found." });
      await refreshLiveSpecs(id).catch(() => null);
      const state = liveEnvironmentState(id);
      res.json({ environment: toEnvironmentSummary(row, state), online: state.online });
    }),
  );

  router.post(
    "/environments/:id/notebook",
    handle(async (req, res) => {
      const user = accountOf(req);
      const id = String(req.params.id);
      if (!z.string().uuid().safeParse(id).success) return res.status(404).json({ error: "Environment not found." });
      const token = z.string().startsWith("cur_env_").max(120).parse(req.body?.token);
      const row = await getEnvironmentRow(id, user.id);
      if (!row) return res.status(404).json({ error: "Environment not found." });
      const ipynb = renderColabNotebook(requestOrigin(req), token, row.name);
      res.json({ filename: `curialy-${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colab"}.ipynb`, content: ipynb });
    }),
  );

  router.delete(
    "/environments/:id",
    handle(async (req, res) => {
      const user = accountOf(req);
      const id = String(req.params.id);
      if (!z.string().uuid().safeParse(id).success) return res.status(404).json({ error: "Environment not found." });
      disconnectEnvironment(id, 4001, "Environment deleted");
      const removed = await deleteEnvironmentRow(user.id, id);
      if (!removed) return res.status(404).json({ error: "Environment not found." });
      res.json({ removed: true });
    }),
  );

  return router;
}
