import { randomUUID } from "node:crypto";
import { deriveDeploymentState, type DeploymentState } from "@shared/taskStatus";
import { db, query } from "../db/pg";
import { createRepo, pushProjectToRepo, repoToken, retireRepo, throwIfAborted } from "../services/github";
import { appendTaskEvent } from "./events";
import { PROVIDER_ENV } from "./providers";
import { isPublishExcluded, readWorkspaceFiles } from "./workspaces";

// Temporary live previews on Render, which only deploys from Git. Every preview builds from its own
// throwaway PRIVATE repository in the connected account; a preview never writes to a repository the
// user owns or linked (an earlier version pushed a full-tree snapshot to the linked repo's default
// branch). The service and the temporary repository are removed when the preview expires, fails or
// is cancelled, and every change of state is recorded on the task's event log.

const PREVIEW_TTL_MINUTES = Number(process.env.PREVIEW_TTL_MINUTES || 120);

export type DeployRequest = {
  sessionId: string;
  callId: string;
  root: string;
  kind: "static" | "node";
  buildCommand: string;
  publishPath: string;
  startCommand: string;
  /** Called once the row exists, before any external call, so every event carries its id. */
  onCreated: (id: string, expiresAt: string) => void;
  onProgress: (status: "creating" | "building" | "live" | "failed", detail: string, url?: string) => void;
  signal: AbortSignal;
};

async function render(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${PROVIDER_ENV.renderKey}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`[deploy] hosting API ${init.method ?? "GET"} ${path} failed (${response.status}): ${data?.message ?? "error"}`);
    throw new Error(`Deploy engine request failed (${response.status}): ${data?.message ?? "error"}`);
  }
  return data;
}

/** Render side only; GitHub access is checked when a deploy starts (it depends on the stored connection). */
export function deployConfigured() {
  const missing = [!PROVIDER_ENV.renderKey && "RENDER_API_KEY", !PROVIDER_ENV.renderOwner && "RENDER_OWNER_ID"].filter(Boolean);
  return { ok: missing.length === 0, missing: missing as string[] };
}

/** Abortable wait: rejects at once if the run was already cancelled. */
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("Cancelled"));
  const onAbort = () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error("Cancelled")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
});

export async function deployPreview(req: DeployRequest) {
  const config = deployConfigured();
  if (!config.ok) throw new Error("Live previews are not configured on this server.");
  const github = await repoToken();
  if (!github) throw new Error("Connect GitHub first (sidebar → Connect GitHub): live previews are built from a Git repository.");
  // Uploads and local secrets never go into a repository, even a private temporary one.
  const files = (await readWorkspaceFiles(req.root)).files.filter(file => !isPublishExcluded(file.path));
  if (!files.length) throw new Error("The workspace is empty; nothing to deploy.");
  throwIfAborted(req.signal);

  const id = randomUUID();
  const name = `curialy-preview-${id.slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000);
  // Recorded before any external call, with the names it will use, so a crash cannot orphan them.
  await query(
    "INSERT INTO curialy.deployments (id, session_id, provider, status, expires_at, repo_owned_by_user, call_id, name, repo) VALUES ($1, $2, 'render', 'creating', $3, false, $4, $5, $6)",
    [id, req.sessionId, expiresAt, req.callId, name, `${github.login}/${name}`],
  );
  req.onCreated(id, expiresAt.toISOString());

  let createdRepo = false;
  try {
    throwIfAborted(req.signal);
    req.onProgress("creating", `Creating temporary private repo ${github.login}/${name} with ${files.length} files…`);
    const repo = await createRepo(github.token, name, true, "Temporary Curialy preview (removed automatically)");
    createdRepo = true;
    const pushed = await pushProjectToRepo(github.token, repo.full_name, files, "Curialy preview", undefined, req.signal);
    await query("UPDATE curialy.deployments SET repo = $2 WHERE id = $1", [id, repo.full_name]);

    throwIfAborted(req.signal);
    req.onProgress("creating", `Creating ${req.kind === "static" ? "static site" : "web service"} ${name}…`);
    const body = req.kind === "static"
      ? { type: "static_site", name, ownerId: PROVIDER_ENV.renderOwner, repo: repo.html_url, branch: pushed.branch, autoDeploy: "no", serviceDetails: { buildCommand: req.buildCommand || "", publishPath: req.publishPath || ".", pullRequestPreviewsEnabled: "no" } }
      : { type: "web_service", name, ownerId: PROVIDER_ENV.renderOwner, repo: repo.html_url, branch: pushed.branch, autoDeploy: "no", serviceDetails: { runtime: "node", plan: "free", region: "oregon", envSpecificDetails: { buildCommand: req.buildCommand || "npm install", startCommand: req.startCommand || "npm start" } } };
    let created: any;
    try {
      created = await render("/services", { method: "POST", body: JSON.stringify(body) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Render reads repos through its own GitHub App, which must be granted access separately.
      if (/\((401|403|404)\)/.test(message) && /repo|git|access|permission|not found/i.test(message)) {
        console.error(`[deploy] service creation failed for ${repo.full_name}: ${message}. Grant the hosting provider's GitHub App access to all repositories.`);
        throw new Error(`The deploy engine could not read ${repo.full_name}. Its GitHub access must include this repository (operator setting).`);
      }
      throw error;
    }
    const service = created.service ?? created;
    const url: string = service.serviceDetails?.url ?? `https://${name}.onrender.com`;
    await query("UPDATE curialy.deployments SET service_id = $2, url = $3, status = 'building' WHERE id = $1", [id, service.id, url]);
    req.onProgress("building", "Building the live preview…", url);

    const deadline = Date.now() + 12 * 60_000;
    let last = "";
    while (Date.now() < deadline) {
      await sleep(8000, req.signal);
      const deploys = await render(`/services/${service.id}/deploys?limit=1`);
      const status: string = deploys?.[0]?.deploy?.status ?? "unknown";
      if (status !== last) req.onProgress("building", `Deploy status: ${status.replace(/_/g, " ")}`, url);
      last = status;
      if (status === "live") {
        await query("UPDATE curialy.deployments SET status = 'live' WHERE id = $1", [id]);
        req.onProgress("live", `Live until ${expiresAt.toISOString()} (removed automatically after ${PREVIEW_TTL_MINUTES} min).`, url);
        return { id, url, serviceId: service.id, repo: repo.full_name, expiresAt: expiresAt.toISOString() };
      }
      if (["build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"].includes(status)) {
        throw new Error(`Deploy ${status.replace(/_/g, " ")}. Check the build and start commands.`);
      }
    }
    throw new Error("The deploy did not finish within 12 minutes.");
  } catch (error) {
    const cancelled = req.signal.aborted;
    const message = cancelled ? "Cancelled before the preview went live." : error instanceof Error ? error.message : String(error);
    await query("UPDATE curialy.deployments SET status = 'failed', detail = $2, last_error = $2 WHERE id = $1", [id, message.slice(0, 1000)]).catch(() => undefined);
    req.onProgress("failed", message);
    // Nothing half-built stays up: remove the service and the temporary repo now, not at expiry.
    if (createdRepo || cancelled) await destroyDeployment(id, cancelled ? "cancelled" : "failed").catch(cleanup => console.error(`[deploy] cleanup ${id} failed:`, cleanup.message));
    throw error;
  }
}

export type RemovalReason = "expired" | "failed" | "cancelled" | "interrupted" | "user";

/** Retire a preview's temporary repository; on failure it stays "repo pending" for the sweeper. */
async function retireTempRepo(id: string, repo: string) {
  try {
    const github = await repoToken();
    if (!github) throw new Error("GitHub is disconnected");
    const outcome = await retireRepo(github.token, repo);
    await query("UPDATE curialy.deployments SET cleanup_detail = $2, last_error = NULL WHERE id = $1", [id, `service deleted; repo ${outcome}`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query("UPDATE curialy.deployments SET last_error = $2 WHERE id = $1", [id, `repo cleanup: ${message}`.slice(0, 500)]).catch(() => undefined);
    console.error(`[deploy] temporary repo of ${id} not retired yet: ${message}`);
  }
}

/**
 * Take a preview down (hosting service, then the temporary repo) and record why. The stored status
 * and detail of a failed deploy are kept; the removal goes into removed_reason and the task log.
 */
export async function destroyDeployment(id: string, reason: RemovalReason) {
  const { rows } = await query<{ session_id: string | null; service_id: string | null; repo: string | null; name: string | null; repo_owned_by_user: boolean; status: string; url: string | null }>(
    "SELECT session_id, service_id, repo, name, repo_owned_by_user, status, url FROM curialy.deployments WHERE id = $1 AND deleted_at IS NULL", [id],
  );
  const row = rows[0];
  if (!row) return false;
  let serviceId = row.service_id;
  if (!serviceId && row.name && deployConfigured().ok) {
    // A crash between creating the service and recording it: find it by its unique name.
    const found = await render(`/services?name=${encodeURIComponent(row.name)}&limit=1`).catch(() => null);
    serviceId = found?.[0]?.service?.id ?? null;
  }
  if (serviceId) await render(`/services/${serviceId}`, { method: "DELETE" }).catch(error => { if (!/\(404\)/.test(error.message)) throw error; });
  // The public preview is gone: record that before the GitHub step, which can fail (disconnected,
  // token revoked) and is retried on its own; the row never claims "live" again.
  const repoPending = Boolean(row.repo && !row.repo_owned_by_user);
  await query(
    "UPDATE curialy.deployments SET service_id = NULL, deleted_at = COALESCE(deleted_at, now()), removed_reason = COALESCE(removed_reason, $2), cleanup_detail = $3 WHERE id = $1",
    [id, reason, repoPending ? "service deleted; repo pending" : "service deleted; repo kept"],
  );
  if (row.session_id) {
    const status = reason === "expired" ? "expired" : reason === "interrupted" ? "interrupted" : reason === "failed" && row.status === "failed" ? "failed" : "removed";
    const detail = reason === "expired" ? "The preview expired and was removed." : reason === "user" ? "The preview was taken down." : reason === "cancelled" ? "The deploy was cancelled; nothing was left running." : reason === "interrupted" ? "The deploy stopped when its run ended; nothing was left running." : "The failed deploy was cleaned up.";
    await appendTaskEvent(row.session_id, { type: "deployment", deploymentId: id, status, detail, ...(row.url ? { url: row.url } : {}) }).catch(error => console.error(`[deploy] could not log removal of ${id}:`, error.message));
  }
  if (repoPending) await retireTempRepo(id, row.repo!);
  return true;
}

export type DeploymentView = {
  /** openUrl: same-origin address that redirects to a live preview (use it for links and frames). */
  id: string; callId: string | null; state: DeploymentState; url: string | null; openUrl: string | null; detail: string | null;
  target: { kind: "temp_repo" | "user_repo"; repo: string | null; private: boolean };
  createdAt: string; expiresAt: string; removedAt: string | null; removedReason: string | null; canRemove: boolean;
};

/** A task's previews with their truthful state (expired is never "live"). */
export async function listTaskDeployments(sessionId: string, runActive: boolean): Promise<DeploymentView[]> {
  const { rows } = await query<{ id: string; call_id: string | null; status: string; url: string | null; detail: string | null; repo: string | null; repo_owned_by_user: boolean; created_at: Date; expires_at: Date; deleted_at: Date | null; removed_reason: string | null }>(
    `SELECT id, call_id, status, url, detail, repo, repo_owned_by_user, created_at, expires_at, deleted_at, removed_reason
     FROM curialy.deployments WHERE session_id = $1 ORDER BY created_at`, [sessionId],
  );
  const now = Date.now();
  return rows.map(row => {
    const state = deriveDeploymentState({ status: row.status, expiresAt: row.expires_at, deletedAt: row.deleted_at, removedReason: row.removed_reason }, now, runActive);
    return {
      id: row.id, callId: row.call_id, state, url: row.url, openUrl: state === "live" && row.url ? `/api/agent/tasks/${sessionId}/deployments/${row.id}/open` : null, detail: row.detail,
      // Older previews built from the user's own repository were recorded with repo_owned_by_user.
      target: { kind: row.repo_owned_by_user ? "user_repo" : "temp_repo", repo: row.repo, private: !row.repo_owned_by_user },
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      removedAt: row.deleted_at?.toISOString() ?? null, removedReason: row.removed_reason,
      canRemove: !row.deleted_at && (state === "live" || state === "failed" || state === "expired" || state === "interrupted"),
    };
  });
}

export async function deploymentSession(id: string) {
  const { rows } = await query<{ session_id: string | null }>("SELECT session_id FROM curialy.deployments WHERE id = $1", [id]);
  return rows[0]?.session_id ?? null;
}

export async function listDeployments() {
  const { rows } = await query(
    `SELECT id, session_id AS "sessionId", status, url, repo, detail, expires_at AS "expiresAt", created_at AS "createdAt", deleted_at AS "deletedAt", removed_reason AS "removedReason"
     FROM curialy.deployments ORDER BY created_at DESC LIMIT 100`,
  );
  return rows;
}

/**
 * Expired previews, failed ones never cleaned up, and creating/building rows whose run is gone
 * (restart, crash) are taken down. One instance sweeps at a time (advisory lock).
 */
export function startDeploymentSweeper(isBusy: (taskId: string) => boolean) {
  const sweep = async () => {
    // Session-level advisory locks belong to one connection: hold a dedicated client for the sweep.
    const client = await db().connect().catch(error => { console.error("[deploy] sweep: no database connection:", error.message); return null; });
    if (!client) return;
    try {
      const { rows: [lock] } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(7718002) AS locked");
      if (!lock?.locked) return;
      try {
        const { rows } = await query<{ id: string; session_id: string | null; reason: RemovalReason }>(
          `SELECT d.id, d.session_id,
             CASE WHEN d.expires_at < now() THEN 'expired' WHEN d.status = 'failed' THEN 'failed' ELSE 'interrupted' END AS reason
           FROM curialy.deployments d LEFT JOIN curialy.chat_sessions s ON s.id = d.session_id
           WHERE d.deleted_at IS NULL AND (
             d.expires_at < now()
             OR (d.status = 'failed' AND d.created_at < now() - interval '2 minutes')
             OR (d.status IN ('creating', 'building') AND (s.id IS NULL OR s.status NOT IN ('queued', 'running', 'cancelling')))
           )`,
        );
        // Previews already taken down whose temporary repository could not be retired yet.
        const { rows: pending } = await query<{ id: string; repo: string }>(
          "SELECT id, repo FROM curialy.deployments WHERE deleted_at IS NOT NULL AND cleanup_detail = 'service deleted; repo pending' AND repo IS NOT NULL AND NOT repo_owned_by_user LIMIT 20",
        );
        for (const row of pending) await retireTempRepo(row.id, row.repo);
        for (const row of rows) {
          if (row.reason === "interrupted" && row.session_id && isBusy(row.session_id)) continue;
          await destroyDeployment(row.id, row.reason).catch(error => {
            console.error(`[deploy] cleanup ${row.id} failed:`, error.message);
            return query("UPDATE curialy.deployments SET last_error = $2 WHERE id = $1", [row.id, String(error.message).slice(0, 500)]).catch(() => undefined);
          });
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(7718002)").catch(() => undefined);
      }
    } catch (error) {
      console.error("[deploy] sweep failed:", error instanceof Error ? error.message : error);
    } finally {
      client.release();
    }
  };
  const timer = setInterval(() => void sweep(), 5 * 60_000);
  timer.unref();
  void sweep();
}
