import { randomUUID } from "node:crypto";
import { query } from "../db/pg";
import { createRepo, pushProjectToRepo, repoToken, retireRepo } from "../services/github";
import { PROVIDER_ENV } from "./providers";
import { collectWorkspaceFiles } from "./workspaces";

// Temporary live previews on Render, which only deploys from Git. If the session was exported to
// GitHub, the preview builds from that repo (and the repo is kept); otherwise a throwaway preview
// repo is created in the connected account and retired when the preview expires. The Render
// service is always deleted after PREVIEW_TTL_MINUTES to conserve credits.

const PREVIEW_TTL_MINUTES = Number(process.env.PREVIEW_TTL_MINUTES || 120);
const PRIVATE_PREVIEW_REPOS = process.env.PREVIEW_REPO_PRIVATE !== "false";

export type DeployRequest = {
  sessionId: string;
  root: string;
  kind: "static" | "node";
  buildCommand: string;
  publishPath: string;
  startCommand: string;
  onProgress: (status: "creating" | "building" | "live" | "failed", detail: string, url?: string) => void;
  signal: AbortSignal;
};

async function render(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${PROVIDER_ENV.renderKey}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Render ${init.method ?? "GET"} ${path} failed (${response.status}): ${data?.message ?? "error"}`);
  return data;
}

/** Render side only; GitHub access is checked when a deploy starts (it depends on the stored connection). */
export function deployConfigured() {
  const missing = [!PROVIDER_ENV.renderKey && "RENDER_API_KEY", !PROVIDER_ENV.renderOwner && "RENDER_OWNER_ID"].filter(Boolean);
  return { ok: missing.length === 0, missing: missing as string[] };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true });
});

export async function deployPreview(req: DeployRequest) {
  const config = deployConfigured();
  if (!config.ok) throw new Error(`Live previews are not configured: missing ${config.missing.join(", ")}.`);
  const github = await repoToken();
  if (!github) throw new Error("Connect GitHub first (sidebar → Connect GitHub): Render deploys from a Git repository.");
  const { files } = collectWorkspaceFiles(req.root);
  if (!files.length) throw new Error("The workspace is empty; nothing to deploy.");

  const id = randomUUID();
  const name = `curialy-preview-${id.slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000);
  const { rows } = await query<{ github_repo: string | null }>("SELECT github_repo FROM curialy.chat_sessions WHERE id = $1", [req.sessionId]);
  const exported = rows[0]?.github_repo ?? null;
  await query("INSERT INTO curialy.deployments (id, session_id, provider, status, expires_at, repo_owned_by_user) VALUES ($1, $2, 'render', 'creating', $3, $4)", [id, req.sessionId, expiresAt, Boolean(exported)]);

  try {
    let repoFullName: string;
    let repoUrl: string;
    let branch: string;
    if (exported) {
      req.onProgress("creating", `Pushing ${files.length} files to ${exported}…`);
      const pushed = await pushProjectToRepo(github.token, exported, files, "Curialy: deploy preview");
      repoFullName = exported;
      repoUrl = pushed.repoUrl;
      branch = pushed.branch;
      await query("UPDATE curialy.chat_sessions SET github_pushed_at = now() WHERE id = $1", [req.sessionId]);
    } else {
      req.onProgress("creating", `Creating temporary ${PRIVATE_PREVIEW_REPOS ? "private" : "public"} repo ${github.login}/${name} with ${files.length} files…`);
      const repo = await createRepo(github.token, name, PRIVATE_PREVIEW_REPOS, "Temporary Curialy preview (archived automatically)");
      const pushed = await pushProjectToRepo(github.token, repo.full_name, files, "Curialy preview");
      repoFullName = repo.full_name;
      repoUrl = repo.html_url;
      branch = pushed.branch;
    }
    await query("UPDATE curialy.deployments SET repo = $2 WHERE id = $1", [id, repoFullName]);

    req.onProgress("creating", `Creating Render ${req.kind === "static" ? "static site" : "web service"} ${name} from ${repoFullName}…`);
    const body = req.kind === "static"
      ? { type: "static_site", name, ownerId: PROVIDER_ENV.renderOwner, repo: repoUrl, branch, autoDeploy: "no", serviceDetails: { buildCommand: req.buildCommand || "", publishPath: req.publishPath || ".", pullRequestPreviewsEnabled: "no" } }
      : { type: "web_service", name, ownerId: PROVIDER_ENV.renderOwner, repo: repoUrl, branch, autoDeploy: "no", serviceDetails: { runtime: "node", plan: "free", region: "oregon", envSpecificDetails: { buildCommand: req.buildCommand || "npm install", startCommand: req.startCommand || "npm start" } } };
    let created: any;
    try {
      created = await render("/services", { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Render reads repos through its own GitHub App, which must be granted access separately.
      if (/repo|git|access|permission|not found/i.test(message)) throw new Error(`${message}. Make sure Render's GitHub App can access ${repoFullName} (Render dashboard → Account settings → Git providers → GitHub: grant "All repositories").`);
      throw error;
    }
    const service = created.service ?? created;
    const url: string = service.serviceDetails?.url ?? `https://${name}.onrender.com`;
    await query("UPDATE curialy.deployments SET service_id = $2, url = $3, status = 'building' WHERE id = $1", [id, service.id, url]);
    req.onProgress("building", "Render is building the preview…", url);

    const deadline = Date.now() + 12 * 60_000;
    let last = "";
    while (Date.now() < deadline) {
      await sleep(8000, req.signal);
      const deploys = await render(`/services/${service.id}/deploys?limit=1`);
      const status: string = deploys?.[0]?.deploy?.status ?? "unknown";
      if (status !== last) req.onProgress("building", `Render deploy status: ${status}`, url);
      last = status;
      if (status === "live") {
        await query("UPDATE curialy.deployments SET status = 'live' WHERE id = $1", [id]);
        req.onProgress("live", `Live until ${expiresAt.toISOString()} (Render service deleted after ${PREVIEW_TTL_MINUTES} min).`, url);
        return { id, url, serviceId: service.id, repo: repoFullName, expiresAt: expiresAt.toISOString() };
      }
      if (["build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"].includes(status)) {
        throw new Error(`Render deploy ${status}. Check build/start commands. Service ${service.id}.`);
      }
    }
    throw new Error("Render did not finish the deploy within 12 minutes.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query("UPDATE curialy.deployments SET status = 'failed', detail = $2 WHERE id = $1", [id, message.slice(0, 1000)]);
    req.onProgress("failed", message);
    throw error;
  }
}

export async function destroyDeployment(id: string) {
  const { rows } = await query<{ service_id: string | null; repo: string | null; repo_owned_by_user: boolean }>(
    "SELECT service_id, repo, repo_owned_by_user FROM curialy.deployments WHERE id = $1 AND deleted_at IS NULL", [id],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.service_id) await render(`/services/${row.service_id}`, { method: "DELETE" }).catch(error => { if (!/404/.test(error.message)) throw error; });
  let repoOutcome = "kept";
  if (row.repo && !row.repo_owned_by_user) {
    const github = await repoToken();
    if (github) repoOutcome = await retireRepo(github.token, row.repo).catch(error => `cleanup failed: ${error.message}`);
  }
  await query("UPDATE curialy.deployments SET deleted_at = now(), status = 'deleted', detail = $2 WHERE id = $1", [id, `Render service deleted; repo ${repoOutcome}`]);
  return true;
}

export async function listDeployments() {
  const { rows } = await query(
    `SELECT id, session_id AS "sessionId", status, url, repo, service_id AS "serviceId", detail, expires_at AS "expiresAt", created_at AS "createdAt", deleted_at AS "deletedAt"
     FROM curialy.deployments ORDER BY created_at DESC LIMIT 100`,
  );
  return rows;
}

export function startDeploymentSweeper() {
  const sweep = async () => {
    try {
      const { rows } = await query<{ id: string }>("SELECT id FROM curialy.deployments WHERE deleted_at IS NULL AND expires_at < now()");
      for (const row of rows) await destroyDeployment(row.id).catch(error => console.error(`[deploy] cleanup ${row.id} failed:`, error.message));
    } catch (error) {
      console.error("[deploy] sweep failed:", error instanceof Error ? error.message : error);
    }
  };
  const timer = setInterval(() => void sweep(), 5 * 60_000);
  timer.unref();
  void sweep();
}
