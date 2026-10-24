import type { AgentTaskSummary, CreateTaskRequest, ModelSpec } from "@shared/agent";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth")) window.dispatchEvent(new Event("curialy:unauthorized"));
    throw new ApiError(data?.error ?? `Request failed (${response.status})`, response.status);
  }
  return data as T;
}

export type ProviderProbe = { id: string; label: string; ok: boolean; latencyMs: number; detail: string; configured: boolean };
export type KeyStatus = { id: string; label: string; configured: boolean; masked: string | null; note?: string };
export type TreeEntry = { path: string; type: "file" | "dir"; size: number };
export type UploadedFile = { id: string; filename: string; mimeType: string; sizeBytes: number };
export type MediaFile = UploadedFile & { kind: string; sessionId: string | null; createdAt: string };
export type GitHubRepo = { id: number; name: string; full_name: string; private: boolean; default_branch: string; description: string | null; updated_at: string; language: string | null };
export type GitHubStatus = { configured: boolean; connected: boolean; login: string | null; name: string | null; avatarUrl: string | null; scopes: string[]; missingScopes: string[]; connectedAt: string | null };
export type Deployment = { id: string; sessionId: string | null; status: string; url: string | null; repo: string | null; serviceId: string | null; detail: string | null; expiresAt: string; createdAt: string; deletedAt: string | null };

export const agentApi = {
  models: () => api<{ models: ModelSpec[] }>("/api/agent/models"),
  health: (deep = false) => api<{ providers: ProviderProbe[]; activeTasks: number }>(`/api/agent/health${deep ? "?deep=1" : ""}`),
  keys: () => api<{ keys: KeyStatus[] }>("/api/agent/keys"),
  stats: () => api<{ total: number; completed: number; failed: number; running: number; filesChanged: number; active: number }>("/api/agent/stats"),
  tasks: () => api<{ tasks: AgentTaskSummary[] }>("/api/agent/tasks"),
  task: (id: string) => api<{ task: AgentTaskSummary; live: boolean }>(`/api/agent/tasks/${id}`),
  create: (body: CreateTaskRequest) => api<{ taskId: string }>("/api/agent/tasks", { method: "POST", json: body }),
  followUp: (id: string, prompt: string) => api<{ ok: true }>(`/api/agent/tasks/${id}/messages`, { method: "POST", json: { prompt } }),
  cancel: (id: string) => api<{ cancelled: boolean }>(`/api/agent/tasks/${id}/cancel`, { method: "POST", json: {} }),
  remove: (id: string) => api<{ deleted: boolean }>(`/api/agent/tasks/${id}`, { method: "DELETE" }),
  tree: (id: string) => api<{ entries: TreeEntry[]; source: "live" | "archived" }>(`/api/agent/tasks/${id}/tree`),
  file: (id: string, path: string) => api<{ path: string; content: string; bytes: number; binary?: boolean; truncated?: boolean }>(`/api/agent/tasks/${id}/file?path=${encodeURIComponent(path)}`),
  rawFileUrl: (id: string, path: string) => `/api/agent/tasks/${id}/file?raw=1&path=${encodeURIComponent(path)}`,
  downloadUrl: (id: string, path: string) => `/api/agent/tasks/${id}/file?download=1&path=${encodeURIComponent(path)}`,
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const data = await api<{ file: UploadedFile }>("/api/agent/media", { method: "POST", body: form });
    return data.file;
  },
  media: () => api<{ files: MediaFile[]; stage: { ok: boolean; detail: string } }>("/api/agent/media"),
  mediaUrl: (id: string) => `/api/agent/media/${id}`,
  mediaDownloadUrl: (id: string) => `/api/agent/media/${id}?download=1`,
  mediaText: (id: string) => api<{ filename: string; content: string; truncated: boolean; bytes: number }>(`/api/agent/media/${id}/text`),
  removeMedia: (id: string) => api<{ deleted: boolean }>(`/api/agent/media/${id}`, { method: "DELETE" }),
  deployments: () => api<{ deployments: Deployment[]; configured: { ok: boolean; missing: string[] } }>("/api/agent/deployments"),
  github: () => api<GitHubStatus>("/api/agent/github"),
  githubRepos: () => api<{ login: string; repos: GitHubRepo[] }>("/api/github/repos"),
  preview: (id: string) => api<{ available: boolean; dir?: string; url?: string; warnings?: string[]; workspace?: boolean }>(`/api/agent/tasks/${id}/preview`),
  previewScreenshot: (id: string) => api<{ status: number | null; title: string; consoleErrors: string[]; replayUrl: string; image: string | null }>(`/api/agent/tasks/${id}/preview/screenshot`, { method: "POST", json: {} }),
  linkRepo: (id: string, repo: string, branch?: string) => api<{ repo: string; branch: string; baseSha: string; repoPath: string; url: string; files: number }>(`/api/agent/tasks/${id}/repo`, { method: "POST", json: { repo, branch } }),
  disconnectGithub: () => api<{ disconnected: boolean }>("/api/agent/github", { method: "DELETE" }),
  exportToGithub: (id: string, body: { repoName?: string; private: boolean; message?: string; branch?: string }) => api<{ repo: string; url: string; commitUrl: string; files: number; created: boolean; nothingToPush?: boolean; branch?: string }>(`/api/agent/tasks/${id}/export`, { method: "POST", json: body }),
  removeDeployment: (id: string) => api<{ deleted: boolean }>(`/api/agent/deployments/${id}`, { method: "DELETE" }),
};

export const authApi = {
  login: (password: string) => api<{ ok: true }>("/api/auth/login", { method: "POST", json: { password } }),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST", json: {} }),
};

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatBytes(value: number) {
  if (Math.abs(value) >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
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
