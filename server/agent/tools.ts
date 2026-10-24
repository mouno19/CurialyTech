import type Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import { z } from "zod";
import type { PlanStep } from "@shared/agent";
import type { Emit } from "./bus";
import { PROVIDER_ENV, runManusTask } from "./providers";
import { clip, deleteWorkspaceFile, listWorkspaceTree, readWorkspaceFile, runCommand, SandboxError, writeWorkspaceFile } from "./sandbox";

export type ToolContext = {
  root: string;
  callId: string;
  signal: AbortSignal;
  emit: Emit;
  onPlan: (steps: PlanStep[]) => void;
  onFileChange: (path: string) => void;
  onCommand: (command: string) => void;
};

export type ToolOutcome = { ok: boolean; content: string; summary: string; exitCode?: number | null };

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
  write_file: z.object({ path: z.string().min(1), content: z.string() }),
  edit_file: z.object({ path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().default(false) }),
  delete_file: z.object({ path: z.string().min(1) }),
  search_files: z.object({ pattern: z.string().min(1).max(500), path: z.string().default(".") }),
  run_command: z.object({ command: z.string().min(1).max(8000), timeout_sec: z.number().int().min(5).max(600).default(120) }),
  web_fetch: z.object({ url: z.string().url().max(2000) }),
  delegate_research: z.object({ task: z.string().min(10).max(12000) }),
};

type ToolName = keyof typeof schemas;

type ToolDef = Anthropic.Tool & { name: ToolName };

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
    description: "Create or fully overwrite a file with the given content. Prefer edit_file for targeted changes to existing files.",
    input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string", description: "Complete file contents" } }, required: ["path", "content"] },
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
    description: "Run a bash command in the workspace as an unprivileged sandbox user (Node 22, npm, Python 3.10 available; internet access, no access to the host). stdout/stderr stream live to the user. Use for installs, builds, typechecks, linters and tests.",
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
  description: "Delegate open-ended web research or a browser workflow to the Manus autonomous agent. Slow (minutes) and billed per task; use only when web_fetch on known URLs is not enough.",
  input_schema: { type: "object", properties: { task: { type: "string", description: "Self-contained instructions for Manus, including the expected output." } }, required: ["task"] },
};

export function toolsFor(opts: { coding: boolean; web: boolean; eager: boolean }): Anthropic.Tool[] {
  const tools: ToolDef[] = [];
  if (opts.coding) tools.push(...CODING_TOOLS);
  if (opts.web) {
    tools.push(WEB_FETCH_TOOL);
    if (PROVIDER_ENV.manusKey) tools.push(DELEGATE_TOOL);
  }
  return opts.eager ? tools.map(tool => ({ ...tool, eager_input_streaming: true })) : tools;
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
  const parsed = schemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    return { ok: false, content: `INVALID_INPUT: ${issues}. Re-issue the call with a complete, valid input.`, summary: "Invalid input" };
  }
  try {
    return await run(name as ToolName, parsed.data as never, ctx);
  } catch (error) {
    const message = error instanceof SandboxError || error instanceof Error ? error.message : String(error);
    return { ok: false, content: `Error: ${message}`, summary: message.slice(0, 160) };
  }
}

async function run(name: ToolName, input: any, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
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
      const { path, content } = input as z.infer<typeof schemas.write_file>;
      const previous = readWorkspaceFile(ctx.root, path);
      const { relative } = writeWorkspaceFile(ctx.root, path, content);
      const { added, removed } = emitFileChange(ctx, relative, previous.exists ? previous.content : null, content);
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
      const result = await runCommand({ root: ctx.root, command, timeoutSec: 30, signal: ctx.signal, onOutput: () => undefined });
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
      const result = await runCommand({ root: ctx.root, command, timeoutSec: 40, signal: ctx.signal, onOutput: () => undefined });
      const marker = result.output.lastIndexOf("__HTTP_STATUS__");
      const meta = marker >= 0 ? result.output.slice(marker + 15).trim() : "unknown";
      const body = marker >= 0 ? result.output.slice(0, marker) : result.output;
      const text = /html/i.test(meta) || /<html/i.test(body.slice(0, 500)) ? htmlToText(body) : body;
      const ok = result.exitCode === 0 && /^2/.test(meta);
      return { ok, content: clip(`HTTP ${meta}\n\n${text}`, 40_000), summary: `HTTP ${meta.split(" ")[0]} · ${text.length} chars` };
    }
    case "delegate_research": {
      const { task } = input as z.infer<typeof schemas.delegate_research>;
      const result = await runManusTask(task, {
        signal: ctx.signal,
        onProgress: update => {
          ctx.emit({ type: "external", source: "manus", status: update.status, detail: update.detail, url: update.url });
          ctx.emit({ type: "tool_output", callId: ctx.callId, stream: "stdout", chunk: `[manus:${update.status}] ${update.detail}\n` });
        },
      });
      return { ok: result.status === "completed", content: clip(`${result.answer}\n\n(Manus task: ${result.url})`, 40_000), summary: `Manus ${result.status}` };
    }
  }
}
