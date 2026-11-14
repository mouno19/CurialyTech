import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getConnection, githubApi, GitHubError, githubAutoApprove, resolveRepo } from "../services/github";
import { digestOutput } from "./output";
import { linkedRepo } from "./repos";
import { askApproval, type ApprovalRequest } from "./requests";
import { clip } from "./sandbox";
import { taskOwner } from "./store";
import type { ToolContext, ToolOutcome } from "./tools";

// GitHub beyond files: commits, build statuses and GitHub Actions (workflows, runs, jobs and their
// logs), with the task owner's own connection, through the REST API (the token never enters the
// sandbox, so there is no gh CLI there). Starting, rerunning or cancelling a workflow changes
// something on GitHub: like a push, it waits for the user's approval in the chat first.

const repo = z.string().trim().max(200).optional();
const id = z.coerce.number().int().positive();
const ref = z.string().trim().min(1).max(200);

export const GITHUB_CI_SCHEMAS = {
  github_list_commits: z.object({ repo, branch: ref.optional(), path: z.string().trim().max(500).optional(), limit: z.coerce.number().int().min(1).max(50).default(10) }),
  github_get_commit: z.object({ repo, ref }),
  github_check_status: z.object({ repo, ref: ref.optional() }),
  github_list_workflows: z.object({ repo }),
  github_list_runs: z.object({
    repo,
    workflow: ref.optional(),
    branch: ref.optional(),
    status: z.enum(["queued", "in_progress", "completed", "success", "failure", "cancelled", "waiting", "action_required"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
  github_get_run: z.object({ repo, run_id: id }),
  github_run_logs: z.object({ repo, run_id: id.optional(), job_id: id.optional(), failed_only: z.boolean().default(true), from_line: id.optional(), lines: z.coerce.number().int().min(1).max(400).default(200) })
    .refine(value => value.run_id || value.job_id, { message: "Pass run_id (a workflow run) or job_id (one job)." })
    .refine(value => !value.from_line || value.job_id, { message: "from_line reads one job's complete log: pass job_id too." }),
  github_run_workflow: z.object({ repo, workflow: ref, ref: ref.optional(), inputs: z.record(z.string(), z.string().max(1000)).optional() }),
  github_rerun: z.object({ repo, run_id: id, failed_only: z.boolean().default(true) }),
  github_cancel_run: z.object({ repo, run_id: id }),
};

export type GitHubCiToolName = keyof typeof GITHUB_CI_SCHEMAS;
/** Changes on GitHub: each waits for the user's approval. */
export const GITHUB_CI_WRITE_TOOLS = new Set<GitHubCiToolName>(["github_run_workflow", "github_rerun", "github_cancel_run"]);
export const GITHUB_CI_READ_TOOLS = (Object.keys(GITHUB_CI_SCHEMAS) as GitHubCiToolName[]).filter(name => !GITHUB_CI_WRITE_TOOLS.has(name));

const REPO = { type: "string", description: "owner/name or a bare name; default: the repository cloned in this task" };
const RUN = { type: "number", description: "The workflow run's id (from github_list_runs)" };

export const GITHUB_CI_TOOLS: (Anthropic.Tool & { name: GitHubCiToolName })[] = [
  {
    name: "github_list_commits",
    description: "Recent commits of a branch (default: the repository's default branch), newest first: sha, author, date, message. path limits it to commits touching that file or folder.",
    input_schema: { type: "object", properties: { repo: REPO, branch: { type: "string" }, path: { type: "string" }, limit: { type: "number", description: "1-50, default 10" } } },
  },
  {
    name: "github_get_commit",
    description: "One commit in detail: message, author, the files it changed (with line counts) and its build status (checks and statuses). ref: a sha, branch or tag.",
    input_schema: { type: "object", properties: { repo: REPO, ref: { type: "string" } }, required: ["ref"] },
  },
  {
    name: "github_check_status",
    description: "Build status of a commit or branch (default: the default branch): every check run and commit status with its result, and the overall state.",
    input_schema: { type: "object", properties: { repo: REPO, ref: { type: "string", description: "sha, branch or tag" } } },
  },
  {
    name: "github_list_workflows",
    description: "The repository's GitHub Actions workflows: name, file and whether each is active.",
    input_schema: { type: "object", properties: { repo: REPO } },
  },
  {
    name: "github_list_runs",
    description: "Recent GitHub Actions runs, newest first: id, workflow, run number, event, branch, commit, status and conclusion. Filter by workflow (name or file), branch or status (failure for failed builds).",
    input_schema: {
      type: "object",
      properties: {
        repo: REPO,
        workflow: { type: "string", description: "Workflow name, file (ci.yml) or id" },
        branch: { type: "string" },
        status: { type: "string", enum: ["queued", "in_progress", "completed", "success", "failure", "cancelled", "waiting", "action_required"] },
        limit: { type: "number", description: "1-50, default 10" },
      },
    },
  },
  {
    name: "github_get_run",
    description: "One workflow run: its status, conclusion, trigger and commit, and every job with its steps (which step failed).",
    input_schema: { type: "object", properties: { repo: REPO, run_id: RUN }, required: ["run_id"] },
  },
  {
    name: "github_run_logs",
    description: "The logs of a workflow run's jobs (failed_only, the default: just the failed jobs), or of one job (job_id): the first lines, the lines that look like errors and the last lines of each. For a job's complete log, page through it with job_id, from_line (1 = the start) and lines (up to 400).",
    input_schema: { type: "object", properties: { repo: REPO, run_id: RUN, job_id: { type: "number", description: "One job's id (from github_get_run)" }, failed_only: { type: "boolean" }, from_line: { type: "number", description: "Read the complete log from this line (needs job_id)" }, lines: { type: "number", description: "How many lines from from_line: 1-400, default 200" } } },
  },
  {
    name: "github_run_workflow",
    description: "Start a workflow that has a workflow_dispatch trigger, on ref (default: the repository's default branch), with its inputs. Changes something on GitHub: the user is asked to approve it first.",
    input_schema: { type: "object", properties: { repo: REPO, workflow: { type: "string", description: "Workflow name, file (deploy.yml) or id" }, ref: { type: "string" }, inputs: { type: "object", additionalProperties: { type: "string" } } }, required: ["workflow"] },
  },
  {
    name: "github_rerun",
    description: "Rerun a finished workflow run: its failed jobs (failed_only, the default) or all of them. Changes something on GitHub: the user is asked to approve it first.",
    input_schema: { type: "object", properties: { repo: REPO, run_id: RUN, failed_only: { type: "boolean" } }, required: ["run_id"] },
  },
  {
    name: "github_cancel_run",
    description: "Cancel a queued or running workflow run. Changes something on GitHub: the user is asked to approve it first.",
    input_schema: { type: "object", properties: { repo: REPO, run_id: RUN }, required: ["run_id"] },
  },
];

type Ctx = Pick<ToolContext, "sessionId" | "emit" | "signal">;

/**
 * Ask the task owner before changing something on GitHub (unless they turned asking off). A
 * refusal comes back as the outcome to return; null: go ahead.
 */
export async function approveOnGitHub(ctx: Ctx, owner: string, request: ApprovalRequest): Promise<ToolOutcome | null> {
  const autoApprove = await githubAutoApprove(owner).catch(() => false);
  const answer = await askApproval({ taskId: ctx.sessionId, emit: ctx.emit, signal: ctx.signal }, request, { autoApprove });
  return answer.approved ? null : { ok: false, declined: true, content: answer.message, summary: "Not approved" };
}

const one = (value: unknown, max = 120) => (typeof value === "string" && value.trim() ? value.trim().split("\n")[0].slice(0, max) : null);
const when = (value: unknown) => (typeof value === "string" && value ? `${value.slice(0, 16).replace("T", " ")} UTC` : "?");
const short = (sha: unknown) => (typeof sha === "string" ? sha.slice(0, 7) : "?");
const result = (item: { status?: string; conclusion?: string | null }) => (item.status === "completed" ? item.conclusion ?? "completed" : item.status ?? "?");

/** A job's log: the head and a long tail (failures are at the end), not the whole of a huge log. */
async function readCapped(response: Response, headMax = 64 * 1024, tailMax = 1_500_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let head = "";
  let tail = "";
  let dropped = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let text = decoder.decode(value, { stream: true });
    if (head.length < headMax) {
      const take = headMax - head.length;
      head += text.slice(0, take);
      text = text.slice(take);
    }
    tail += text;
    if (tail.length > tailMax * 2) {
      dropped += tail.length - tailMax;
      tail = tail.slice(-tailMax);
    }
  }
  if (tail.length > tailMax) {
    dropped += tail.length - tailMax;
    tail = tail.slice(-tailMax);
  }
  return dropped ? `${head}\n… [${dropped} characters of the log left out] …\n${tail.slice(tail.indexOf("\n") + 1)}` : head + tail;
}

/** Log lines without their timestamps and group markers. */
const tidyLog = (text: string) => text.split("\n")
  .map(line => line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/, ""))
  .filter(line => !line.startsWith("##[endgroup]"))
  .map(line => line.replace(/^##\[group\]/, "▸ "))
  .join("\n");

async function jobLog(token: string, fullName: string, jobId: number, signal?: AbortSignal) {
  const path = `/repos/${fullName}/actions/jobs/${jobId}/logs`;
  // GitHub answers with a redirect to a short-lived address; the token isn't sent there.
  const response = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "curialy-ai" }, redirect: "follow", signal });
  if (response.status === 410 || response.status === 404) return null;
  if (!response.ok) throw new GitHubError(`GitHub GET ${path} failed (${response.status})`, response.status);
  return tidyLog(await readCapped(response));
}

/** The task owner's GitHub account, every time (never one named in the input). */
export async function runGitHubCiTool(name: GitHubCiToolName, input: any, ctx: Ctx): Promise<ToolOutcome> {
  const owner = await taskOwner(ctx.sessionId);
  const connection = owner ? await getConnection(owner) : null;
  if (!owner || !connection) return { ok: false, content: "GitHub is not connected. Ask the user to click Connect repositories in the sidebar.", summary: "GitHub not connected" };
  const { token, login } = connection;
  const api = <T = any>(path: string, init: RequestInit = {}) => githubApi<T>(token, path, { ...init, signal: ctx.signal });

  const target = async () => {
    const wanted = (input.repo as string | undefined)?.trim();
    if (!wanted) {
      const linked = await linkedRepo(ctx.sessionId);
      if (!linked) throw new Error("No repository is cloned in this task: pass repo (owner/name).");
      return { fullName: linked.fullName, defaultBranch: linked.branch };
    }
    const match = await resolveRepo(token, wanted);
    if (match.repo) return { fullName: match.repo.full_name, defaultBranch: match.repo.default_branch };
    if (!match.candidates.length && /^[A-Za-z0-9._-]+$/.test(wanted)) {
      const own = await api(`/repos/${login}/${wanted}`).catch(() => null);
      if (own?.full_name) return { fullName: own.full_name as string, defaultBranch: own.default_branch as string };
    }
    throw new Error(match.candidates.length ? `"${wanted}" matches several repositories: ${match.candidates.map(item => item.full_name).join(", ")}. Pass owner/name.` : `No repository matching "${wanted}" in ${login}'s account.`);
  };

  const findWorkflow = async (fullName: string, wanted: string) => {
    const { workflows } = await api<{ workflows: any[] }>(`/repos/${fullName}/actions/workflows?per_page=100`);
    const key = wanted.trim().toLowerCase();
    const found = workflows.find(item => String(item.id) === key || String(item.path).toLowerCase() === key || String(item.path).toLowerCase().endsWith(`/${key}`) || String(item.name).toLowerCase() === key);
    if (!found) throw new Error(`No workflow "${wanted}" in ${fullName}. Its workflows: ${workflows.map(item => `${item.name} (${String(item.path).split("/").pop()})`).join(", ") || "none"}.`);
    return found as { id: number; name: string; path: string; state: string };
  };

  const statusLines = async (fullName: string, at: string) => {
    const [combined, checks] = await Promise.all([
      api<{ state: string; statuses: any[] }>(`/repos/${fullName}/commits/${encodeURIComponent(at)}/status`).catch(() => null),
      api<{ total_count: number; check_runs: any[] }>(`/repos/${fullName}/commits/${encodeURIComponent(at)}/check-runs?per_page=50`).catch(() => null),
    ]);
    const lines = [
      ...(checks?.check_runs ?? []).map(run => `- check ${one(run.name)}: ${result(run)}${one(run.app?.name) ? ` (${one(run.app.name)})` : ""}${run.html_url ? ` ${run.html_url}` : ""}`),
      ...(combined?.statuses ?? []).map(status => `- status ${one(status.context)}: ${one(status.state)}${one(status.description) ? ` · ${one(status.description, 160)}` : ""}`),
    ];
    const failing = (checks?.check_runs ?? []).filter(run => ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion)).length + (combined?.statuses ?? []).filter(status => ["failure", "error"].includes(status.state)).length;
    const pendingCount = (checks?.check_runs ?? []).filter(run => run.status !== "completed").length + (combined?.statuses ?? []).filter(status => status.state === "pending").length;
    const overall = !lines.length ? "no checks" : failing ? "failing" : pendingCount ? "pending" : "passing";
    return { overall, lines, failing, pending: pendingCount };
  };

  switch (name) {
    case "github_list_commits": {
      const { branch, path, limit } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_list_commits>;
      const { fullName } = await target();
      const query = new URLSearchParams({ per_page: String(limit), ...(branch ? { sha: branch } : {}), ...(path ? { path } : {}) });
      const commits = await api<any[]>(`/repos/${fullName}/commits?${query}`);
      const lines = commits.map(item => `- ${short(item.sha)} · ${when(item.commit?.author?.date)} · ${one(item.author?.login) ?? one(item.commit?.author?.name) ?? "?"} · ${one(item.commit?.message, 120) ?? ""}`);
      return { ok: true, content: [`${commits.length} commit(s) on ${fullName}${branch ? `@${branch}` : ""}${path ? ` touching ${path}` : ""}, newest first:`, ...lines].join("\n"), summary: `${commits.length} commits` };
    }
    case "github_get_commit": {
      const { ref: at } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_get_commit>;
      const { fullName } = await target();
      const commit = await api<any>(`/repos/${fullName}/commits/${encodeURIComponent(at)}`);
      const files = (commit.files ?? []) as any[];
      const status = await statusLines(fullName, commit.sha);
      const content = [
        `${short(commit.sha)} on ${fullName} by ${one(commit.author?.login) ?? one(commit.commit?.author?.name) ?? "?"}, ${when(commit.commit?.author?.date)}: ${commit.html_url}`,
        `Message: ${String(commit.commit?.message ?? "").slice(0, 1500)}`,
        `Changed ${files.length} file(s), +${commit.stats?.additions ?? 0} −${commit.stats?.deletions ?? 0}:`,
        ...files.slice(0, 60).map(file => `- ${file.status} ${file.filename} (+${file.additions} −${file.deletions})`),
        files.length > 60 ? `… and ${files.length - 60} more` : "",
        `Build status: ${status.overall}`,
        ...status.lines,
      ].filter(Boolean).join("\n");
      return { ok: true, content: clip(content, 16_000), summary: `${short(commit.sha)} · ${status.overall}` };
    }
    case "github_check_status": {
      const { fullName, defaultBranch } = await target();
      const at = (input as z.infer<typeof GITHUB_CI_SCHEMAS.github_check_status>).ref ?? defaultBranch;
      const status = await statusLines(fullName, at);
      return { ok: true, content: [`Build status of ${fullName}@${at}: ${status.overall}${status.failing ? ` (${status.failing} failing)` : ""}${status.pending ? ` (${status.pending} still running)` : ""}`, ...status.lines].join("\n"), summary: `${at}: ${status.overall}` };
    }
    case "github_list_workflows": {
      const { fullName } = await target();
      const { workflows } = await api<{ workflows: any[] }>(`/repos/${fullName}/actions/workflows?per_page=100`);
      const lines = workflows.map(item => `- ${one(item.name)} · ${item.path} · ${item.state} · id ${item.id}`);
      return { ok: true, content: [workflows.length ? `${workflows.length} workflow(s) in ${fullName}:` : `${fullName} has no GitHub Actions workflows.`, ...lines].join("\n"), summary: `${workflows.length} workflows` };
    }
    case "github_list_runs": {
      const { workflow, branch, status, limit } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_list_runs>;
      const { fullName } = await target();
      const query = new URLSearchParams({ per_page: String(limit), ...(branch ? { branch } : {}), ...(status ? { status } : {}) });
      const base = workflow ? `/repos/${fullName}/actions/workflows/${(await findWorkflow(fullName, workflow)).id}/runs` : `/repos/${fullName}/actions/runs`;
      const { workflow_runs: runs } = await api<{ workflow_runs: any[] }>(`${base}?${query}`);
      const lines = runs.map(run => `- ${run.id} · ${one(run.name)} #${run.run_number}${run.run_attempt > 1 ? ` (attempt ${run.run_attempt})` : ""} · ${result(run)} · ${run.event} · ${one(run.head_branch) ?? "?"}@${short(run.head_sha)} · ${when(run.created_at)}${one(run.display_title, 80) ? ` · ${one(run.display_title, 80)}` : ""}`);
      return { ok: true, content: [runs.length ? `${runs.length} run(s) in ${fullName}, newest first:` : `No workflow runs in ${fullName} match.`, ...lines].join("\n"), summary: `${runs.length} runs` };
    }
    case "github_get_run": {
      const { run_id: runId } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_get_run>;
      const { fullName } = await target();
      const [run, { jobs }] = await Promise.all([api<any>(`/repos/${fullName}/actions/runs/${runId}`), api<{ jobs: any[] }>(`/repos/${fullName}/actions/runs/${runId}/jobs?per_page=100&filter=latest`)]);
      const lines = [
        `${one(run.name)} #${run.run_number}${run.run_attempt > 1 ? ` (attempt ${run.run_attempt})` : ""} on ${fullName}: ${result(run)} · ${run.event} · ${one(run.head_branch)}@${short(run.head_sha)} · started ${when(run.run_started_at ?? run.created_at)} · ${run.html_url}`,
        one(run.display_title, 200) ? `Title: ${one(run.display_title, 200)}` : "",
        `${jobs.length} job(s):`,
        ...jobs.flatMap(job => [
          `- job ${job.id} ${one(job.name)}: ${result(job)}${job.started_at && job.completed_at ? ` (${Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000)} s)` : ""}`,
          ...((job.steps ?? []) as any[]).filter(step => step.conclusion !== "success" && step.conclusion !== "skipped").map(step => `    step ${step.number} ${one(step.name)}: ${result(step)}`),
        ]),
        jobs.some(job => job.conclusion === "failure") ? "Read why with github_run_logs." : "",
      ];
      return { ok: true, content: clip(lines.filter(Boolean).join("\n"), 12_000), summary: `${one(run.name)} #${run.run_number}: ${result(run)}` };
    }
    case "github_run_logs": {
      const { run_id: runId, job_id: jobId, failed_only: failedOnly, from_line: fromLine, lines: count } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_run_logs>;
      const { fullName } = await target();
      if (fromLine && jobId) {
        const log = await jobLog(token, fullName, jobId, ctx.signal);
        if (log === null) return { ok: false, content: `Job ${jobId}'s log is no longer available: GitHub keeps logs for a limited time.`, summary: "Log expired" };
        const all = log.split("\n");
        const slice = all.slice(fromLine - 1, fromLine - 1 + count);
        const end = fromLine - 1 + slice.length;
        const more = end < all.length ? `\n[lines ${end + 1}–${all.length} remain: from_line ${end + 1}]` : "\n[end of the log]";
        return { ok: true, content: clip(`Job ${jobId}, lines ${fromLine}–${end} of ${all.length}:\n${slice.join("\n")}${more}`, 40_000), summary: `Lines ${fromLine}–${end} of ${all.length}` };
      }
      let jobs: { id: number; name: string; conclusion: string | null; status: string }[];
      if (jobId) jobs = [await api(`/repos/${fullName}/actions/jobs/${jobId}`)];
      else {
        const all = (await api<{ jobs: any[] }>(`/repos/${fullName}/actions/runs/${runId}/jobs?per_page=100&filter=latest`)).jobs;
        jobs = failedOnly ? all.filter(job => ["failure", "timed_out", "cancelled"].includes(job.conclusion)) : all;
        if (!jobs.length) return { ok: true, content: failedOnly ? `No job of run ${runId} failed${all.some(job => job.status !== "completed") ? " (some are still running)" : ""}. Pass failed_only: false for every job's log.` : `Run ${runId} has no jobs.`, summary: "No failed jobs" };
      }
      const budget = Math.max(4000, Math.floor(24_000 / Math.min(jobs.length, 6)));
      const parts: string[] = [];
      for (const job of jobs.slice(0, 6)) {
        const log = await jobLog(token, fullName, job.id, ctx.signal);
        parts.push(`=== job ${job.id} ${one(job.name)}: ${result(job)} ===\n${log === null ? "(its log is no longer available: GitHub keeps logs for a limited time)" : digestOutput(log, { head: 10, tail: 50, maxChars: budget, rest: "Pass job_id for one job alone." })}`);
      }
      if (jobs.length > 6) parts.push(`… and ${jobs.length - 6} more job(s): pass job_id for each.`);
      return { ok: true, content: parts.join("\n\n"), summary: `Logs of ${Math.min(jobs.length, 6)} job(s)` };
    }
    case "github_run_workflow": {
      const { workflow, ref: wanted, inputs } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_run_workflow>;
      const { fullName, defaultBranch } = await target();
      const found = await findWorkflow(fullName, workflow);
      const at = wanted ?? defaultBranch;
      const entries = Object.entries(inputs ?? {});
      const refused = await approveOnGitHub(ctx, owner, {
        action: name,
        title: `Start the "${found.name}" workflow on ${fullName} (${at})`,
        details: [`Repository: ${fullName}`, `Workflow: ${found.name} (${found.path})`, `On: ${at}`, entries.length ? `Inputs: ${entries.map(([key, value]) => `${key}=${value}`).join(", ")}` : "Inputs: none"],
      });
      if (refused) return refused;
      await api(`/repos/${fullName}/actions/workflows/${found.id}/dispatches`, { method: "POST", body: JSON.stringify({ ref: at, ...(entries.length ? { inputs: Object.fromEntries(entries) } : {}) }) });
      return { ok: true, content: `Started "${found.name}" on ${fullName}@${at}. Its run shows up in github_list_runs (workflow "${found.name}") within a few seconds.`, summary: `Started ${found.name}` };
    }
    case "github_rerun": {
      const { run_id: runId, failed_only: failedOnly } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_rerun>;
      const { fullName } = await target();
      const [run, { jobs }] = await Promise.all([api<any>(`/repos/${fullName}/actions/runs/${runId}`), api<{ jobs: any[] }>(`/repos/${fullName}/actions/runs/${runId}/jobs?per_page=100&filter=latest`)]);
      if (run.status !== "completed") return { ok: false, content: `Run ${runId} is still ${run.status}: only a finished run can be rerun.`, summary: "Still running" };
      const failed = jobs.filter(job => ["failure", "timed_out", "cancelled"].includes(job.conclusion));
      if (failedOnly && !failed.length) return { ok: false, content: `No job of run ${runId} failed. Pass failed_only: false to rerun every job.`, summary: "Nothing failed" };
      const refused = await approveOnGitHub(ctx, owner, {
        action: name,
        title: `Rerun ${failedOnly ? `${failed.length} failed job(s) of` : "every job of"} "${one(run.name)}" #${run.run_number} on ${fullName}`,
        details: [`Repository: ${fullName}`, `Run: ${one(run.name)} #${run.run_number} (id ${runId}), ${result(run)}`, `Commit: ${one(run.head_branch)}@${short(run.head_sha)}`, `Jobs to rerun: ${(failedOnly ? failed : jobs).map(job => one(job.name)).join(", ")}`],
      });
      if (refused) return refused;
      await api(`/repos/${fullName}/actions/runs/${runId}/${failedOnly ? "rerun-failed-jobs" : "rerun"}`, { method: "POST", body: "{}" });
      return { ok: true, content: `Rerunning ${failedOnly ? "the failed jobs" : "every job"} of run ${runId}. Check it with github_get_run (its attempt number goes up).`, summary: `Rerun of #${run.run_number}` };
    }
    case "github_cancel_run": {
      const { run_id: runId } = input as z.infer<typeof GITHUB_CI_SCHEMAS.github_cancel_run>;
      const { fullName } = await target();
      const run = await api<any>(`/repos/${fullName}/actions/runs/${runId}`);
      if (run.status === "completed") return { ok: false, content: `Run ${runId} already finished (${result(run)}): there is nothing to cancel.`, summary: "Already finished" };
      const refused = await approveOnGitHub(ctx, owner, {
        action: name,
        title: `Cancel "${one(run.name)}" #${run.run_number} on ${fullName}`,
        details: [`Repository: ${fullName}`, `Run: ${one(run.name)} #${run.run_number} (id ${runId}), ${run.status}`, `Commit: ${one(run.head_branch)}@${short(run.head_sha)}`, `Started: ${when(run.run_started_at ?? run.created_at)}`],
      });
      if (refused) return refused;
      await api(`/repos/${fullName}/actions/runs/${runId}/cancel`, { method: "POST", body: "{}" });
      return { ok: true, content: `Cancelling run ${runId}: GitHub stops its jobs within a few seconds.`, summary: `Cancelled #${run.run_number}` };
    }
  }
}
