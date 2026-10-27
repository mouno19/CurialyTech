import { useCallback, useEffect, useRef, useState } from "react";
import type { DeploymentState } from "@shared/taskStatus";
import { agentApi, errorMessage, type DeploymentView, type PreviewReady, type PreviewUnavailable, type TaskDeployments } from "@/lib/api";
import { usePoll } from "./useTaskRow";

/** The server's state is authoritative, but expiry also happens on the clock: past expiresAt is never live. */
export function effectiveDeploymentState(deployment: Pick<DeploymentView, "state" | "expiresAt">, now: number): DeploymentState {
  const expires = Date.parse(deployment.expiresAt);
  if (deployment.state === "live" && Number.isFinite(expires) && expires <= now) return "expired";
  return deployment.state;
}

export type DeploymentsData = {
  list: DeploymentView[] | null;
  capabilities: TaskDeployments["capabilities"] | null;
  error: string | null;
  loading: boolean;
  now: number;
  /** Deployments that are live right now (server state and clock agree). */
  live: DeploymentView[];
  refresh: () => Promise<void>;
  remove: (deploymentId: string) => Promise<void>;
};

/**
 * GET /tasks/:id/deployments: on mount, whenever `refreshKey` changes (deployment events, the
 * stream ending), every 60 s while one is live, and right after the earliest live one expires.
 */
export function useDeployments(taskId: string, refreshKey: string | number): DeploymentsData {
  const [data, setData] = useState<TaskDeployments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await agentApi.taskDeployments(taskId);
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
      setNow(Date.now());
    } catch (failure) {
      if (mine === seq.current) setError(errorMessage(failure, "Couldn't load the live previews."));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const list = data?.deployments ?? null;
  const live = (list ?? []).filter(deployment => effectiveDeploymentState(deployment, now) === "live");
  usePoll(refresh, 60_000, live.length > 0);

  const nextExpiry = Math.min(...live.map(deployment => Date.parse(deployment.expiresAt)).filter(Number.isFinite));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const wait = Math.min(Math.max(0, nextExpiry - Date.now()) + 250, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      setNow(Date.now());
      void refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [nextExpiry, refresh]);

  const remove = useCallback(async (deploymentId: string) => {
    const result = await agentApi.removeTaskDeployment(taskId, deploymentId);
    setData(current => ({ deployments: result.deployments, capabilities: current?.capabilities ?? { configured: true, github: true } }));
    setNow(Date.now());
  }, [taskId]);

  return { list, capabilities: data?.capabilities ?? null, error, loading, now, live, refresh, remove };
}

export type WorkspacePreviewState =
  | { phase: "checking" }
  | { phase: "ready"; info: PreviewReady }
  | { phase: "unavailable"; info: PreviewUnavailable }
  | { phase: "error"; message: string };

export type WorkspacePreviewData = {
  state: WorkspacePreviewState;
  checkedAt: number;
  refreshing: boolean;
  refresh: () => Promise<void>;
  restore: () => Promise<void>;
  restoring: boolean;
  restoreError: string | null;
};

/** GET /tasks/:id/preview: whether the workspace has a site to show, or why not (archived, no build). */
export function useWorkspacePreview(taskId: string, refreshKey: string | number): WorkspacePreviewData {
  const [state, setState] = useState<WorkspacePreviewState>({ phase: "checking" });
  const [checkedAt, setCheckedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!taskId) return;
    const mine = ++seq.current;
    setRefreshing(true);
    try {
      const info = await agentApi.preview(taskId);
      if (mine !== seq.current) return;
      setState(info.available ? { phase: "ready", info } : { phase: "unavailable", info });
    } catch (failure) {
      if (mine === seq.current) setState({ phase: "error", message: errorMessage(failure, "Couldn't check the workspace for a preview.") });
    } finally {
      if (mine === seq.current) {
        setRefreshing(false);
        setCheckedAt(Date.now());
      }
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const restore = useCallback(async () => {
    if (!taskId) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await agentApi.restoreWorkspace(taskId);
      await refresh();
    } catch (failure) {
      setRestoreError(errorMessage(failure, "Couldn't restore the workspace."));
    } finally {
      setRestoring(false);
    }
  }, [taskId, refresh]);

  return { state, checkedAt, refreshing, refresh, restore, restoring, restoreError };
}
