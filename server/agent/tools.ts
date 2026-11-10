import type Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PlanStep } from "@shared/agent";
import type { Emit } from "./bus";
import { PROVIDER_ENV, runManusTask } from "./providers";
import { browserConfigured, closeLiveBrowser, liveBrowser, MAX_SHOT_HEIGHT, navigate, snapshot, visualCheck } from "./browser";
import { auditPage, auditText } from "./design/audit";
import type { DesignAudit, Surface } from "./design/types";
import { deployConfigured, deployPreview } from "./deploy";
import { assertStorageAvailable, storeMedia } from "../media/snowflake";
import { StorageError } from "../media/storage-errors";

/** Largest screenshot kept inline in the event log while file storage is unavailable (base64 chars). */
const INLINE_SCREENSHOT_LIMIT = 400 * 1024;
import { createPullRequest, describeGitHubError, getConnection, githubApi, GitHubError, listRepos, repoDetails, resolveRepo, throwIfAborted } from "../services/github";
import { renderProjectMemory, saveProjectMemory } from "./memory";
import { taskOwner } from "./store";
import { cloneIntoWorkspace, commitAndPush, linkedRepo, syncWithRemote } from "./repos";
import { brandText } from "@shared/brand";
import { storeArtifacts } from "./artifacts";
import { absoluteAssetWarnings, detectPreviewRoot, previewBaseUrl, registerLiveServer, unregisterLiveServer, waitForPort } from "./preview";
import type { BrowseResult } from "./browser";
import { clip, deleteWorkspaceFile, listWorkspaceTree, readWorkspaceFile, resolveInWorkspace, runCommand, SANDBOX_MODE, SandboxError, sandboxPortHost, writeWorkspaceBytes, writeWorkspaceFile } from "./sandbox";
import { DEFAULT_VOICE, MAX_EXPRESSIVE_CHARS, MAX_SPEECH_CHARS, VOICES, worstCaseSeconds } from "@shared/voice";
import { voiceCredits } from "@shared/credits";
import { speakExpressive, speakStandard, studioConfigured, transcribe, voiceConfigured, VoiceError } from "../voice/engines";
import { classify } from "./artifacts";

export type ToolContext = {
  root: string;
  sessionId: string;
  vision: boolean;
  callId: string;
  signal: AbortSignal;
  emit: Emit;
  onPlan: (steps: PlanStep[]) => void;
  onFileChange: (path: string) => void;
  onCommand: (command: string) => void;
  /** Called with paths the agent attached explicitly, so the end-of-run collection skips them. */
  onAttach?: (paths: string[]) => void;
  /** Publishing allowed in this run: a deploy only when the user asked for it or used the Deploy action. */
  grants?: { deploy?: boolean; deployUsed?: boolean; deployLive?: boolean; deployAttempts?: number };
  /** The task belongs to the operator: operator-only tools (OPERATOR_TOOLS) are allowed. */
  operator?: boolean;
  /** Charge credits for usage other than model tokens (voice): the task's account, unless it is the operator's. */
  charge?: (credits: number, detail: string) => void;
  /** Whether the task's account can cover `credits` now (always for the operator). */
  canSpend?: (credits: number) => Promise<boolean>;
  /** The run's design brief, for the visual test's audit: the kind of interface and the looks the user asked for. */
  design?: { surface: Surface; allowed: string[] };
  /** The repository the user switched the task to (the harness's clone step of such a follow-up only). */
  repoSwitch?: string;
};

/**
 * Tools free accounts never get: public previews are hosted on the operator's accounts, research is
 * delegated to a paid agent that fills in forms and signs up on websites, and clicking or typing on
 * other people's websites could be used to act there in the operator's name.
 */
export const OPERATOR_TOOLS = new Set(["deploy_preview", "delegate_research", "browser_click", "browser_type"]);

export type ToolImage = { mediaType: "image/jpeg"; base64: string };
/** images: screenshots for the model (vision models only); audit: the visual test's design audit, for the harness. */
/** baseline: files the tool took from the repository as they are (a sync): its state, not this run's work. */
export type ToolOutcome = { ok: boolean; content: string; summary: string; exitCode?: number | null; images?: ToolImage[]; audit?: DesignAudit | null; baseline?: string[] };

const VERIFY_PATTERN = /\b(tsc|vitest|jest|pytest|eslint|ruff|mypy|pyright|go (test|vet)|cargo (test|check)|node --test|(npm|pnpm|yarn)( run)? (test|lint|check|typecheck|build))\b/;
export const isVerificationCommand = (command: string) => VERIFY_PATTERN.test(command);

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const MAX_DIFF_SIDE = 256 * 1024;

function emitFileChange(ctx: ToolContext, path: string, before: string | null, after: string | null) {
  const changes = diffLines(before ?? "", after ?? "");
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    if (change.added) added += change.count ?? 0;
    if (change.removed) removed += change.count ?? 0;
  }
  const truncated = (before?.length ?? 0) > MAX_DIFF_SIDE || (after?.length ?? 0) > MAX_DIFF_SIDE;
  ctx.emit({
    type: "file_change",
    callId: ctx.callId,
    path,
    kind: before === null ? "create" : after === null ? "delete" : "modify",
    before: (before ?? "").slice(0, MAX_DIFF_SIDE),
    after: (after ?? "").slice(0, MAX_DIFF_SIDE),
    bytesBefore: Buffer.byteLength(before ?? ""),
    bytesAfter: Buffer.byteLength(after ?? ""),
    added,
    removed,
    truncated,
  });
  ctx.onFileChange(path);
  return { added, removed };
}

const schemas = {
  update_plan: z.object({ steps: z.array(z.object({ title: z.string().min(1).max(300), status: z.enum(["pending", "in_progress", "done"]) })).min(1).max(30) }),
  list_files: z.object({ path: z.string().default("."), depth: z.number().int().min(1).max(8).default(3) }),
  read_file: z.object({ path: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  write_file: z.object({ path: z.string().min(1), content: z.string(), append: z.boolean().optional() }),
  edit_file: z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().default(false) }),
  delete_file: z.object({ path: z.string().min(1) }),
  search_files: z.object({ pattern: z.string().min(1).max(500), path: z.string().default(".") }),
  run_command: z.object({ command: z.string().min(1).max(8000), timeout_sec: z.number().int().min(5).max(600).default(120) }),
  web_fetch: z.object({ url: z.string().url().max(2000) }),
  delegate_research: z.object({ task: z.string().min(10).max(12000) }),
  browse: z.object({ url: z.string().url().max(2000), screenshot: z.boolean().default(true), full_page: z.boolean().default(false), wait_ms: z.number().int().min(0).max(15000).default(2000) }),
  browser_click: z.object({ selector: z.string().max(500).optional(), text: z.string().max(300).optional() }).refine(value => value.selector || value.text, "Pass selector or text"),
  browser_type: z.object({ selector: z.string().min(1).max(500), text: z.string().max(5000), press_enter: z.boolean().default(false) }),
  browser_scroll: z.object({ direction: z.enum(["down", "up", "top", "bottom"]).default("down"), pixels: z.number().int().min(50).max(20000).default(800) }),
  browser_extract: z.object({ selector: z.string().max(500).optional(), include_links: z.boolean().default(false) }),
  browser_screenshot: z.object({ full_page: z.boolean().default(false) }),
  browser_close: z.object({}),
  transcribe_audio: z.object({
    path: z.string().min(1),
    language: z.string().trim().max(12).optional(),
    speakers: z.boolean().default(false),
    output_path: z.string().min(1).optional(),
  }),
  generate_speech: z.object({
    text: z.string().trim().min(1).max(MAX_SPEECH_CHARS),
    path: z.string().min(1),
    voice: z.enum(VOICES.map(voice => voice.id) as [string, ...string[]]).default(DEFAULT_VOICE),
    style: z.enum(["standard", "expressive"]).default("standard"),
  }),
  test_preview_visual: z.object({
    dir: z.string().max(300).optional(),
    page: z.string().max(500).default("/"),
    start_command: z.string().max(2000).optional(),
    port: z.number().int().min(1024).max(65535).refine(port => ![3000, 3100, 8082].includes(port), "That port is reserved").default(4173),
    full_page: z.boolean().default(true),
    wait_ms: z.number().int().min(0).max(15000).default(1500),
    audit: z.boolean().default(true),
  }),
  attach_files: z.object({ paths: z.array(z.string().min(1).max(500)).min(1).max(20), note: z.string().max(500).optional() }),
  github_list_repos: z.object({ query: z.string().max(100).default("") }),
  github_get_repo: z.object({ repo: z.string().min(1).max(200) }),
  github_clone_to_workspace: z.object({ repo: z.string().min(1).max(200), branch: z.string().max(200).optional() }),
  github_commit_and_push: z.object({ message: z.string().min(3).max(5000), branch: z.string().max(200).optional() }),
  github_sync: z.object({}).passthrough(),
  github_create_pr: z.object({ title: z.string().min(3).max(256), body: z.string().max(60000).default(""), head: z.string().max(200).optional(), base: z.string().max(200).optional(), draft: z.boolean().default(false) }),
  remember_project: z.object({
    tests: z.string().max(800, "Keep each part under 800 characters.").optional(),
    avoid: z.string().max(800, "Keep each part under 800 characters.").optional(),
    decisions: z.string().max(800, "Keep each part under 800 characters.").optional(),
  }).refine(value => value.tests !== undefined || value.avoid !== undefined || value.decisions !== undefined, { message: "Pass tests, avoid, or decisions." }),
  deploy_preview: z.object({
    kind: z.enum(["static", "node"]),
    build_command: z.string().max(500).default(""),
    publish_path: z.string().max(200).default("."),
    start_command: z.string().max(500).default(""),
  }),
};

type ToolName = keyof typeof schemas;

type ToolDef = Anthropic.Tool & { name: ToolName };

const ATTACH_TOOL: ToolDef = {
  name: "attach_files",
  description: "Attach files from the workspace to your reply so the user can preview or download them with one click (documents, PDFs, archives, images, data exports, key code files). Use it for every deliverable you produce. Files up to 25 MB; create archives with run_command (e.g. zip -r out.zip dir) before attaching. Other files you create or change are also attached automatically at the end of the run.",
  input_schema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, description: "Workspace-relative file paths" }, note: { type: "string", description: "Optional one-line description" } }, required: ["paths"] },
};

const CODING_TOOLS: ToolDef[] = [
  {
    name: "update_plan",
    description: "Record or update the task plan shown live to the user. Call it first with your objective breakdown, then again whenever a step's status changes.",
    input_schema: { type: "object", properties: { steps: { type: "array", items: { type: "object", properties: { title: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["title", "status"] } } }, required: ["steps"] },
  },
  {
    name: "list_files",
    description: "List files and directories in the workspace (node_modules/.git are not descended into).",
    input_schema: { type: "object", properties: { path: { type: "string", description: "Directory relative to the workspace root. Default '.'" }, depth: { type: "integer", description: "Max depth, 1-8. Default 3" } } },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace, optionally a line range. Output lines are prefixed with line numbers.",
    input_schema: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or fully overwrite a file with the given content. With append: true the content is added to the end of the file instead: write a long file in parts that way (first part without append), never shortened to fit one call. Prefer edit_file for targeted changes to existing files.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string", description: "Complete file contents (or, with append, the next part)" }, append: { type: "boolean", description: "Add content to the end of the file instead of replacing it" } }, required: ["path", "content"] },
  },
  {
    name: "edit_file",
    description: "Apply a targeted edit: replace an exact, unique occurrence of old_string with new_string (or every occurrence with replace_all). Include enough surrounding context to make old_string unique.",
    input_schema: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["path", "old_string", "new_string"] },
  },
  {
    name: "delete_file",
    description: "Delete a single file from the workspace.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "search_files",
    description: "Search file contents with an extended regular expression (grep -E). Returns up to 200 matching lines as path:line:text.",
    input_schema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "run_command",
    description: SANDBOX_MODE === "e2b"
      ? "Run a bash command in the workspace, inside this task's own Linux sandbox (Debian 12, Node 20, npm, Python 3.11, git, passwordless sudo; internet access). stdout/stderr stream live to the user. Use for installs, builds, typechecks, linters and tests."
      : "Run a bash command in the workspace as an unprivileged sandbox user (Node 22, npm, Python 3.10 available; internet access, no access to the host). stdout/stderr stream live to the user. Use for installs, builds, typechecks, linters and tests.",
    input_schema: { type: "object", properties: { command: { type: "string" }, timeout_sec: { type: "integer", description: "5-600, default 120" } }, required: ["command"] },
  },
];

const WEB_FETCH_TOOL: ToolDef = {
  name: "web_fetch",
  description: "Fetch a public http(s) URL and return its readable text (HTML is stripped). Use for documentation and references.",
  input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
};

const DELEGATE_TOOL: ToolDef = {
  name: "delegate_research",
  description: "Delegate open-ended web research or a browser workflow to the Curialy Research Agent. Slow (minutes) and billed per task; use only when web_fetch on known URLs is not enough.",
  input_schema: { type: "object", properties: { task: { type: "string", description: "Self-contained instructions for the Research Agent, including the expected output." } }, required: ["task"] },
};

const BROWSE_TOOL: ToolDef = {
  name: "browse",
  description: "Open a URL in this task's Curialy Live Browser (a cloud Chromium the user watches in real time) and return the rendered text, HTTP status, console errors and a screenshot. The session stays open, so follow up with browser_click / browser_type / browser_scroll / browser_extract / browser_screenshot, and browser_close when done.",
  input_schema: { type: "object", properties: { url: { type: "string" }, screenshot: { type: "boolean", description: "Default true" }, full_page: { type: "boolean", description: "Full-page screenshot. Default false" }, wait_ms: { type: "integer", description: "Extra wait for network idle, 0-15000. Default 2000" } }, required: ["url"] },
};

const BROWSER_TOOLS: ToolDef[] = [
  { name: "browser_click", description: "Click an element in the live browser, by CSS selector or by its visible text (buttons/links).", input_schema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } } },
  { name: "browser_type", description: "Type into an input in the live browser (replaces its value); optionally press Enter to submit.", input_schema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" }, press_enter: { type: "boolean" } }, required: ["selector", "text"] } },
  { name: "browser_scroll", description: "Scroll the live browser page.", input_schema: { type: "object", properties: { direction: { type: "string", enum: ["down", "up", "top", "bottom"] }, pixels: { type: "integer" } } } },
  { name: "browser_extract", description: "Extract the visible text of the page (or of the elements matching selector), optionally with links. Use this to read documentation or scrape data.", input_schema: { type: "object", properties: { selector: { type: "string" }, include_links: { type: "boolean" } } } },
  { name: "browser_screenshot", description: "Screenshot the live browser's current view (or the full page).", input_schema: { type: "object", properties: { full_page: { type: "boolean" } } } },
  { name: "browser_close", description: "Close the live browser session when you are done browsing (it also closes automatically at the end of the task).", input_schema: { type: "object", properties: {} } },
];

// Curialy Voice: transcripts and speech files. The standard voice serves everything; the expressive
// voice (emotion, acting) only on the operator's tasks and only when the task really calls for it.
const VOICE_TOOLS: ToolDef[] = [
  {
    name: "transcribe_audio",
    description: "Transcribe an audio or video file in the workspace (mp3, wav, m4a, ogg, flac, webm, mp4, mov) to text with Curialy Voice. Use it for recordings the user attached (under attachments/) and for files you produced. speakers: true labels who said what (meetings, interviews). output_path: also save the transcript there. Language is detected unless you pass a code such as en or es.",
    input_schema: { type: "object", properties: { path: { type: "string" }, language: { type: "string" }, speakers: { type: "boolean" }, output_path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "generate_speech",
    description: `Create spoken audio (an MP3 file) from text with Curialy Voice, saved at path in the workspace and attached for the user to play. Voices: ${VOICES.map(voice => `${voice.id} (${voice.gender}, ${voice.description})`).join("; ")}. style "standard" is natural narration and the default for everything: voiceovers, app sounds, read-outs, tutorials. Use style "expressive" only when the user explicitly asks for emotional delivery, character voices or voice acting; it understands cues in square brackets such as [whispers], [laughs], [sighs], [excited], is limited to ${MAX_EXPRESSIVE_CHARS} characters per call and spends a scarce budget. Up to ${MAX_SPEECH_CHARS} characters per call; split longer scripts.`,
    input_schema: { type: "object", properties: { text: { type: "string" }, path: { type: "string", description: "e.g. public/audio/intro.mp3" }, voice: { type: "string", enum: VOICES.map(voice => voice.id) }, style: { type: "string", enum: ["standard", "expressive"] } }, required: ["text", "path"] },
  },
];

/** Deploy attempts per run: the first, and one retry after a failure. */
const MAX_DEPLOY_ATTEMPTS = 2;

const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
/** Free accounts: smaller files, so the worst case they must cover up front stays reasonable. */
const MAX_TRANSCRIBE_BYTES_FREE = 10 * 1024 * 1024;

const VISUAL_TOOL: ToolDef = {
  name: "test_preview_visual",
  description: "Visually test the web app you built: serve it, open it in a real Chromium (cloud browser), and get back a screenshot at desktop size (full page by default; full_page: false shows the first screen at full resolution), a screenshot of the top of the page at phone width (390 px, reduced motion), HTTP status, console errors, the rendered text and a design audit measured in the page (contrast, focus styles, target sizes, sideways scroll, labels, type scale, reduced motion and common template tells). Static mode (default) serves the build output: index.html in dir, else dist/, build/, out/, public/ or the workspace root, so run the build first and use relative asset paths (Vite: base: './', CRA: \"homepage\": \".\"). Server mode: pass start_command (e.g. 'npm run dev -- --host 127.0.0.1 --port 4173' or 'node server.js') and the port it listens on; the server runs only for the duration of the test. Inspect the screenshots, fix the audit's findings marked \"fix\" and layout or styling problems before finishing.",
  input_schema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "Directory containing index.html (static mode)" },
      page: { type: "string", description: "Path to open, default /" },
      start_command: { type: "string", description: "Server mode: command that starts the app" },
      port: { type: "integer", description: "Server mode: port the app listens on (default 4173)" },
      full_page: { type: "boolean", description: "Full-page desktop screenshot, default true" },
      wait_ms: { type: "integer", description: "Extra wait for network idle, default 1500" },
      audit: { type: "boolean", description: "Phone screenshot and design audit, default true" },
    },
  },
};

const DEPLOY_TOOL: ToolDef = {
  name: "deploy_preview",
  description: "Deploy the current workspace as a temporary live preview with Curialy Cloud Deploy (auto-deleted after about 2 hours) and return its public URL. Use kind 'static' for plain HTML/CSS/JS or a static build (set build_command and publish_path, e.g. 'npm install && npm run build' and 'dist'); use kind 'node' for a server that listens on process.env.PORT (set start_command). Only call it when the user asks for a deploy or live preview. The preview runs only this project: no database or other services, so an app that needs one must start in a self-contained mode (for example SQLite or an in-memory store) from its start command. Building takes a few minutes.",
  input_schema: { type: "object", properties: { kind: { type: "string", enum: ["static", "node"] }, build_command: { type: "string" }, publish_path: { type: "string" }, start_command: { type: "string" } }, required: ["kind"] },
};

const REMEMBER_TOOL: ToolDef = {
  name: "remember_project",
  description: "Save what the next task on this repository should already know. tests: how to run its checks. avoid: folders or files not to edit, and why. decisions: choices already made that should stay. Pass only the parts that changed; an empty string clears that part. Keep each part short. Never save secrets, tokens, or details that matter only for this task. The repository must already be cloned into the task.",
  input_schema: {
    type: "object",
    properties: {
      tests: { type: "string", description: "How to run this repository's checks" },
      avoid: { type: "string", description: "Folders or files not to edit, and why" },
      decisions: { type: "string", description: "Choices already made that should stay" },
    },
  },
};

const GITHUB_TOOLS: ToolDef[] = [
  {
    name: "github_list_repos",
    description: "List the user's GitHub repositories (owned or collaborator), most recently updated first. Optional query filters by name, case-insensitive.",
    input_schema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "github_get_repo",
    description: "Get a repository's details, branches and languages. Accepts 'owner/name' or just a name like 'easyeps', which is matched against the user's repositories.",
    input_schema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
  },
  {
    name: "github_clone_to_workspace",
    description: "Clone one of the user's repositories into this task's workspace so its files can be read, edited and tested with the other tools. Accepts 'owner/name' or a bare name. Clones the default branch unless branch is given. One repository per task. Never delete the cloned folder to start over: undo changes with git inside it (git checkout, git restore). Stashes and local commits do not survive a new sandbox. If its files were deleted anyway, calling this again restores it at the commit it was cloned at.",
    input_schema: { type: "object", properties: { repo: { type: "string" }, branch: { type: "string" } }, required: ["repo"] },
  },
  {
    name: "github_sync",
    description: "Bring the cloned repository up to date with its branch on GitHub (commits someone pushed since the clone), keeping your edits: a three-way merge. Conflicting files are listed and left with conflict markers to resolve. github_commit_and_push does this by itself when the branch moved; call this to work on the latest code first. Plain git pull/fetch inside run_command has no credentials and will fail.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "github_commit_and_push",
    description: "Commit every change in the cloned repository (edits, new files, deletions; .gitignore is respected) and push it to GitHub. Pushes to the cloned branch by default; pass branch to push to a new branch, which is the safe choice before github_create_pr. Plain 'git push' inside run_command has no credentials and will fail; always use this tool.",
    input_schema: { type: "object", properties: { message: { type: "string", description: "Commit message" }, branch: { type: "string" } }, required: ["message"] },
  },
  {
    name: "github_create_pr",
    description: "Open a pull request in the cloned repository from head (default: the last branch you pushed with github_commit_and_push) into base (default: the branch that was cloned).",
    input_schema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, head: { type: "string" }, base: { type: "string" }, draft: { type: "boolean" } }, required: ["title"] },
  },
];

export function toolsFor(opts: { coding: boolean; web: boolean; eager: boolean; github?: boolean; operator?: boolean }): Anthropic.Tool[] {
  const all = toolList(opts);
  const tools = opts.operator === false ? all.filter(tool => !OPERATOR_TOOLS.has(tool.name)) : all;
  return opts.eager ? tools.map(tool => ({ ...tool, eager_input_streaming: true })) : tools;
}

function toolList(opts: { coding: boolean; web: boolean; github?: boolean }): ToolDef[] {
  const tools: ToolDef[] = [];
  if (opts.coding) tools.push(...CODING_TOOLS, ATTACH_TOOL);
  if (opts.github) tools.push(...(opts.coding ? GITHUB_TOOLS : GITHUB_TOOLS.slice(0, 2)), REMEMBER_TOOL);
  if (opts.coding && deployConfigured().ok) tools.push(DEPLOY_TOOL);
  if ((opts.web || opts.coding) && browserConfigured()) tools.push(BROWSE_TOOL, ...BROWSER_TOOLS);
  if (opts.coding && PROVIDER_ENV.browserbaseKey && PROVIDER_ENV.browserbaseProject) tools.push(VISUAL_TOOL);
  if (opts.coding && voiceConfigured()) tools.push(...VOICE_TOOLS);
  if (opts.web) {
    tools.push(WEB_FETCH_TOOL);
    if (PROVIDER_ENV.manusKey) tools.push(DELEGATE_TOOL);
  }
  return tools;
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in schemas)) return { ok: false, content: `Unknown tool: ${name}`, summary: "Unknown tool" };
  if (OPERATOR_TOOLS.has(name) && ctx.operator === false) return { ok: false, content: `${name} is not available on this account. Continue without it.`, summary: "Not available" };
  const parsed = schemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    return { ok: false, content: `INVALID_INPUT: ${issues}. Re-issue the call with a complete, valid input.`, summary: "Invalid input" };
  }
  try {
    return await run(name as ToolName, parsed.data, ctx);
  } catch (error) {
    if (error instanceof GitHubError) console.error(`[tools] ${name}: GitHub ${error.status}: ${error.message.slice(0, 200)}`);
    const raw = error instanceof GitHubError ? describeGitHubError(error) : error instanceof SandboxError || error instanceof Error ? error.message : String(error);
    if (raw !== brandText(raw)) console.error(`[tools] ${name} failed:`, raw);
    const message = brandText(raw);
    return { ok: false, content: `Error: ${message}`, summary: message.slice(0, 160) };
  }
}

async function run(name: ToolName, input: any, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case "remember_project": {
      try {
        const { repo, memory } = await saveProjectMemory(ctx.sessionId, input as z.infer<typeof schemas.remember_project>);
        const rendered = renderProjectMemory(repo, memory);
        return { ok: true, content: rendered.saved ? `Saved.\n\n${rendered.text}` : `Cleared the project memory for ${repo}.`, summary: rendered.saved ? `Saved project memory for ${repo}` : "Cleared project memory" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save the project memory.";
        return { ok: false, content: message, summary: message.startsWith("Clone a repository") ? "No repository" : "Could not save" };
      }
    }
    case "update_plan": {
      const steps = (input as z.infer<typeof schemas.update_plan>).steps;
      ctx.onPlan(steps);
      ctx.emit({ type: "plan", steps });
      const done = steps.filter(step => step.status === "done").length;
      return { ok: true, content: "Plan updated.", summary: `${done}/${steps.length} steps done` };
    }
    case "list_files": {
      const { path, depth } = input as z.infer<typeof schemas.list_files>;
      const entries = listWorkspaceTree(ctx.root, path, depth);
      const text = entries.length ? entries.map(entry => (entry.type === "dir" ? `${entry.path}/` : `${entry.path} (${entry.size} B)`)).join("\n") : "(empty)";
      return { ok: true, content: text, summary: `${entries.length} entries` };
    }
    case "read_file": {
      const { path, start_line, end_line } = input as z.infer<typeof schemas.read_file>;
      const file = readWorkspaceFile(ctx.root, path);
      if (!file.exists) return { ok: false, content: `File not found: ${file.relative}`, summary: "Not found" };
      const lines = file.content.split("\n");
      const start = (start_line ?? 1) - 1;
      const end = Math.min(lines.length, end_line ?? lines.length);
      const numbered = lines.slice(start, end).map((line, index) => `${String(start + index + 1).padStart(5)}  ${line}`).join("\n");
      return { ok: true, content: clip(numbered, 60_000), summary: `${file.relative} lines ${start + 1}-${end} of ${lines.length}` };
    }
    case "write_file": {
      const { path, content, append } = input as z.infer<typeof schemas.write_file>;
      const previous = readWorkspaceFile(ctx.root, path);
      const next = append && previous.exists ? previous.content + content : content;
      const { relative } = writeWorkspaceFile(ctx.root, path, next);
      const { added, removed } = emitFileChange(ctx, relative, previous.exists ? previous.content : null, next);
      if (append && previous.exists) return { ok: true, content: `Appended ${Buffer.byteLength(content)} bytes to ${relative} (${Buffer.byteLength(next)} bytes now).`, summary: `Appended to ${relative} (+${added} −${removed})` };
      return { ok: true, content: `Wrote ${relative} (${Buffer.byteLength(content)} bytes).`, summary: `${previous.exists ? "Updated" : "Created"} ${relative} (+${added} −${removed})` };
    }
    case "edit_file": {
      const { path, old_string, new_string, replace_all } = input as z.infer<typeof schemas.edit_file>;
      const file = readWorkspaceFile(ctx.root, path);
      if (!file.exists) return { ok: false, content: `File not found: ${file.relative}. Use write_file to create it.`, summary: "Not found" };
      const occurrences = file.content.split(old_string).length - 1;
      if (occurrences === 0) return { ok: false, content: `old_string was not found in ${file.relative}. Read the file again and copy the exact text, including whitespace.`, summary: "No match" };
      if (occurrences > 1 && !replace_all) return { ok: false, content: `old_string matches ${occurrences} places in ${file.relative}. Add surrounding context to make it unique, or set replace_all.`, summary: `${occurrences} matches` };
      const next = replace_all ? file.content.split(old_string).join(new_string) : file.content.replace(old_string, () => new_string);
      writeWorkspaceFile(ctx.root, path, next);
      const { added, removed } = emitFileChange(ctx, file.relative, file.content, next);
      return { ok: true, content: `Edited ${file.relative} (${replace_all ? occurrences : 1} replacement${occurrences > 1 && replace_all ? "s" : ""}).`, summary: `Edited ${file.relative} (+${added} −${removed})` };
    }
    case "delete_file": {
      const { path } = input as z.infer<typeof schemas.delete_file>;
      const file = readWorkspaceFile(ctx.root, path);
      if (!file.exists) return { ok: false, content: `File not found: ${file.relative}`, summary: "Not found" };
      deleteWorkspaceFile(ctx.root, path);
      emitFileChange(ctx, file.relative, file.content, null);
      return { ok: true, content: `Deleted ${file.relative}.`, summary: `Deleted ${file.relative}` };
    }
    case "search_files": {
      const { pattern, path } = input as z.infer<typeof schemas.search_files>;
      const command = `grep -rnIE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -- ${shellQuote(pattern)} ${shellQuote(path)} | head -200`;
      const result = await runCommand({ root: ctx.root, command, timeoutSec: 30, signal: ctx.signal, onOutput: () => undefined, sync: "push" });
      const lines = result.output.trim() ? result.output.trim().split("\n").length : 0;
      return { ok: true, content: result.output.trim() || "No matches.", summary: `${lines} match${lines === 1 ? "" : "es"}` };
    }
    case "run_command": {
      const { command, timeout_sec } = input as z.infer<typeof schemas.run_command>;
      ctx.onCommand(command);
      const result = await runCommand({ root: ctx.root, command, timeoutSec: timeout_sec, signal: ctx.signal, onOutput: (stream, chunk) => ctx.emit({ type: "tool_output", callId: ctx.callId, stream, chunk }) });
      const status = result.timedOut ? `timed out after ${timeout_sec}s` : `exit code ${result.exitCode}`;
      return { ok: result.exitCode === 0, content: `${clip(result.output) || "(no output)"}\n\n[${status}, ${result.durationMs} ms]`, summary: status, exitCode: result.exitCode };
    }
    case "web_fetch": {
      const { url } = input as z.infer<typeof schemas.web_fetch>;
      if (!/^https?:\/\//i.test(url)) return { ok: false, content: "Only http(s) URLs are supported.", summary: "Rejected URL" };
      // Fetched from inside the sandbox so the firewall blocks loopback, metadata and private ranges.
      const command = `curl -sSL --proto '=http,https' --max-time 25 --max-filesize 3000000 -A 'CurialyAgent/1.0' -w '\\n__HTTP_STATUS__%{http_code} %{content_type}' -- ${shellQuote(url)} | head -c 3100000`;
      const result = await runCommand({ root: ctx.root, command, timeoutSec: 40, signal: ctx.signal, onOutput: () => undefined, sync: "none" });
      const marker = result.output.lastIndexOf("__HTTP_STATUS__");
      const meta = marker >= 0 ? result.output.slice(marker + 15).trim() : "unknown";
      const body = marker >= 0 ? result.output.slice(0, marker) : result.output;
      const text = /html/i.test(meta) || /<html/i.test(body.slice(0, 500)) ? htmlToText(body) : body;
      const ok = result.exitCode === 0 && /^2/.test(meta);
      return { ok, content: clip(`HTTP ${meta}\n\n${text}`, 40_000), summary: `HTTP ${meta.split(" ")[0]} · ${text.length} chars` };
    }
    case "browse": {
      const { url, screenshot, full_page, wait_ms } = input as z.infer<typeof schemas.browse>;
      const live = await liveBrowser(ctx.sessionId, ctx.emit, ctx.signal, ctx.operator !== false);
      ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk: `Curialy Live Browser session ${live.sessionId.slice(0, 8)}\nOpening ${url}\n` });
      const status = await navigate(live, url, wait_ms);
      return reportPage(ctx, await snapshot(live, { screenshot, fullPage: full_page, status }), url);
    }
    case "browser_click":
    case "browser_type":
    case "browser_scroll":
    case "browser_extract":
    case "browser_screenshot":
    case "browser_close":
      return runBrowserTool(name, input, ctx);
    case "test_preview_visual":
      return visualTest(input as z.infer<typeof schemas.test_preview_visual>, ctx);
    case "transcribe_audio":
      return transcribeTool(input as z.infer<typeof schemas.transcribe_audio>, ctx);
    case "generate_speech":
      return speechTool(input as z.infer<typeof schemas.generate_speech>, ctx);
    case "attach_files": {
      const { paths } = input as z.infer<typeof schemas.attach_files>;
      const result = await storeArtifacts(ctx.sessionId, ctx.root, Array.from(new Set(paths)), true);
      const stored = result.stored;
      const skipped = result.skipped.map(reason => brandText(reason));
      if (stored.length) ctx.emit({ type: "artifacts", files: stored, auto: false, more: 0, skipped });
      ctx.onAttach?.(stored.map(file => file.path));
      const lines = [...stored.map(file => `Attached ${file.path} (${file.sizeBytes} bytes)`), ...skipped.map(reason => `Skipped ${reason}`)];
      return { ok: stored.length > 0, content: lines.join("\n") || "Nothing attached.", summary: `${stored.length} attached${skipped.length ? `, ${skipped.length} skipped` : ""}` };
    }
    case "github_list_repos":
    case "github_get_repo":
    case "github_clone_to_workspace":
    case "github_sync":
    case "github_commit_and_push":
    case "github_create_pr":
      return runGitHubTool(name, input, ctx);
    case "deploy_preview": {
      // A public preview is an external side effect: only when the user asked for one (their Deploy
      // action, or the operator's own message), once per run plus one retry after a failure.
      if (!ctx.grants?.deploy) {
        return ctx.grants?.deployUsed
          ? { ok: false, content: "deploy_preview was already used in this run. Report the outcome of that attempt; the user can start another deploy with the Deploy action.", summary: "Already deployed in this run" }
          : { ok: false, content: "deploy_preview is not allowed in this run: a deploy starts from the user's Deploy action or a request for one in their own message. Do not deploy; if a live preview would help, say so in your summary.", summary: "Deploy not requested" };
      }
      const { kind, build_command, publish_path, start_command } = input as z.infer<typeof schemas.deploy_preview>;
      // A retried tool call must not create a second live service: the grant is taken before the call.
      ctx.grants.deploy = false;
      ctx.grants.deployUsed = true;
      ctx.grants.deployAttempts = (ctx.grants.deployAttempts ?? 0) + 1;
      let deploymentId = "";
      let expiresAt: string | undefined;
      let result: Awaited<ReturnType<typeof deployPreview>>;
      try {
        result = await deployPreview({
          sessionId: ctx.sessionId, callId: ctx.callId, root: ctx.root, kind, buildCommand: build_command, publishPath: publish_path, startCommand: start_command, signal: ctx.signal,
          onCreated: (id, expires) => { deploymentId = id; expiresAt = expires; },
          onProgress: (status, detail, url) => {
            // The preview's public address is a hosting-provider host: the deployment card links to it
            // through a first-party route; the log line does not print it.
            ctx.emit({ type: "tool_output", callId: ctx.callId, stream: status === "failed" ? "stderr" : "stdout", chunk: `[deploy:${status}] ${brandText(detail)}\n` });
            ctx.emit({ type: "deployment", deploymentId: deploymentId || ctx.callId, callId: ctx.callId, status, url, detail: brandText(detail), ...(expiresAt ? { expiresAt } : {}) });
          },
        });
      } catch (error) {
        // A failed deploy is cleaned up (no repository or service is left), so one more attempt after
        // fixing the cause is safe. Not when GitHub's rate limit outlasted the push's own waits: a
        // second attempt in this run would only fail the same way.
        if (ctx.signal.aborted || ctx.grants.deployAttempts >= MAX_DEPLOY_ATTEMPTS) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof GitHubError && error.retryAfterMs !== undefined) {
          throw new Error(`${message}\nGitHub is limiting uploads from this account for about ${Math.max(1, Math.ceil(error.retryAfterMs / 60_000))} more minute(s), so do not deploy again in this run: report this, and that a deploy started after that wait (the Deploy action) should work.`);
        }
        ctx.grants.deploy = true;
        throw new Error(`${message}\nThe failed preview was cleaned up. You may call deploy_preview once more in this run after fixing the cause.`);
      }
      ctx.grants.deployLive = true;
      return { ok: true, content: `Deployed: ${result.url}\nExpires: ${result.expiresAt}. Verify it with the browse tool before reporting success. In your answer call it "the live preview" (the user opens it from the Preview tab); do not paste this address.`, summary: "Live preview deployed" };
    }
    case "delegate_research": {
      const { task } = input as z.infer<typeof schemas.delegate_research>;
      const result = await runManusTask(task, {
        signal: ctx.signal,
        onProgress: update => {
          ctx.emit({ type: "external", source: "research", status: update.status, detail: brandText(update.detail) });
          ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk: `[research:${update.status}] ${brandText(update.detail)}\n` });
        },
      });
      return { ok: result.status === "completed", content: clip(result.answer, 40_000), summary: `Research ${result.status}` };
    }
  }
}

async function runGitHubTool(name: ToolName, input: any, ctx: ToolContext): Promise<ToolOutcome> {
  const owner = await taskOwner(ctx.sessionId);
  // Always the task owner's own GitHub account.
  const connection = owner ? await getConnection(owner) : null;
  if (!connection) return { ok: false, content: "GitHub is not connected. Ask the user to click Connect GitHub in the sidebar.", summary: "GitHub not connected" };
  const { token, login } = connection;
  const log = (chunk: string) => ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk });

  const resolve = async (query: string) => {
    const match = await resolveRepo(token, query);
    if (match.repo) return match.repo;
    // A bare name past the listed repositories: the owner's own repository of that name, if any.
    if (!match.candidates.length && /^[A-Za-z0-9._-]+$/.test(query.trim())) {
      const own = await githubApi(token, `/repos/${login}/${query.trim()}`).then(repo => resolveRepo(token, repo.full_name), () => null);
      if (own?.repo) return own.repo;
    }
    const options = match.candidates.map(repo => repo.full_name).join(", ");
    throw new Error(match.candidates.length ? `"${query}" matches several repositories: ${options}. Ask which one, or pass owner/name.` : `No repository matching "${query}" in ${login}'s account. Use github_list_repos to see what exists.`);
  };

  switch (name) {
    case "github_list_repos": {
      const { query } = input as z.infer<typeof schemas.github_list_repos>;
      const repos = (await listRepos(token, 100)).filter(repo => !query || repo.name.toLowerCase().includes(query.toLowerCase()));
      const lines = repos.map(repo => `${repo.full_name}${repo.private ? " (private)" : ""} · ${repo.language ?? "?"} · default ${repo.default_branch} · updated ${repo.updated_at.slice(0, 10)}${repo.description ? ` · ${repo.description.slice(0, 100)}` : ""}`);
      return { ok: true, content: lines.join("\n") || "No repositories found.", summary: `${repos.length} repos` };
    }
    case "github_get_repo": {
      const repo = await resolve((input as z.infer<typeof schemas.github_get_repo>).repo);
      const details = await repoDetails(token, repo.full_name);
      const languages = Object.entries(details.languages).sort((a, b) => b[1] - a[1]).map(([lang, bytes]) => `${lang} ${Math.round(bytes / 1024)}KB`).join(", ");
      const content = [
        `${details.full_name} (${details.private ? "private" : "public"}) ${details.html_url}`,
        details.description ? `Description: ${details.description}` : "",
        `Default branch: ${details.default_branch} · size ${Math.round(details.size_kb / 1024)} MB · open issues ${details.open_issues} · updated ${details.updated_at}`,
        `Languages: ${languages || "unknown"}`,
        `Branches: ${details.branches.map(branch => `${branch.name}${branch.protected ? " (protected)" : ""}`).join(", ")}`,
      ].filter(Boolean).join("\n");
      return { ok: true, content, summary: details.full_name };
    }
    case "github_clone_to_workspace": {
      const { repo: query, branch } = input as z.infer<typeof schemas.github_clone_to_workspace>;
      const repo = await resolve(query);
      const result = await cloneIntoWorkspace({ sessionId: ctx.sessionId, root: ctx.root, fullName: repo.full_name, branch, token, onOutput: log, replace: ctx.repoSwitch?.toLowerCase() === repo.full_name.toLowerCase() });
      if (result.restored) {
        ctx.onFileChange(".");
        const pushedTo = result.earlierPushes;
        return {
          ok: true,
          content: `Restored ${result.fullName}@${result.branch} (${result.baseSha.slice(0, 7)}) into ${result.repoPath === "." ? "the workspace root" : `${result.repoPath}/`}: its files had been deleted, so the commit it was cloned at was fetched again (${result.files} tracked files). Edits made there before the deletion are gone.${pushedTo.length ? ` Commits pushed earlier are still on GitHub (${pushedTo.join(", ")}), but this folder starts again from the cloned commit, so pushing to those branches is refused: push to a new branch and open a pull request (redo those edits first if they are still needed).` : ""}`,
          summary: `Restored ${result.fullName} · ${result.files} files`,
        };
      }
      if (result.historyRestored) {
        ctx.onFileChange(".");
        return { ok: true, content: `Restored ${result.fullName}'s history in ${result.repoPath === "." ? "the workspace root" : `${result.repoPath}/`}: it was missing, so git could not list the changes there. Its files were kept as they are, compared with the commit it was cloned at (${result.baseSha.slice(0, 7)}).`, summary: `Restored ${result.fullName}'s history` };
      }
      if (result.alreadyLinked) return { ok: true, content: `${result.fullName} is already cloned at ${result.repoPath} (branch ${result.branch}). Undo changes with git inside that folder (git checkout, git restore); never delete it to clone again.`, summary: `${result.fullName} already cloned` };
      ctx.emit({ type: "repo", fullName: result.fullName, branch: result.branch, baseSha: result.baseSha, repoPath: result.repoPath, url: result.url });
      ctx.onFileChange(".");
      const where = (repoPath: string) => (repoPath === "." ? "the workspace root" : `${repoPath}/`);
      const switched = result.replaced
        ? ` The user switched this task from ${result.replaced.fullName} to it: ${where(result.replaced.repoPath)} keeps ${result.replaced.fullName}'s files, but github_commit_and_push now pushes ${result.fullName} only.${result.taken ? ` ${result.taken}/ was taken, so this copy is in ${result.repoPath}/; ${result.taken}/ may hold an earlier copy (plain files now): carry over any edits from it that are still needed.` : ""}`
        : "";
      const tree = listWorkspaceTree(ctx.root, result.repoPath, 2, 200).map(entry => (entry.type === "dir" ? `${entry.path}/` : entry.path)).join("\n");
      return {
        ok: true,
        content: `Cloned ${result.fullName}@${result.branch} (${result.baseSha.slice(0, 7)}) into ${where(result.repoPath)}: ${result.files} tracked files.${switched}\nTop of the tree:\n${tree}\n\nRead the README and key config files before making changes. Push edits with github_commit_and_push.`,
        summary: `Cloned ${result.fullName}@${result.branch} · ${result.files} files`,
      };
    }
    case "github_commit_and_push": {
      const { message, branch } = input as z.infer<typeof schemas.github_commit_and_push>;
      const repo = await linkedRepo(ctx.sessionId);
      if (!repo) return { ok: false, content: "No repository is cloned in this task. Use github_clone_to_workspace first.", summary: "No linked repo" };
      const result = await commitAndPush({ sessionId: ctx.sessionId, root: ctx.root, repo, token, message, branch, signal: ctx.signal, onOutput: log, scopes: connection.scopes });
      if (result.synced) ctx.onFileChange(".");
      const syncedNote = result.synced ? ` ${repo.fullName}@${repo.branch} had moved on GitHub, so the workspace was brought up to date with it (${result.synced.slice(0, 7)}) first, keeping your edits.` : "";
      if (result.nothingToPush) return { ok: true, content: `Nothing to push: the workspace matches ${repo.fullName}@${repo.branch}.${syncedNote}`, summary: "Nothing to push" };
      const baseline = result.upstreamOnly.length ? { baseline: result.upstreamOnly } : {};
      ctx.emit({ type: "repo_push", fullName: repo.fullName, branch: result.branch, commitSha: result.commitSha, commitUrl: result.commitUrl, changed: result.changed, deleted: result.deleted });
      const keptNote = result.kept.length ? ` Submodules and symlinks (${result.kept.slice(0, 3).join(", ")}${result.kept.length > 3 ? ` and ${result.kept.length - 3} more` : ""}) were left as GitHub has them.` : "";
      return { ok: true, content: `Pushed ${result.changed} changed and ${result.deleted} deleted file(s) to ${repo.fullName}@${result.branch}: ${result.commitUrl}.${syncedNote}${keptNote}`, summary: `Pushed ${result.commitSha.slice(0, 7)} → ${result.branch}`, ...baseline };
    }
    case "github_sync": {
      const repo = await linkedRepo(ctx.sessionId);
      if (!repo) return { ok: false, content: "No repository is cloned in this task. Use github_clone_to_workspace first.", summary: "No linked repo" };
      const result = await syncWithRemote({ sessionId: ctx.sessionId, root: ctx.root, repo, token, signal: ctx.signal, onOutput: log });
      if (!result.updated) return { ok: true, content: `${repo.fullName}@${repo.branch} has no new commits: the workspace is up to date.`, summary: "Already up to date" };
      ctx.onFileChange(".");
      if (result.conflicts.length) {
        return { ok: true, content: `Brought the workspace up to ${repo.fullName}@${repo.branch} (${result.head.slice(0, 7)}), keeping your edits, with conflicts in ${result.conflicts.length} file(s): ${result.conflicts.slice(0, 15).join(", ")}${result.conflicts.length > 15 ? ` and ${result.conflicts.length - 15} more` : ""}. Resolve the conflict markers (<<<<<<<, =======, >>>>>>>) in them, keeping both sides' intent, then push.`, summary: `Synced · ${result.conflicts.length} conflict(s)`, baseline: result.upstreamOnly };
      }
      return { ok: true, content: `Brought the workspace up to ${repo.fullName}@${repo.branch} (${result.head.slice(0, 7)}), keeping your edits (${result.files} file(s) updated).`, summary: `Synced to ${result.head.slice(0, 7)}`, baseline: result.upstreamOnly };
    }
    case "github_create_pr": {
      const { title, body, head, base, draft } = input as z.infer<typeof schemas.github_create_pr>;
      const repo = await linkedRepo(ctx.sessionId);
      if (!repo) return { ok: false, content: "No repository is cloned in this task.", summary: "No linked repo" };
      // Without a head: the one branch this task pushed (besides its own). Several: say which.
      const pushedBranches = Object.keys(repo.pushed).filter(branchName => branchName !== repo.branch);
      if (!head && pushedBranches.length > 1) return { ok: false, content: `This task pushed to several branches (${pushedBranches.join(", ")}): pass head with the one to open the pull request from.`, summary: "Which branch?" };
      const headBranch = head || pushedBranches[0];
      if (!headBranch) return { ok: false, content: "Push your changes to a new branch with github_commit_and_push (branch: ...) before opening a pull request.", summary: "No head branch" };
      throwIfAborted(ctx.signal); // a cancelled run opens no pull request
      const pr = await createPullRequest(token, repo.fullName, { title, body: `${body}\n\n---\nOpened by Curialy AI.`.trim(), head: headBranch, base: base || repo.branch, draft });
      // An already-open pull request is not this run's to report as opened.
      if (!pr.existing) ctx.emit({ type: "repo_pr", fullName: repo.fullName, number: pr.number, url: pr.html_url, head: headBranch, base: base || repo.branch });
      if (pr.existing) return { ok: true, content: `A pull request from ${headBranch} is already open: #${pr.number} ${pr.html_url}. Pushing to ${headBranch} updates it.`, summary: `PR #${pr.number} (already open)` };
      return { ok: true, content: `Opened PR #${pr.number}: ${pr.html_url}`, summary: `PR #${pr.number}` };
    }
    default:
      return { ok: false, content: `Unknown GitHub tool ${name}`, summary: "Unknown tool" };
  }
}

/** Store a screenshot in Curialy Vault (inline in the log while storage is down) and show it in the run. */
async function showScreenshot(ctx: ToolContext, screenshot: Buffer, filename: string, caption: string) {
  let mediaId: string | null = null;
  // Same gate as artifacts: skip while storage is known to be down, otherwise try (after an
  // outage's window this upload is the one call that finds out storage is back).
  let storageUp = true;
  try { assertStorageAvailable(); } catch { storageUp = false; }
  if (storageUp) {
    try {
      mediaId = (await storeMedia({ buffer: screenshot, filename, mimeType: "image/jpeg", kind: "screenshot", sessionId: ctx.sessionId })).id;
    } catch (error) {
      ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stderr", chunk: `Could not store the screenshot: ${error instanceof StorageError ? error.message : "file storage error"}\n` });
    }
  }
  // Without file storage a small screenshot travels inside the event log; a large one is not
  // kept (the model still sees it), so the log cannot balloon.
  const base64 = mediaId ? "" : screenshot.toString("base64");
  const inline = !mediaId && base64.length <= INLINE_SCREENSHOT_LIMIT;
  ctx.emit({ type: "media", callId: ctx.callId, mediaId, filename, mimeType: "image/jpeg", caption, ...(inline ? { inlineDataUrl: `data:image/jpeg;base64,${base64}` } : {}), ...(!mediaId && !inline ? { unavailable: true } : {}) });
}

/** Shared by browse and test_preview_visual: log, store the screenshots, and build the model-facing result. */
async function reportPage(ctx: ToolContext, page: BrowseResult, displayUrl: string, extra: string[] = [], more: { phone?: Buffer | null } = {}): Promise<ToolOutcome> {
  // Preview URLs carry a signed token; it never reaches the log or the model (console errors quote URLs too).
  const safeUrl = (value: string) => value.replace(/\/api\/workspace\/preview\/([^/\s'"]+)\/[^/\s'"]+\//g, "/api/workspace/preview/$1/<token>/");
  const consoleErrors = page.consoleErrors.map(safeUrl);
  ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk: `HTTP ${page.status ?? "?"} · ${safeUrl(page.finalUrl)}\ntitle: ${page.title}\n${consoleErrors.length ? `console errors:\n${consoleErrors.join("\n")}\n` : ""}` });
  const images: ToolImage[] = [];
  const caption = `${page.title || safeUrl(displayUrl)} (${safeUrl(page.finalUrl)})`;
  if (page.screenshot) {
    await showScreenshot(ctx, page.screenshot, "screenshot.jpg", caption);
    if (ctx.vision) images.push({ mediaType: "image/jpeg", base64: page.screenshot.toString("base64") });
  }
  if (more.phone) {
    await showScreenshot(ctx, more.phone, "screenshot-phone.jpg", `Phone width · ${caption}`);
    if (ctx.vision) images.push({ mediaType: "image/jpeg", base64: more.phone.toString("base64") });
  }
  const ok = page.status === null || page.status < 400;
  const seen = images.length === 2
    ? "Two screenshots are attached: the page at desktop size, then the top of the page at phone width (390 px, reduced motion). Check layout, spacing, colours, fonts and that key controls are visible."
    : images.length ? "The screenshot is attached: check layout, spacing, colours, fonts and that key controls are visible."
      : page.screenshot ? "(This model cannot view images; rely on the text, the design audit and console output.)" : "";
  const body = [
    `HTTP ${page.status ?? "unknown"} · final URL ${safeUrl(page.finalUrl)}`,
    `Title: ${page.title}`,
    consoleErrors.length ? `Console errors:\n${consoleErrors.join("\n")}` : "No console errors.",
    ...extra,
    seen,
    page.clippedFrom ? `The page is ${page.clippedFrom} px tall; the desktop screenshot shows its first ${MAX_SHOT_HEIGHT} px.` : "",
    "",
    clip(page.text, 30_000),
  ].filter(line => line !== "").join("\n");
  return { ok, content: body, summary: `HTTP ${page.status ?? "?"} · ${page.title.slice(0, 60) || "page"}`, ...(images.length ? { images } : {}) };
}

const duration = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`);

async function transcribeTool(input: z.infer<typeof schemas.transcribe_audio>, ctx: ToolContext): Promise<ToolOutcome> {
  const { absolute, relative } = resolveInWorkspace(ctx.root, input.path);
  const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    return { ok: false, content: `File not found: ${relative}. A file a command created that is over 8 MB stays in the sandbox and can't be read here: convert it to a smaller mp3 first (e.g. ffmpeg -i in.wav -ac 1 -b:a 64k out.mp3).`, summary: "Not found" };
  }
  const limit = ctx.operator === false ? MAX_TRANSCRIBE_BYTES_FREE : MAX_TRANSCRIBE_BYTES;
  if (stat.size > limit) return { ok: false, content: `${relative} is over ${limit / 1024 / 1024} MB. Convert it to a smaller mp3 (e.g. ffmpeg -i in.wav -ac 1 -b:a 64k out.mp3) or split it, then transcribe the parts.`, summary: "Too large" };
  // Paid for the longest this file could be: a low bit rate can't stretch the account's credits.
  if (ctx.canSpend && !(await ctx.canSpend(voiceCredits({ seconds: worstCaseSeconds(stat.size) })))) {
    return { ok: false, content: `The account doesn't have enough credits to transcribe ${relative}. Tell the user; a smaller or shorter file needs fewer.`, summary: "Not enough credits" };
  }
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let audio: Buffer;
  try { audio = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
  const mime = classify(relative).mimeType;
  ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk: `Transcribing ${relative} (${Math.round(stat.size / 1024)} KB)…\n` });
  const transcript = await transcribe(audio, mime === "application/octet-stream" ? "audio/*" : mime, { language: input.language, speakers: input.speakers, signal: ctx.signal });
  ctx.charge?.(voiceCredits({ seconds: transcript.seconds }), `transcribed ${relative} (${Math.round(transcript.seconds)} s)`);
  const text = (input.speakers && transcript.byParagraph) || transcript.text;
  let savedTo = "";
  if (input.output_path && text) {
    const saved = writeWorkspaceFile(ctx.root, input.output_path, `${text}\n`);
    ctx.onFileChange(saved.relative);
    savedTo = saved.relative;
  }
  const header = `Transcript of ${relative} (${duration(transcript.seconds)}${transcript.language ? `, language ${transcript.language}` : ""})${savedTo ? `, saved to ${savedTo}` : input.output_path ? ", not saved: no speech was found" : ""}:`;
  return { ok: true, content: clip(`${header}\n\n${text || "(no speech detected)"}`, 40_000), summary: `${duration(transcript.seconds)} transcribed` };
}

/** Audio-tag cues ([whispers], [laughs]) are for the expressive voice; the standard voice would read them out. */
const withoutCues = (text: string) => text.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/[ \t]{2,}/g, " ").trim();

async function speechTool(input: z.infer<typeof schemas.generate_speech>, ctx: ToolContext): Promise<ToolOutcome> {
  const target = /\.mp3$/i.test(input.path) ? input.path : `${input.path.replace(/\.[a-z0-9]{1,5}$/i, "")}.mp3`;
  resolveInWorkspace(ctx.root, target);
  const wantsExpressive = input.style === "expressive";
  let expressive = wantsExpressive && ctx.operator !== false && studioConfigured();
  let note = "";
  if (wantsExpressive && !expressive) note = ctx.operator === false ? " The expressive voice is available on the operator's account only, so the standard voice was used." : " The expressive voice isn't set up on this server, so the standard voice was used.";
  if (expressive && input.text.length > MAX_EXPRESSIVE_CHARS) return { ok: false, content: `Expressive speech is limited to ${MAX_EXPRESSIVE_CHARS} characters per call; split the script into parts.`, summary: "Too long" };
  if (!withoutCues(input.text)) return { ok: false, content: "The script has only delivery cues in square brackets and no words to speak.", summary: "Nothing to say" };
  let speech;
  try {
    speech = expressive ? await speakExpressive(input.text, input.voice, ctx.signal) : await speakStandard(withoutCues(input.text), input.voice, ctx.signal);
  } catch (error) {
    // Out of (or near the end of) the expressive budget: the standard voice still delivers.
    if (!(expressive && error instanceof VoiceError && error.code === "studio_budget")) throw error;
    expressive = false;
    note = " The expressive voice's budget for this month is used up, so the standard voice was used.";
    speech = await speakStandard(withoutCues(input.text), input.voice, ctx.signal);
  }
  const saved = writeWorkspaceBytes(ctx.root, target, speech.audio);
  ctx.onFileChange(saved.relative);
  ctx.charge?.(voiceCredits({ characters: input.text.length, expressive: speech.engine === "studio" }), `speech: ${input.text.length} characters${speech.engine === "studio" ? " (expressive)" : ""}`);
  const result = await storeArtifacts(ctx.sessionId, ctx.root, [saved.relative], true);
  if (result.stored.length) {
    ctx.emit({ type: "artifacts", files: result.stored, auto: false, more: 0, skipped: result.skipped.map(reason => brandText(reason)) });
    ctx.onAttach?.(result.stored.map(file => file.path));
  }
  // The standard voice is 48 kbps MP3 (6 KB a second), the expressive one 128 kbps (16 KB a second).
  const seconds = Math.max(1, Math.round(speech.audio.length / (speech.engine === "studio" ? 16_000 : 6_000)));
  return {
    ok: true,
    content: `Saved ${saved.relative} (about ${duration(seconds)}, ${Math.round(speech.audio.length / 1024)} KB, ${speech.engine === "studio" ? "expressive" : "standard"} voice "${input.voice}") and attached it for the user to play.${note}`,
    summary: `${speech.engine === "studio" ? "Expressive" : "Standard"} speech · ${duration(seconds)}`,
  };
}

async function visualTest(input: z.infer<typeof schemas.test_preview_visual>, ctx: ToolContext): Promise<ToolOutcome> {
  const log = (chunk: string, stream: "stdout" | "stderr" = "stdout") => ctx.emit({ type: "tool_output", callId: ctx.callId, stream, chunk });
  const page = input.page.startsWith("/") ? input.page.slice(1) : input.page;
  const extra: string[] = [];
  let url: string;
  let server: { controller: AbortController; done: Promise<unknown> } | null = null;

  if (input.start_command) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    ctx.signal.addEventListener("abort", abort, { once: true });
    log(`$ ${input.start_command}\n`);
    let serverOutput = "";
    const done = runCommand({ root: ctx.root, command: input.start_command, timeoutSec: 600, signal: controller.signal, onOutput: (stream, chunk) => { serverOutput += chunk; log(chunk, stream); } });
    server = { controller, done };
    const remoteHost = SANDBOX_MODE === "e2b" ? () => sandboxPortHost(ctx.sessionId, input.port) : undefined;
    const up = await Promise.race([waitForPort(input.port, 90_000, controller.signal, remoteHost), done.then(() => false)]);
    if (!up) {
      controller.abort();
      await done.catch(() => undefined);
      ctx.signal.removeEventListener("abort", abort);
      return { ok: false, content: `The server never started listening on port ${input.port}.\n${clip(serverOutput, 8000)}`, summary: `Port ${input.port} never opened` };
    }
    registerLiveServer(ctx.sessionId, input.port, remoteHost?.());
    url = `${previewBaseUrl(ctx.sessionId)}${page}`;
    ctx.emit({ type: "preview", url: previewBaseUrl(ctx.sessionId), dir: null, mode: "server" });
  } else {
    const site = detectPreviewRoot(ctx.sessionId, input.dir);
    if (!site) return { ok: false, content: `No index.html found${input.dir ? ` in ${input.dir}` : " in dist/, build/, out/, public/ or the workspace root"}. Build the project first (e.g. npm run build), or pass start_command to test a running server.`, summary: "Nothing to preview" };
    const warnings = absoluteAssetWarnings(fs.readFileSync(path.join(site.absolute, "index.html"), "utf8"));
    if (warnings.length) extra.push(`Warning: index.html references absolute paths (${warnings.join(", ")}); they resolve outside the preview. Rebuild with relative asset paths (Vite: base: './').`);
    url = `${previewBaseUrl(ctx.sessionId, undefined, site.dir)}${page}`;
    log(`Serving ${site.dir === "." ? "the workspace root" : `${site.dir}/`} as a static preview.\n`);
    ctx.emit({ type: "preview", url: previewBaseUrl(ctx.sessionId, undefined, site.dir), dir: site.dir, mode: "static" });
  }

  try {
    log("Opening it in the Curialy Live Browser…\n");
    const live = await liveBrowser(ctx.sessionId, ctx.emit, ctx.signal, ctx.operator !== false);
    const check = await visualCheck(live, url, { waitMs: input.wait_ms, fullPage: input.full_page, audit: input.audit, signal: ctx.signal });
    const audit = input.audit ? auditPage(check.facts.desktop, check.facts.phone, { surface: ctx.design?.surface, allowed: ctx.design?.allowed }) : null;
    if (audit) audit.problems.unshift(...check.problems);
    if (audit) {
      const text = auditText(audit);
      extra.push(text);
      log(`${text}\n`);
    } else if (input.audit) {
      extra.push(`The design audit could not run${check.problems.length ? ` (${check.problems.join("; ")})` : ""}; judge the screenshots yourself.`);
    }
    const outcome = await reportPage(ctx, check.desktop, url, extra, { phone: check.phoneShot });
    return { ...outcome, audit };
  } finally {
    if (server) {
      unregisterLiveServer(ctx.sessionId);
      server.controller.abort();
      await server.done.catch(() => undefined);
      log("Test server stopped.\n");
    }
  }
}

async function runBrowserTool(name: ToolName, input: any, ctx: ToolContext): Promise<ToolOutcome> {
  if (name === "browser_close") {
    await closeLiveBrowser(ctx.sessionId, "agent");
    return { ok: true, content: "Browser session closed.", summary: "Closed" };
  }
  const live = await liveBrowser(ctx.sessionId, ctx.emit, ctx.signal, ctx.operator !== false);
  const { page } = live;
  const where = () => `Now at ${page.url()}`;
  switch (name) {
    case "browser_click": {
      const { selector, text } = input as z.infer<typeof schemas.browser_click>;
      live.action("click", `Clicking ${selector ?? `"${text}"`}…`);
      const locator = selector ? page.locator(selector).first() : page.getByRole("button", { name: text }).or(page.getByRole("link", { name: text })).or(page.getByText(text!, { exact: false })).first();
      await locator.click({ timeout: 15_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
      live.action("loaded", `Clicked ${selector ?? `"${text}"`}; now on ${(await page.title().catch(() => "")) || page.url()}`);
      return { ok: true, content: `Clicked ${selector ?? `"${text}"`}. ${where()} (title: ${await page.title().catch(() => "")}).`, summary: `Clicked ${selector ?? text}` };
    }
    case "browser_type": {
      const { selector, text, press_enter } = input as z.infer<typeof schemas.browser_type>;
      live.action("type", `Typing into ${selector}…`);
      await page.locator(selector).first().fill(text, { timeout: 15_000 });
      if (press_enter) {
        await page.locator(selector).first().press("Enter");
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      }
      return { ok: true, content: `Typed ${text.length} characters into ${selector}${press_enter ? " and pressed Enter" : ""}. ${where()}.`, summary: `Typed into ${selector}` };
    }
    case "browser_scroll": {
      const { direction, pixels } = input as z.infer<typeof schemas.browser_scroll>;
      live.action("scroll", `Scrolling ${direction}…`);
      await page.evaluate(({ direction: dir, pixels: px }) => {
        if (dir === "top") window.scrollTo(0, 0);
        else if (dir === "bottom") window.scrollTo(0, document.body.scrollHeight);
        else window.scrollBy(0, dir === "down" ? px : -px);
      }, { direction, pixels });
      const position = await page.evaluate(() => ({ y: Math.round(window.scrollY), height: document.body.scrollHeight }));
      return { ok: true, content: `Scrolled ${direction}; now at ${position.y}px of ${position.height}px.`, summary: `Scrolled ${direction}` };
    }
    case "browser_extract": {
      const { selector, include_links } = input as z.infer<typeof schemas.browser_extract>;
      live.action("extract", selector ? `Extracting ${selector}…` : "Extracting page content…");
      const data = await page.evaluate(({ selector: sel, includeLinks }) => {
        const nodes = sel ? Array.from(document.querySelectorAll(sel)) : [document.body];
        const text = nodes.map(node => (node as HTMLElement).innerText ?? "").join("\n\n");
        const links = includeLinks ? Array.from(document.querySelectorAll("a[href]")).slice(0, 200).map(a => `${(a as HTMLAnchorElement).innerText.trim().slice(0, 80)} -> ${(a as HTMLAnchorElement).href}`) : [];
        return { text, links, matched: nodes.length };
      }, { selector: selector ?? null, includeLinks: include_links });
      if (selector && data.matched === 0) return { ok: false, content: `No elements match ${selector}. ${where()}.`, summary: "No match" };
      const body = `${where()} (title: ${await page.title().catch(() => "")})\n\n${clip(data.text, 40_000)}${data.links.length ? `\n\nLinks:\n${data.links.join("\n")}` : ""}`;
      return { ok: true, content: body, summary: `${data.text.length} chars${data.links.length ? `, ${data.links.length} links` : ""}` };
    }
    case "browser_screenshot": {
      const { full_page } = input as z.infer<typeof schemas.browser_screenshot>;
      live.action("screenshot", "Taking a screenshot…");
      return reportPage(ctx, await snapshot(live, { screenshot: true, fullPage: full_page }), page.url());
    }
    default:
      return { ok: false, content: `Unknown browser tool ${name}`, summary: "Unknown tool" };
  }
}
