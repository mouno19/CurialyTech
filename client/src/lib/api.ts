import type { AgentTaskSummary, CreateTaskRequest, ModelSpec, QueuedMessage, StatusReason, TaskQueue, TaskStatus } from "@shared/agent";
import type { SavedSkill } from "@shared/skills";
import type { ApiKeyInfo } from "@shared/gateway";
import type { CreditBalance, CreditSettings, RewardsState } from "@shared/credits";
import type { DeploymentState } from "@shared/taskStatus";
import { UPLOADS_AT_ONCE, type MediaDeleteResult, type MediaKind, type VaultQuota, type VaultSummary } from "@shared/media";
import { markStorageUnavailable } from "./mediaHealth";
import { limiter, whileBusy } from "./uploads";

/** A failed API call: the server's message (safe to show), HTTP status, and the machine-readable bits. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's error code, e.g. "storage_unavailable", "confirm_public", "media_gone"; "network" when unreachable. */
    readonly code?: string,
    /** Seconds to wait before retrying (JSON body retryAfter or the Retry-After header). */
    readonly retryAfter?: number,
    /** The parsed error body, for endpoints whose error carries data (e.g. 410 from browser reconnect). */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Retry-After is either seconds or an HTTP date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : undefined;
}

function fallbackMessage(status: number) {
  if (status === 502 || status === 503 || status === 504) return "The server is unavailable right now. Try again in a moment.";
  if (status === 404) return "Not found.";
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 413) return "That's too large to send.";
  if (status === 429) return "Too many requests at once. Try again in a moment.";
  return `Request failed (${status}).`;
}

/** The ApiError for a failed answer, with its side effects (signed out, storage down) applied. */
function failure(status: number, data: unknown, retryAfterHeader: string | null, path: string) {
  if (status === 401 && !path.startsWith("/api/auth")) window.dispatchEvent(new Event("curialy:unauthorized"));
  const body = (data && typeof data === "object" ? data : {}) as { error?: unknown; code?: unknown; retryAfter?: unknown };
  const code = typeof body.code === "string" ? body.code : undefined;
  const retryAfter = typeof body.retryAfter === "number" ? body.retryAfter : parseRetryAfter(retryAfterHeader);
  const message = typeof body.error === "string" && body.error ? body.error : fallbackMessage(status);
  if (status === 503 && code === "storage_unavailable") markStorageUnavailable(retryAfter);
  return new ApiError(message, status, code, retryAfter, data);
}

const unreachable = () => new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw unreachable();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw failure(response.status, data, response.headers.get("retry-after"), path);
  return data as T;
}

/** What an upload reports while it runs: it left the queue, bytes sent, waiting for the account's other uploads. */
export type UploadOptions = { signal?: AbortSignal; onStart?: () => void; onProgress?: (sent: number, total: number) => void; onWait?: () => void };

/** One file to the vault over XHR (fetch can't report upload progress), failing as api() does. */
function sendFile(file: File, opts: UploadOptions) {
  return new Promise<UploadedFile>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const path = "/api/agent/media";
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open("POST", path);
    xhr.upload.onprogress = event => opts.onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", abort);
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && (data as { file?: UploadedFile }).file) resolve((data as { file: UploadedFile }).file);
      else reject(failure(xhr.status, data, xhr.getResponseHeader("retry-after"), path));
    };
    xhr.onerror = () => { opts.signal?.removeEventListener("abort", abort); reject(unreachable()); };
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    opts.signal?.addEventListener("abort", abort, { once: true });
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

/** How long a 429 "busy" asked to wait (ms); null for any other failure. */
export const busyWait = (error: unknown) => (error instanceof ApiError && error.status === 429 && error.code === "busy" ? (error.retryAfter ?? 2) * 1000 : null);

// This tab's uploads share the account's in-flight allowance; other tabs show up as "busy".
const uploadSlots = limiter(UPLOADS_AT_ONCE);

// ---- Types (shapes from /home/ubuntu/curialy-tools/CONTRACT.md) ----

export type ProviderProbe = { id: string; label: string; ok: boolean; latencyMs: number; detail: string; configured: boolean };
export type HealthResponse = { providers: ProviderProbe[]; activeTasks: number };
export type KeyStatus = { id: string; label: string; configured: boolean; masked: string | null; note?: string };
export type TreeEntry = { path: string; type: "file" | "dir"; size: number };
export type UploadedFile = { id: string; filename: string; mimeType: string; sizeBytes: number; kind?: string };
/** elsewhere: stored in an earlier storage account the server no longer reads (never fetched). */
export type MediaFile = UploadedFile & { kind: string; sessionId: string | null; createdAt: string; state: "stored" | "missing" | "elsewhere" };
export type MediaHealth = { ok: boolean; state: "ok" | "unavailable" | "not_configured"; kind: string | null; retryAfter: number; detail: string };
/** A page of the vault: nextCursor continues it; matching counts every file the filter matches. */
export type MediaList = { files: MediaFile[]; nextCursor: string | null; matching: number; summary: VaultSummary; quota: VaultQuota; stage: { ok: boolean; detail: string }; storage: MediaHealth };
export type MediaQuery = { kind?: MediaKind; q?: string };
export type GitHubRepo = { id: number; name: string; full_name: string; private: boolean; default_branch: string; description: string | null; updated_at: string; language: string | null };
export type GitHubStatus = { configured: boolean; connected: boolean; login: string | null; name: string | null; avatarUrl: string | null; scopes: string[]; missingScopes: string[]; connectedAt: string | null };
/** completedWithIssues: completed runs whose outcome had problems (failing checks, review not approved, publish failed). */
export type TaskStats = { total: number; completed: number; completedWithIssues?: number; failed: number; cancelled: number; interrupted: number; running: number; filesChanged: number; active: number };
export type TaskDetail = { task: AgentTaskSummary; /** an event channel is open on this server */ live: boolean; /** a run is executing on this server */ running: boolean; /** follow-ups waiting for the run to end */ queue?: TaskQueue };
/** What a follow-up asks for besides its text: another model (same conversation format), a repository to link, saved skills to follow. */
export type FollowUpExtras = { model?: string | null; repo?: string | null; repoBranch?: string | null; /** the task has another repository: switch to this one */ replaceRepo?: boolean; /** replace the task's saved skills; omitted keeps them */ skillIds?: string[] };
/** started: the run had already ended, so the message started at once. */
export type QueueStarted = { runId: string; itemId: string } | null;

/** Result of POST /cancel: 200 when final or confirmed, 202 while "cancelling". */
export type CancelResult = { status: TaskStatus; statusReason?: StatusReason; runId: string | null; changed: boolean };
/** A run that was queued by a follow-up, retry or deploy. */
export type RunStarted = { status: "queued"; runId: string; attempt: number };
export type FollowUpResult = RunStarted & { ok: true };
export type DeleteTaskResult = { deleted: boolean; previewsRemoved: number; filesRemoved: number; filesKept: number };

export type ArchivedBuild = { dir: string; fileCount: number; bytes: number; kind: "build" | "static" };
export type PreviewReady = { available: true; workspace: true; dir: string; url: string; warnings: string[] };
/**
 * No live preview. archived && build: "an archived build exists, Restore workspace to preview it";
 * archived && !build: "workspace archived; no built site was kept"; !archived: no build yet.
 */
export type PreviewUnavailable = { available: false; workspace: boolean; archived: boolean; build: ArchivedBuild | null; restorable: boolean; running: boolean };
export type PreviewInfo = PreviewReady | PreviewUnavailable;
export type RestoreResult = { restored: number; preview: { dir: string } | null };
export type ScreenshotResult = { status: number | null; title: string; consoleErrors: string[]; image: string | null };

export type DeploymentView = {
  id: string;
  callId: string | null;
  /** Server-authoritative; "expired" is never "live". Also derive expiry from expiresAt client-side. */
  state: DeploymentState;
  url: string | null;
  /** Same-origin address that redirects to the live preview: use it for links and frames (white-label). */
  openUrl?: string | null;
  detail: string | null;
  target: { kind: "temp_repo" | "user_repo"; repo: string | null; private: boolean };
  createdAt: string;
  expiresAt: string;
  removedAt: string | null;
  removedReason: string | null;
  canRemove: boolean;
};
/** allowed: public previews are the operator's feature; other accounts preview inside Curialy. */
export type TaskDeployments = { deployments: DeploymentView[]; capabilities: { configured: boolean; github: boolean; allowed?: boolean } };
/** Legacy global deployments list (GET /deployments). */
export type Deployment = { id: string; sessionId: string | null; status: string; url: string | null; repo: string | null; serviceId: string | null; detail: string | null; expiresAt: string; createdAt: string; deletedAt: string | null };

export type BrowserStatus = { status: "live" | "ended"; /** embeddable live view, only while live; never from the event log */ viewer: string | null; title: string; url: string };

export type ExportTarget =
  | { kind: "new"; owner: string | null; suggestedName: string }
  /** remote: whether the branch head is still the workspace's last push; anything but "ours" needs confirmOverwrite. */
  | { kind: "existing"; repo: string; url: string | null; branch: string | null; remote: "ours" | "changed" | "unknown" }
  | { kind: "linked"; repo: string; defaultBranch: string; url: string };
export type ExportPlan = { target: ExportTarget; files?: number; bytes?: number; excluded?: string[]; login: string | null };
/**
 * New repo: repoName + visibility required; "public" also needs confirmPublic. Linked repo: branch
 * required; its default branch also needs confirmDefaultBranch. Existing export repo: replacing a
 * branch with commits from elsewhere needs confirmOverwrite. Nothing defaults to public.
 */
export type ExportRequest = { repoName?: string; visibility?: "private" | "public"; confirmPublic?: true; message?: string; branch?: string; confirmDefaultBranch?: true; confirmOverwrite?: true };
export type ExportResult = { repo: string; url: string; commitUrl: string; files: number; created: boolean; nothingToPush?: boolean; branch?: string };

const enc = encodeURIComponent;
/** "?a=1&b=2" from the defined, non-empty values (or ""). */
const searchOf = (params: Record<string, string | number | undefined>) => {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${enc(key)}=${enc(String(value))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
};

/** HEAD a stored file without touching storage: 200 | 404 | 410 | 503, or 0 when the server is unreachable. */
async function mediaHead(id: string): Promise<number> {
  try {
    const response = await fetch(`/api/agent/media/${enc(id)}`, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    if (response.status === 503) markStorageUnavailable(parseRetryAfter(response.headers.get("retry-after")));
    if (response.status === 401) window.dispatchEvent(new Event("curialy:unauthorized"));
    return response.status;
  } catch {
    return 0;
  }
}

export const agentApi = {
  models: () => api<{ models: ModelSpec[] }>("/api/agent/models"),
  health: (deep = false) => api<HealthResponse>(`/api/agent/health${deep ? "?deep=1" : ""}`),
  keys: () => api<{ keys: KeyStatus[] }>("/api/agent/keys"),
  skills: () => api<{ skills: SavedSkill[] }>("/api/agent/skills"),
  saveSkill: (body: { name: string; body: string }) => api<{ skill: SavedSkill }>("/api/agent/skills", { method: "POST", json: body }),
  updateSkill: (id: string, body: { name: string; body: string }) => api<{ skill: SavedSkill }>(`/api/agent/skills/${enc(id)}`, { method: "PATCH", json: body }),
  deleteSkill: (id: string) => api<{ deleted: true }>(`/api/agent/skills/${enc(id)}`, { method: "DELETE" }),
  stats: () => api<TaskStats>("/api/agent/stats"),

  tasks: () => api<{ tasks: AgentTaskSummary[] }>("/api/agent/tasks"),
  task: (id: string) => api<TaskDetail>(`/api/agent/tasks/${enc(id)}`),
  create: (body: CreateTaskRequest & { clientMessageId?: string }) => api<{ taskId: string }>("/api/agent/tasks", { method: "POST", json: body }),
  /** 409 when the task is active or changed since expectedRunId; 503 while the server restarts. */
  followUp: (id: string, prompt: string, attachmentIds: string[] = [], opts: { clientMessageId?: string; expectedRunId?: string | null } & FollowUpExtras = {}) =>
    api<FollowUpResult>(`/api/agent/tasks/${enc(id)}/messages`, { method: "POST", json: { prompt, attachmentIds, ...opts } }),
  /** A follow-up sent while a run is active: it waits and starts by itself when the run ends. 409 when the queue is full. */
  queue: (id: string, prompt: string, attachmentIds: string[] = [], opts: { clientMessageId?: string } & FollowUpExtras = {}) =>
    api<{ item: QueuedMessage; started: QueueStarted; queue: TaskQueue }>(`/api/agent/tasks/${enc(id)}/queue`, { method: "POST", json: { prompt, attachmentIds, ...opts } }),
  /** 409 once the message has started. */
  editQueued: (id: string, itemId: string, prompt: string) => api<{ item: QueuedMessage; queue: TaskQueue }>(`/api/agent/tasks/${enc(id)}/queue/${enc(itemId)}`, { method: "PATCH", json: { prompt } }),
  removeQueued: (id: string, itemId: string) => api<{ removed: true; queue: TaskQueue }>(`/api/agent/tasks/${enc(id)}/queue/${enc(itemId)}`, { method: "DELETE" }),
  /** A message that could not start goes back in line. */
  retryQueued: (id: string, itemId: string) => api<{ started: QueueStarted; queue: TaskQueue }>(`/api/agent/tasks/${enc(id)}/queue/${enc(itemId)}/retry`, { method: "POST", json: {} }),
  /** Start the next waiting message now (also when the queue waits for the user). */
  runQueued: (id: string) => api<{ started: QueueStarted; queue: TaskQueue }>(`/api/agent/tasks/${enc(id)}/queue/next`, { method: "POST", json: {} }),
  /** Idempotent. Pass the runId the UI is showing so a stale tab cannot cancel a newer run. */
  cancel: (id: string, runId?: string | null) => api<CancelResult>(`/api/agent/tasks/${enc(id)}/cancel`, { method: "POST", json: runId ? { runId } : {} }),
  /** failed | cancelled | interrupted only; 409 otherwise (completed: send a follow-up instead). */
  retry: (id: string, runId?: string | null) => api<RunStarted>(`/api/agent/tasks/${enc(id)}/retry`, { method: "POST", json: runId ? { runId } : {} }),
  /** Starts a deploy run (temporary private preview repo). Only call after the user confirmed. */
  deploy: (id: string, runId?: string | null) => api<RunStarted>(`/api/agent/tasks/${enc(id)}/deploy`, { method: "POST", json: { confirm: true, ...(runId ? { runId } : {}) } }),
  remove: (id: string) => api<DeleteTaskResult>(`/api/agent/tasks/${enc(id)}`, { method: "DELETE" }),

  tree: (id: string) => api<{ entries: TreeEntry[]; source: "live" | "archived" }>(`/api/agent/tasks/${enc(id)}/tree`),
  file: (id: string, path: string) => api<{ path: string; content: string; bytes: number; binary?: boolean; truncated?: boolean }>(`/api/agent/tasks/${enc(id)}/file?path=${enc(path)}`),
  rawFileUrl: (id: string, path: string) => `/api/agent/tasks/${enc(id)}/file?raw=1&path=${enc(path)}`,
  downloadUrl: (id: string, path: string) => `/api/agent/tasks/${enc(id)}/file?download=1&path=${enc(path)}`,

  /**
   * 503 storage_unavailable is checked before the upload; 413 too_large or quota (a full free vault).
   * Runs UPLOADS_AT_ONCE at a time in this tab, and waits out "busy" (the account's other uploads).
   */
  upload: (file: File, opts: UploadOptions = {}) => uploadSlots(async () => {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    opts.onStart?.();
    return whileBusy(() => sendFile(file, opts), busyWait, { signal: opts.signal, onWait: opts.onWait });
  }),
  media: (query: MediaQuery & { cursor?: string | null; limit?: number } = {}) =>
    api<MediaList>(`/api/agent/media${searchOf({ kind: query.kind, q: query.q?.trim(), cursor: query.cursor ?? undefined, limit: query.limit })}`, { cache: "no-store" }),
  /** Every file the filter matches, newest first (at most MAX_SELECT_IDS; total counts them all). */
  mediaIds: (query: MediaQuery = {}) => api<{ ids: string[]; total: number }>(`/api/agent/media/ids${searchOf({ kind: query.kind, q: query.q?.trim() })}`, { cache: "no-store" }),
  /** Up to DELETE_BATCH files; 503 (with the same body) when storage is down and nothing was deleted. */
  removeMediaMany: (ids: string[]) => api<MediaDeleteResult>("/api/agent/media/delete", { method: "POST", json: { ids } }),
  /** probe=true runs one real (rate-limited) storage check; otherwise answered from memory. */
  mediaHealth: (probe = false) => api<MediaHealth>(`/api/agent/media/health${probe ? "?probe=1" : ""}`, { cache: "no-store" }),
  mediaHead,
  mediaUrl: (id: string) => `/api/agent/media/${enc(id)}`,
  mediaDownloadUrl: (id: string) => `/api/agent/media/${enc(id)}?download=1`,
  mediaText: (id: string) => api<{ filename: string; content: string; truncated: boolean; bytes: number }>(`/api/agent/media/${enc(id)}/text`),
  /** kept: the record is gone, but the copy in an earlier storage account was not deleted there. */
  removeMedia: (id: string) => api<{ deleted: boolean; kept?: boolean }>(`/api/agent/media/${enc(id)}`, { method: "DELETE" }),

  github: () => api<GitHubStatus>("/api/agent/github"),
  githubRepos: () => api<{ login: string; repos: GitHubRepo[] }>("/api/github/repos"),
  disconnectGithub: () => api<{ disconnected: boolean }>("/api/agent/github", { method: "DELETE" }),
  linkRepo: (id: string, repo: string, branch?: string) => api<{ repo: string; branch: string; baseSha: string; repoPath: string; url: string; files: number }>(`/api/agent/tasks/${enc(id)}/repo`, { method: "POST", json: { repo, branch } }),
  /** What Export would do (no side effects), for the confirmation dialog. */
  exportPlan: (id: string) => api<ExportPlan>(`/api/agent/tasks/${enc(id)}/export/plan`, { method: "POST", json: {} }),
  exportToGithub: (id: string, body: ExportRequest) => api<ExportResult>(`/api/agent/tasks/${enc(id)}/export`, { method: "POST", json: body }),

  preview: (id: string, dir?: string) => api<PreviewInfo>(`/api/agent/tasks/${enc(id)}/preview${dir ? `?dir=${enc(dir)}` : ""}`),
  /** Bring an archived workspace back without starting a run; 409 while running. */
  restoreWorkspace: (id: string) => api<RestoreResult>(`/api/agent/tasks/${enc(id)}/workspace/restore`, { method: "POST", json: {} }),
  previewScreenshot: (id: string) => api<ScreenshotResult>(`/api/agent/tasks/${enc(id)}/preview/screenshot`, { method: "POST", json: {} }),

  taskDeployments: (id: string) => api<TaskDeployments>(`/api/agent/tasks/${enc(id)}/deployments`, { cache: "no-store" }),
  removeTaskDeployment: (id: string, deploymentId: string) => api<{ deployments: DeploymentView[] }>(`/api/agent/tasks/${enc(id)}/deployments/${enc(deploymentId)}`, { method: "DELETE" }),
  /** Legacy global list and removal (kept for older screens). */
  deployments: () => api<{ deployments: Deployment[]; configured: { ok: boolean } }>("/api/agent/deployments"),
  removeDeployment: (id: string) => api<{ deleted: boolean }>(`/api/agent/deployments/${enc(id)}`, { method: "DELETE" }),

  /** Fetch the live-view address on demand (it is never in the event log). */
  browserStatus: (id: string, sessionId: string, fresh = false) => api<BrowserStatus>(`/api/agent/tasks/${enc(id)}/browser/${enc(sessionId)}${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }),
  /** Resolves with status "ended" (HTTP 410) when the session is gone; 429 if called again within 5 s. */
  browserReconnect: async (id: string, sessionId: string): Promise<BrowserStatus> => {
    try {
      return await api<BrowserStatus>(`/api/agent/tasks/${enc(id)}/browser/${enc(sessionId)}/reconnect`, { method: "POST", json: {} });
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        const body = (error.data ?? {}) as Partial<BrowserStatus>;
        return { status: "ended", viewer: null, title: body.title ?? "", url: body.url ?? "" };
      }
      throw error;
    }
  },
};

export const authApi = {
  login: (password: string) => api<{ ok: true }>("/api/auth/login", { method: "POST", json: { password } }),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST", json: {} }),
};

// ---- Accounts, credits and the operator's dashboard ----

export type Account = { id: string; role: "admin" | "user"; login: string | null; displayName: string; avatarUrl: string | null; email: string | null };
/**
 * plan: a plan started, was extended or ended (amount 0; the detail says which and until when).
 * welcome: the credits a new account starts with; reward: credits earned on X.
 */
export type CreditEvent = { kind: "usage" | "grant" | "promo" | "adjust" | "plan" | "welcome" | "reward"; amount: number; detail: string | null; taskId: string | null; at: string };
export type AccountInfo = { user: Account; credits: CreditBalance; github: { configured: boolean; connected: boolean; login: string | null }; voice?: { available: boolean } };

/** A binary response (audio) with the same error handling as api(). */
async function apiBlob(path: string, init: RequestInit & { json?: unknown }): Promise<Blob> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...rest, headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  if (response.ok) return response.blob();
  if (response.status === 401) window.dispatchEvent(new Event("curialy:unauthorized"));
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  throw new ApiError(typeof body.error === "string" && body.error ? body.error : fallbackMessage(response.status), response.status, typeof body.code === "string" ? body.code : undefined, undefined, body);
}

export const voiceApi = {
  /** Dictation: a recording to text (charged per audio minute on free accounts). */
  transcribe: (audio: Blob, language?: string, signal?: AbortSignal) => {
    const body = new FormData();
    body.append("audio", audio, `dictation.${audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm"}`);
    if (language) body.append("language", language);
    return api<{ text: string; seconds: number; language: string | null }>("/api/agent/voice/transcribe", { method: "POST", body, signal });
  },
  /** An answer read aloud (MP3). */
  speech: (taskId: string, text: string, signal?: AbortSignal) => apiBlob(`/api/agent/tasks/${encodeURIComponent(taskId)}/speech`, { method: "POST", json: { text }, signal }),
};

/** Developer API keys: the secret comes back from create() once and is never shown again. */
export const developerApi = {
  keys: () => api<{ keys: ApiKeyInfo[] }>("/api/keys"),
  create: (name: string, models: string[]) => api<{ key: ApiKeyInfo; secret: string }>("/api/keys", { method: "POST", json: { name, models } }),
  revoke: (id: string) => api<{ key: ApiKeyInfo }>(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** A claimed X reward: what it paid, the rewards afterwards and the balance. */
export type RewardClaimed = { credits: number; apiUsd: number; state: RewardsState; balance: CreditBalance };

export const accountApi = {
  get: () => api<AccountInfo>("/api/account"),
  credits: () => api<{ credits: CreditBalance; history: CreditEvent[] }>("/api/account/credits"),
  redeem: (code: string) => api<{ credits: number; balance: CreditBalance }>("/api/account/redeem", { method: "POST", json: { code } }),
  /** The X rewards: 409 codes not_linked, already_claimed, not_following, post_invalid, x_taken, locked; 503 unavailable/busy when X can't be asked. */
  rewards: () => api<{ rewards: RewardsState }>("/api/account/rewards", { cache: "no-store" }),
  linkX: (username: string) => api<{ rewards: RewardsState }>("/api/account/rewards/x", { method: "POST", json: { username } }),
  unlinkX: () => api<{ rewards: RewardsState }>("/api/account/rewards/x", { method: "DELETE" }),
  claimFollow: () => api<RewardClaimed>("/api/account/rewards/follow", { method: "POST", json: {} }),
  claimPost: (url: string) => api<RewardClaimed>("/api/account/rewards/post", { method: "POST", json: { url } }),
};

export type AdminUser = {
  id: string; role: "admin" | "user"; login: string | null; name: string; avatarUrl: string | null; email: string | null; createdAt: string; lastSeenAt: string | null;
  banned: boolean; tasks: number; activeRuns: number; creditsUsedTotal: number; customAllowance: number | null; credits: CreditBalance;
  /** withheld: the account has no free allowance (an own allowance still applies); note: the server's explanation, for the operator. */
  freeAllowance?: { withheld: boolean; related: number; note: string | null };
  /** The active plan (null: none, or it has ended), and the Developer API balance in US dollars. */
  plan: { id: "pro" | "max"; name: string; expiresAt: string; creditsPerWindow: number } | null;
  apiBalanceUsd: number;
  /** The X account linked for rewards and which rewards it claimed (null: none linked). */
  x?: { username: string; followed: boolean; posted: boolean } | null;
};
export type PromoCode = {
  id: string; code: string; credits: number; forUser: { id: string; login: string | null } | null; maxRedemptions: number | null; redemptions: number;
  expiresAt: string | null; disabledAt: string | null; note: string | null; createdAt: string; state: "active" | "used_up" | "expired" | "disabled";
};
export type AdminOverview = { users: number; newToday: number; activeToday: number; activeRuns: number; creditsUsedToday: number; activePromoCodes: number; settings: CreditSettings };

export const adminApi = {
  overview: () => api<AdminOverview>("/api/admin/overview"),
  users: (q = "", offset = 0) => api<{ users: AdminUser[]; more: boolean }>(`/api/admin/users?q=${encodeURIComponent(q)}&offset=${offset}`),
  history: (id: string) => api<{ credits: CreditBalance; history: CreditEvent[] }>(`/api/admin/users/${id}/credits`),
  grant: (id: string, amount: number, note: string) => api<{ credits: CreditBalance }>(`/api/admin/users/${id}/credits`, { method: "POST", json: { amount, note } }),
  allowance: (id: string, allowance: number | null) => api<{ credits: CreditBalance }>(`/api/admin/users/${id}/allowance`, { method: "PUT", json: { allowance } }),
  freeAllowance: (id: string, withheld: boolean) => api<{ credits: CreditBalance }>(`/api/admin/users/${id}/free-allowance`, { method: "PUT", json: { withheld } }),
  ban: (id: string, banned: boolean) => api<{ banned: boolean }>(`/api/admin/users/${id}/ban`, { method: "POST", json: { banned } }),
  /** Forget an account's X link and claims (its credits stay). */
  resetX: (id: string) => api<{ credits: CreditBalance; history: CreditEvent[] }>(`/api/admin/users/${id}/x/reset`, { method: "POST", json: {} }),
  promoCodes: () => api<{ codes: PromoCode[] }>("/api/admin/promo-codes"),
  createPromoCode: (input: { code?: string; credits: number; forUserId?: string | null; maxRedemptions?: number | null; expiresAt?: string | null; note?: string }) =>
    api<{ code: PromoCode }>("/api/admin/promo-codes", { method: "POST", json: input }),
  disablePromoCode: (id: string) => api<{ codes: PromoCode[] }>(`/api/admin/promo-codes/${id}/disable`, { method: "POST", json: {} }),
  settings: () => api<{ settings: CreditSettings }>("/api/admin/settings"),
  saveSettings: (patch: CreditSettingsPatch) => api<{ settings: CreditSettings }>("/api/admin/settings", { method: "PUT", json: patch }),
};

/** A change to the credit settings: the rewards and the boost merge field by field on the server. */
export type CreditSettingsPatch = Partial<Omit<CreditSettings, "rewards">> & { rewards?: Partial<Omit<CreditSettings["rewards"], "boost">> & { boost?: Partial<CreditSettings["rewards"]["boost"]> } };

/** The message to show for any thrown value. */
export function errorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatBytes(value: number) {
  if (Math.abs(value) >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (Math.abs(value) >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function relativeTime(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
