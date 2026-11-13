import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { vercelGet } from "../services/vercel";
import { digestOutput } from "./output";
import { clip } from "./sandbox";
import { taskOwner } from "./store";
import type { ToolOutcome } from "./tools";

// The agent's Vercel tools: read only, and always with the connection of the account that owns the
// task (looked up from the task, never taken from the model's input), so one account's token never
// serves another account's request. Results are compact: a project never carries its environment
// variables (only listed fields are read), and a build log comes back as its first lines, the lines
// that look like errors and its last lines.

const team = z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/, "a team slug or id (team_…)").optional();
const deployment = z.string().trim().min(1).max(300);

export const VERCEL_SCHEMAS = {
  vercel_list_projects: z.object({ search: z.string().trim().max(100).optional(), team, limit: z.number().int().min(1).max(50).default(20) }),
  vercel_list_deployments: z.object({
    project: z.string().trim().max(100).optional(),
    team,
    target: z.enum(["production", "preview"]).optional(),
    state: z.enum(["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED"]).optional(),
    branch: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  vercel_get_deployment: z.object({ deployment, team }),
  vercel_build_logs: z.object({ deployment, team, errors_only: z.boolean().default(false) }),
};

export type VercelToolName = keyof typeof VERCEL_SCHEMAS;
export const VERCEL_TOOL_NAMES = Object.keys(VERCEL_SCHEMAS) as VercelToolName[];

const TEAM = { type: "string", description: "A team's slug or id (team_…), for a team's projects. Leave out for the personal account." };
const DEPLOYMENT = { type: "string", description: "The deployment's id (dpl_…) or URL (my-app-abc123.vercel.app)" };

export const VERCEL_TOOLS: (Anthropic.Tool & { name: VercelToolName })[] = [
  {
    name: "vercel_list_projects",
    description: "List the user's Vercel projects (the Vercel account they connected), most recently updated first: name, id, framework, linked Git repository, latest deployment and production URL. search filters by name. Also lists the teams the account can pass as team. Read only.",
    input_schema: { type: "object", properties: { search: { type: "string" }, team: TEAM, limit: { type: "number", description: "1-50, default 20" } } },
  },
  {
    name: "vercel_list_deployments",
    description: "List the user's recent Vercel deployments, newest first: id, project, state (READY, ERROR, BUILDING…), target, URL, commit and the error of a failed one. Filter by project (name or id), target, state or branch. Read only.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id" },
        team: TEAM,
        target: { type: "string", enum: ["production", "preview"] },
        state: { type: "string", enum: ["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED"] },
        branch: { type: "string" },
        limit: { type: "number", description: "1-50, default 10" },
      },
    },
  },
  {
    name: "vercel_get_deployment",
    description: "One Vercel deployment's status in detail: state, target, URL and aliases, commit, timing, and the error when it failed. Read only.",
    input_schema: { type: "object", properties: { deployment: DEPLOYMENT, team: TEAM }, required: ["deployment"] },
  },
  {
    name: "vercel_build_logs",
    description: "A Vercel deployment's build log: its first lines, the lines that look like errors and its last lines; errors_only: just the error and warning lines. Use it to find why a build failed. Read only.",
    input_schema: { type: "object", properties: { deployment: DEPLOYMENT, team: TEAM, errors_only: { type: "boolean" } }, required: ["deployment"] },
  },
];

/** Build-log events read at most (the latest ones): a long build's beginning matters least. */
const LOG_EVENTS = 2000;

const teamParams = (value?: string) => (!value ? {} : value.startsWith("team_") ? { teamId: value } : { slug: value });

/** A deployment as the API takes it: an id, a hostname, or the id inside a URL on vercel.com. */
export function deploymentRef(value: string) {
  let ref = value.trim();
  if (/^https?:\/\//i.test(ref)) {
    try {
      const url = new URL(ref);
      const parts = url.pathname.split("/").filter(Boolean);
      // The dashboard's inspector: vercel.com/<team>/<project>/<id without its dpl_ prefix>.
      ref = url.hostname === "vercel.com" && parts.length >= 3 ? `dpl_${parts[2].replace(/^dpl_/, "")}` : url.hostname;
    } catch {
      // checked below
    }
  }
  ref = ref.replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(ref) || ref.includes("..")) throw new Error("deployment: pass its id (dpl_…) or its URL (my-app-abc123.vercel.app).");
  return ref;
}

const one = (value: unknown, max = 120) => (typeof value === "string" && value.trim() ? value.trim().split("\n")[0].slice(0, max) : null);
const when = (value: unknown) => (typeof value === "number" && value > 0 ? `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC` : null);
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** "owner/repo main 1a2b3c4 "Fix the header"" from a deployment's Git metadata. */
function commitOf(meta: any) {
  if (!meta || typeof meta !== "object") return null;
  for (const host of ["github", "gitlab", "bitbucket"]) {
    const sha = one(meta[`${host}CommitSha`]);
    const ref = one(meta[`${host}CommitRef`]);
    if (!sha && !ref) continue;
    const repo = host === "github" && one(meta.githubCommitOrg) && one(meta.githubCommitRepo) ? `${one(meta.githubCommitOrg)}/${one(meta.githubCommitRepo)}` : null;
    const message = one(meta[`${host}CommitMessage`], 80);
    return [repo, ref, sha?.slice(0, 7), message ? `"${message}"` : null].filter(Boolean).join(" ");
  }
  return null;
}

function deploymentLine(item: any) {
  const error = one(item.errorMessage, 200);
  const parts = [
    one(item.uid ?? item.id), one(item.name), one(item.readyState ?? item.state),
    item.target === "production" ? "production" : one(item.target) ?? "preview",
    when(item.createdAt ?? item.created),
    one(item.url, 200) ? `https://${one(item.url, 200)}` : null,
    commitOf(item.meta),
    error ? `error: ${error}` : null,
  ];
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

function projectLine(project: any) {
  const link = project.link && typeof project.link === "object" ? project.link : null;
  const owner = one(link?.org) ?? one(link?.projectNamespace) ?? one(link?.owner);
  const name = one(link?.repo) ?? one(link?.projectName) ?? one(link?.slug);
  const repo = link ? [one(link.type), [owner, name].filter(Boolean).join("/")].filter(Boolean).join(" ") : null;
  const branch = one(link?.productionBranch);
  const latest = list(project.latestDeployments)[0];
  const production = project.targets?.production;
  const productionUrl = one(list(production?.alias)[0], 200) ?? one(production?.url, 200);
  const parts = [
    one(project.name), one(project.id), one(project.framework) ?? "no framework preset",
    when(project.updatedAt) ? `updated ${when(project.updatedAt)}` : null,
    repo ? `git: ${repo}${branch ? ` (production branch ${branch})` : ""}` : null,
    latest ? `latest deployment: ${[one(latest.readyState), one(latest.uid ?? latest.id)].filter(Boolean).join(" ")}` : null,
    productionUrl ? `production: https://${productionUrl}` : null,
  ];
  return `- ${parts.filter(Boolean).join(" · ")}`;
}

type LogLine = { text: string; error: boolean; warning: boolean };

const ERRORISH = /\berr(?:or)?s?\b|\bERR!|\bfail(?:ed|ure|s)?\b|\bfatal\b|\bexception\b|\bcannot\b|\bnot found\b|exited with|exit code|\bwarn(?:ing)?s?\b/i;

/** A build-log event as one line of text (null: not a line of output). Both of the API's event shapes. */
function logLine(event: any): LogLine | null {
  const type = typeof event?.type === "string" ? event.type : "";
  const text = typeof event?.payload?.text === "string" ? event.payload.text : typeof event?.text === "string" ? event.text : "";
  if (!text.trim() || ["delimiter", "metric", "report", "middleware-invocation", "edge-function-invocation"].includes(type)) return null;
  const level = event?.level ?? event?.payload?.level;
  return { text: type === "command" ? `$ ${text}` : text, error: type === "fatal" || level === "error" || (type === "stderr" && ERRORISH.test(text)), warning: level === "warning" };
}

const eventTime = (event: any) => Number(event?.created ?? event?.date ?? event?.payload?.date ?? 0);

/** One of the Vercel tools, for the account that owns the task. */
export async function runVercelTool(name: VercelToolName, input: unknown, sessionId: string, signal?: AbortSignal): Promise<ToolOutcome> {
  const owner = await taskOwner(sessionId);
  if (!owner) return { ok: false, content: "Vercel isn't available for this task.", summary: "Vercel not available" };
  switch (name) {
    case "vercel_list_projects": {
      const { search, team: scope, limit } = input as z.infer<typeof VERCEL_SCHEMAS.vercel_list_projects>;
      const body = await vercelGet(owner, "/v10/projects", { search, limit, ...teamParams(scope) }, signal);
      const projects = list(body?.projects);
      // Which teams there are, for team-owned projects: a hint only (without permission for it, nothing).
      const teams = scope ? [] : list((await vercelGet(owner, "/v2/teams", { limit: 20 }, signal).catch(() => null))?.teams);
      const teamNames = teams.map(item => (one(item?.slug) ? `${one(item.slug)}${one(item.name) && item.name !== item.slug ? ` (${one(item.name)})` : ""}` : null)).filter(Boolean);
      const where = scope ? ` in team ${scope}` : "";
      const lines = [
        projects.length ? `${projects.length} Vercel project${projects.length === 1 ? "" : "s"}${where}${search ? ` matching "${search}"` : ""}:` : `No Vercel projects${where}${search ? ` matching "${search}"` : ""}.`,
        ...projects.map(projectLine),
        body?.pagination?.next ? "More projects exist: narrow with search." : null,
        teamNames.length ? `Teams (pass one as team for its projects): ${teamNames.join(", ")}` : null,
      ];
      return { ok: true, content: clip(lines.filter(Boolean).join("\n"), 12_000), summary: `${projects.length} Vercel project${projects.length === 1 ? "" : "s"}${where}` };
    }
    case "vercel_list_deployments": {
      const { project, team: scope, target, state, branch, limit } = input as z.infer<typeof VERCEL_SCHEMAS.vercel_list_deployments>;
      const body = await vercelGet(owner, "/v7/deployments", { projectId: project, target, state, branch, limit, ...teamParams(scope) }, signal);
      const deployments = list(body?.deployments);
      const filters = [project && `project ${project}`, target, state, branch && `branch ${branch}`].filter(Boolean).join(", ");
      const lines = [
        deployments.length ? `${deployments.length} deployment${deployments.length === 1 ? "" : "s"}${filters ? ` (${filters})` : ""}, newest first:` : `No deployments${filters ? ` (${filters})` : ""}.`,
        ...deployments.map(deploymentLine),
      ];
      return { ok: true, content: clip(lines.join("\n"), 12_000), summary: `${deployments.length} deployment${deployments.length === 1 ? "" : "s"}` };
    }
    case "vercel_get_deployment": {
      const { deployment: value, team: scope } = input as z.infer<typeof VERCEL_SCHEMAS.vercel_get_deployment>;
      const item = await vercelGet(owner, `/v13/deployments/${encodeURIComponent(deploymentRef(value))}`, teamParams(scope), signal);
      const aliases = list(item?.alias).map(alias => one(alias, 200)).filter(Boolean).slice(0, 10);
      const state = one(item?.readyState) ?? "unknown";
      const building = typeof item?.buildingAt === "number" && typeof item?.ready === "number" && item.ready >= item.buildingAt ? Math.round((item.ready - item.buildingAt) / 1000) : null;
      const error = [one(item?.errorCode), one(item?.errorMessage, 500)].filter(Boolean).join(": ");
      const lines = [
        `Deployment ${one(item?.id) ?? value} of ${one(item?.name) ?? "?"}${one(item?.projectId) ? ` (project ${one(item.projectId)})` : ""}`,
        `State: ${state}${one(item?.readySubstate) ? ` (${one(item.readySubstate)})` : ""} · ${item?.target === "production" ? "production" : one(item?.target) ?? "preview"}`,
        one(item?.url, 200) ? `URL: https://${one(item.url, 200)}` : null,
        aliases.length ? `Aliases: ${aliases.map(alias => `https://${alias}`).join(", ")}` : null,
        commitOf(item?.meta) ? `Commit: ${commitOf(item.meta)}` : null,
        `Created: ${when(item?.createdAt) ?? "?"}${one(item?.creator?.username) ? ` by ${one(item.creator.username)}` : ""}${one(item?.source) ? ` (from ${one(item.source)})` : ""}`,
        building !== null ? `Build took ${building} s` : null,
        error ? `Error: ${error}` : null,
        item?.aliasError ? `Alias error: ${[one(item.aliasError.code), one(item.aliasError.message, 300)].filter(Boolean).join(": ")}` : null,
        item?.oomReport ? "The build ran out of memory." : null,
        one(item?.inspectorUrl, 300) ? `On Vercel: ${one(item.inspectorUrl, 300)}` : null,
        state === "ERROR" ? "Read why with vercel_build_logs." : null,
      ];
      return { ok: true, content: lines.filter(Boolean).join("\n"), summary: `${one(item?.name) ?? "Deployment"}: ${state}` };
    }
    case "vercel_build_logs": {
      const { deployment: value, team: scope, errors_only: errorsOnly } = input as z.infer<typeof VERCEL_SCHEMAS.vercel_build_logs>;
      const ref = deploymentRef(value);
      // The latest events (newest first when read backward), put back in order; never a live stream (follow=0).
      const events = list(await vercelGet(owner, `/v3/deployments/${encodeURIComponent(ref)}/events`, { builds: 1, direction: "backward", follow: 0, limit: LOG_EVENTS, ...teamParams(scope) }, signal));
      if (events.length > 1 && eventTime(events[0]) > eventTime(events[events.length - 1])) events.reverse();
      const lines = events.map(logLine).filter((line): line is LogLine => line !== null);
      if (!lines.length) return { ok: true, content: `No build log for ${ref} (it may not have started building yet, or it was deployed prebuilt).`, summary: "No build log" };
      const errors = lines.filter(line => line.error || line.warning || ERRORISH.test(line.text));
      const cut = events.length >= LOG_EVENTS ? ` (its last ${LOG_EVENTS} events)` : "";
      if (errorsOnly) {
        const shown = errors.length ? errors : lines.slice(-20);
        const header = errors.length ? `${errors.length} error and warning line${errors.length === 1 ? "" : "s"} in the build log of ${ref}${cut}:` : `No line in the build log of ${ref} looks like an error; its last ${shown.length} lines:`;
        return { ok: true, content: clip(`${header}\n${shown.map(line => line.text).join("\n")}`, 12_000), summary: `${errors.length} error line${errors.length === 1 ? "" : "s"}` };
      }
      const digest = digestOutput(lines.map(line => line.text).join("\n"), { head: 15, tail: 40, maxChars: 12_000, rest: "Pass errors_only: true for every error and warning line." });
      return { ok: true, content: `Build log of ${ref}${cut}, ${lines.length} lines:\n${digest}`, summary: `Build log: ${lines.length} lines, ${errors.length} error or warning line${errors.length === 1 ? "" : "s"}` };
    }
  }
}
