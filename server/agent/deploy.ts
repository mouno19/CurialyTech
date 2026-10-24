import { randomUUID } from "node:crypto";
import { query } from "../db/pg";
import { PROVIDER_ENV } from "./providers";
import { collectWorkspaceFiles } from "./workspaces";

// Temporary live previews on Render. Render only deploys from Git, so each preview is pushed to a
// throwaway GitHub repo through the Git Data API (the token stays in this process; it is never
// exposed to the sandbox), then a Render service is created from it. Both are deleted after
// PREVIEW_TTL_MINUTES to conserve credits.

const PREVIEW_TTL_MINUTES = Number(process.env.PREVIEW_TTL_MINUTES || 120);
const PRIVATE_REPOS = process.env.PREVIEW_REPO_PRIVATE !== "false";

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

async function github(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${PROVIDER_ENV.githubToken}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed (${response.status}): ${data?.message ?? "error"}`);
  return data;
}

async function render(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${PROVIDER_ENV.renderKey}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Render ${init.method ?? "GET"} ${path} failed (${response.status}): ${data?.message ?? "error"}`);
  return data;
}

export function deployConfigured() {
  const missing = [!PROVIDER_ENV.renderKey && "RENDER_API_KEY", !PROVIDER_ENV.renderOwner && "RENDER_OWNER_ID", !PROVIDER_ENV.githubToken && "GITHUB_TOKEN"].filter(Boolean);
  return { ok: missing.length === 0, missing: missing as string[] };
}

async function pushRepo(name: string, files: { path: string; content: Buffer }[]) {
  const user = await github("/user");
  // auto_init gives the repo a first commit; the Git Data API cannot write to an empty repo.
  const repo = await github("/user/repos", { method: "POST", body: JSON.stringify({ name, private: PRIVATE_REPOS, auto_init: true, description: "Temporary Curialy preview (auto-deleted)" }) });
  const ref = await github(`/repos/${user.login}/${name}/git/ref/heads/${repo.default_branch}`);
  const tree: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of files) {
    const blob = await github(`/repos/${user.login}/${name}/git/blobs`, { method: "POST", body: JSON.stringify({ content: file.content.toString("base64"), encoding: "base64" }) });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const createdTree = await github(`/repos/${user.login}/${name}/git/trees`, { method: "POST", body: JSON.stringify({ tree }) });
  const commit = await github(`/repos/${user.login}/${name}/git/commits`, { method: "POST", body: JSON.stringify({ message: "Curialy preview", tree: createdTree.sha, parents: [ref.object.sha] }) });
  await github(`/repos/${user.login}/${name}/git/refs/heads/${repo.default_branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: true }) });
  return { fullName: `${user.login}/${name}`, htmlUrl: repo.html_url as string, branch: repo.default_branch as string };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true });
});

export async function deployPreview(req: DeployRequest) {
  const config = deployConfigured();
  if (!config.ok) throw new Error(`Live previews are not configured: missing ${config.missing.join(", ")}.`);
  const { files } = collectWorkspaceFiles(req.root);
  if (!files.length) throw new Error("The workspace is empty; nothing to deploy.");
  const id = randomUUID();
  const name = `curialy-preview-${id.slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000);
  await query("INSERT INTO curialy.deployments (id, session_id, provider, status, expires_at) VALUES ($1, $2, 'render', 'creating', $3)", [id, req.sessionId, expiresAt]);

  try {
    req.onProgress("creating", `Pushing ${files.length} files to a temporary ${PRIVATE_REPOS ? "private" : "public"} GitHub repo…`);
    const repo = await pushRepo(name, files);
    await query("UPDATE curialy.deployments SET repo = $2 WHERE id = $1", [id, repo.fullName]);

    req.onProgress("creating", `Creating Render ${req.kind === "static" ? "static site" : "web service"} ${name}…`);
    const body = req.kind === "static"
      ? { type: "static_site", name, ownerId: PROVIDER_ENV.renderOwner, repo: repo.htmlUrl, branch: repo.branch, autoDeploy: "no", serviceDetails: { buildCommand: req.buildCommand || "", publishPath: req.publishPath || ".", pullRequestPreviewsEnabled: "no" } }
      : { type: "web_service", name, ownerId: PROVIDER_ENV.renderOwner, repo: repo.htmlUrl, branch: repo.branch, autoDeploy: "no", serviceDetails: { runtime: "node", plan: "free", region: "oregon", envSpecificDetails: { buildCommand: req.buildCommand || "npm install", startCommand: req.startCommand || "npm start" } } };
    const created = await render("/services", { method: "POST", body: JSON.stringify(body) });
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
        req.onProgress("live", `Live until ${expiresAt.toISOString()} (auto-deleted after ${PREVIEW_TTL_MINUTES} min).`, url);
        return { id, url, serviceId: service.id, repo: repo.fullName, expiresAt: expiresAt.toISOString() };
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
  const { rows } = await query<{ service_id: string | null; repo: string | null }>("SELECT service_id, repo FROM curialy.deployments WHERE id = $1 AND deleted_at IS NULL", [id]);
  const row = rows[0];
  if (!row) return false;
  if (row.service_id) await render(`/services/${row.service_id}`, { method: "DELETE" }).catch(error => { if (!/404/.test(error.message)) throw error; });
  if (row.repo && PROVIDER_ENV.githubToken) await github(`/repos/${row.repo}`, { method: "DELETE" }).catch(error => { if (!/404/.test(error.message)) throw error; });
  await query("UPDATE curialy.deployments SET deleted_at = now(), status = 'deleted' WHERE id = $1", [id]);
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
