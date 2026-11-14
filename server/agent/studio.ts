import fs from "node:fs";
import path from "node:path";
import { Sandbox, CommandExitError } from "e2b";

// The Animation Studio (/opt/animation-studio): a library of skills (SKILL.md files: the official
// Remotion agent skills, and notes for Manim and the web animation libraries) the agent loads
// before writing animation code, and renders that run in a separate cloud render sandbox (template
// "curialy-animation": 2 CPUs, 2 GB, Remotion, Chromium, ffmpeg, Manim and the web libraries
// preinstalled), never on this server, which has too little memory for a browser render. Each
// render gets a fresh sandbox that is killed when it ends; its file comes back to
// /opt/animation-studio/output/<task>/.

export const STUDIO_DIR = process.env.STUDIO_DIR || "/opt/animation-studio";
const TEMPLATE = process.env.STUDIO_TEMPLATE || "curialy-animation";
const MAX_RENDERS = 2;
export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const JOB = "/home/user/job";

/** Skills on disk, and the render template built (render/template.json). */
export function studioAvailable() {
  return Boolean(process.env.E2B_API_KEY) && fs.existsSync(path.join(STUDIO_DIR, "skills")) && fs.existsSync(path.join(STUDIO_DIR, "render", "template.json"));
}

// ---- Skills ----

export type SkillInfo = { name: string; description: string; render: string; dir: string };

let catalogCache: { at: number; skills: SkillInfo[] } | null = null;

function frontmatter(text: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of match?.[1].split("\n") ?? []) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

/** Every skill in skills/ (symlinks to the official Remotion skills included), read again after a minute. */
export function skillCatalog(): SkillInfo[] {
  if (catalogCache && Date.now() - catalogCache.at < 60_000) return catalogCache.skills;
  const root = path.join(STUDIO_DIR, "skills");
  const skills: SkillInfo[] = [];
  for (const entry of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, entry);
    const file = path.join(dir, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const meta = frontmatter(fs.readFileSync(file, "utf8"));
    skills.push({ name: meta.name || entry, description: meta.description || "", render: meta.render || (entry.startsWith("remotion") ? "remotion" : "none"), dir: fs.realpathSync(dir) });
  }
  skills.sort((a, b) => (a.name === "curialy-studio" ? -1 : b.name === "curialy-studio" ? 1 : a.name.localeCompare(b.name)));
  catalogCache = { at: Date.now(), skills };
  return skills;
}

const READABLE = /\.(md|mdx|txt|tsx?|jsx?|json|py|html|ya?ml|css)$/i;
const MAX_SKILL_CHARS = 40_000;

/** Files of a skill the agent can load (relative paths), for "see also". */
function skillFiles(dir: string) {
  const out: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 4 || out.length > 120) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "agents") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && /\.mdx?$/i.test(entry.name) && entry.name !== "SKILL.md") out.push(path.relative(dir, full));
    }
  };
  walk(dir, 0);
  return out.sort();
}

export type LoadedSkill = { name: string; file: string; text: string; truncated: boolean; others: string[] };

/** A skill's SKILL.md, or one of its files; never a path outside the skill. */
export function readSkill(name: string, file?: string): LoadedSkill {
  const skill = skillCatalog().find(entry => entry.name === name);
  if (!skill) throw new Error(`No skill named "${name}". Skills: ${skillCatalog().map(entry => entry.name).join(", ")}.`);
  const wanted = (file ?? "SKILL.md").replace(/^\.?\/+/, "");
  const full = path.resolve(skill.dir, wanted);
  const real = fs.existsSync(full) ? fs.realpathSync(full) : null;
  if (!real || !(real === skill.dir || real.startsWith(`${skill.dir}${path.sep}`)) || !fs.statSync(real).isFile() || !READABLE.test(real)) {
    throw new Error(`"${wanted}" isn't a file of the ${name} skill. Its files: ${skillFiles(skill.dir).slice(0, 60).join(", ") || "SKILL.md only"}.`);
  }
  const raw = fs.readFileSync(real, "utf8");
  return { name, file: wanted, text: raw.slice(0, MAX_SKILL_CHARS), truncated: raw.length > MAX_SKILL_CHARS, others: skillFiles(skill.dir) };
}

/** The skills each task loaded (this process; a restart starts over, which only asks to load again). */
const loaded = new Map<string, Set<string>>();

export function markLoaded(taskId: string, ...names: string[]) {
  const set = loaded.get(taskId) ?? new Set<string>();
  for (const name of names) set.add(name);
  loaded.set(taskId, set);
  if (loaded.size > 5000) loaded.delete(loaded.keys().next().value!);
}

export function hasLoaded(taskId: string, test: (name: string) => boolean) {
  return [...(loaded.get(taskId) ?? [])].some(test);
}

export const loadedSkills = (taskId: string) => [...(loaded.get(taskId) ?? [])];

/** Tests. */
export function resetStudio() {
  loaded.clear();
  catalogCache = null;
}

// ---- Project files ----

const SKIP = new Set(["node_modules", ".git", "out", "build", "dist", ".tmp", ".cache", "media", "__pycache__", ".remotion", "renders"]);
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_UPLOAD_FILES = 2500;

/** A project folder of the workspace, as files to upload (relative paths), without dependencies or build output. */
export function collectProject(dir: string) {
  const files: { path: string; data: Buffer }[] = [];
  let total = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        total += size;
        if (total > MAX_UPLOAD_BYTES) throw new Error(`The project is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB (without node_modules and build output): leave large media out, or make them smaller.`);
        if (files.length >= MAX_UPLOAD_FILES) throw new Error(`The project has over ${MAX_UPLOAD_FILES} files: render a smaller folder.`);
        files.push({ path: path.relative(dir, full), data: fs.readFileSync(full) });
      }
    }
  };
  walk(dir);
  return files;
}

/** The render scripts and page helper as they are on this server (uploaded with every job). */
function studioScripts() {
  const base = path.join(STUDIO_DIR, "render", "studio");
  const scripts = fs.readdirSync(path.join(base, "bin")).map(name => ({ path: `/opt/studio/bin/${name}`, data: fs.readFileSync(path.join(base, "bin", name)) }));
  return [...scripts, { path: "/opt/studio/web/web.js", data: fs.readFileSync(path.join(base, "web", "web.js")) }];
}

// ---- Rendering ----

let running = 0;
const waiting: (() => void)[] = [];

async function slot(signal?: AbortSignal) {
  if (running < MAX_RENDERS) { running++; return; }
  await new Promise<void>((resolve, reject) => {
    const go = () => { signal?.removeEventListener("abort", stop); running++; resolve(); };
    const stop = () => { const index = waiting.indexOf(go); if (index >= 0) waiting.splice(index, 1); reject(signal?.reason ?? new Error("Cancelled")); };
    waiting.push(go);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

function release() {
  running--;
  waiting.shift()?.();
}

export class RenderError extends Error {}

export type RenderJob = {
  taskId: string;
  /** Uploaded under /home/user/job (relative paths). */
  files: { path: string; data: Buffer }[];
  /** Run with bash -lc in /home/user/job. */
  command: string;
  /** Absolute path of the file the command writes. */
  output: string;
  timeoutMs: number;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  signal?: AbortSignal;
  /** Tests: a sandbox stand-in. */
  sandbox?: () => Promise<StudioSandbox>;
};

/** What a render needs from a sandbox (the real one, or a test's). */
export type StudioSandbox = {
  write: (files: { path: string; data: Buffer }[]) => Promise<void>;
  run: (command: string, opts: { timeoutMs: number; onStdout: (data: string) => void; onStderr: (data: string) => void }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  read: (file: string) => Promise<Buffer>;
  kill: () => Promise<void>;
};

async function openSandbox(taskId: string, timeoutMs: number): Promise<StudioSandbox> {
  const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: timeoutMs + 120_000, metadata: { app: "curialy", purpose: "studio-render", taskId } });
  const envs: Record<string, string> = process.env.REMOTION_LICENSE_KEY ? { REMOTION_LICENSE_KEY: process.env.REMOTION_LICENSE_KEY } : {};
  return {
    write: async files => {
      for (let index = 0; index < files.length; index += 200) {
        await sandbox.files.write(files.slice(index, index + 200).map(file => ({ path: file.path, data: file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer })));
      }
    },
    run: async (command, opts) => {
      try {
        const result = await sandbox.commands.run(command, { timeoutMs: opts.timeoutMs, onStdout: opts.onStdout, onStderr: opts.onStderr, envs, cwd: JOB });
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        if (error instanceof CommandExitError) return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
        throw error;
      }
    },
    read: async file => Buffer.from(await sandbox.files.read(file, { format: "bytes" })),
    kill: async () => { await sandbox.kill().catch(() => undefined); },
  };
}

/** Run one render in a fresh render sandbox and return the file it wrote (the sandbox is always killed). */
export async function renderInStudio(job: RenderJob): Promise<{ bytes: Buffer; log: string; seconds: number }> {
  await slot(job.signal);
  const started = Date.now();
  let box: StudioSandbox | null = null;
  const onAbort = () => void box?.kill();
  job.signal?.addEventListener("abort", onAbort, { once: true });
  let log = "";
  const capture = (stream: "stdout" | "stderr") => (data: string) => {
    if (log.length < 200_000) log += data;
    job.onOutput?.(stream, data);
  };
  try {
    box = await (job.sandbox ? job.sandbox() : openSandbox(job.taskId, job.timeoutMs));
    if (job.signal?.aborted) throw job.signal.reason ?? new Error("Cancelled");
    await box.write([...studioScripts(), ...job.files.map(file => ({ path: path.posix.join(JOB, file.path.split(path.sep).join("/")), data: file.data }))]);
    const result = await box.run(`chmod +x /opt/studio/bin/* && cd ${JOB} && ${job.command}`, { timeoutMs: job.timeoutMs, onStdout: capture("stdout"), onStderr: capture("stderr") });
    if (job.signal?.aborted) throw job.signal.reason ?? new Error("Cancelled");
    if (result.exitCode !== 0) throw new RenderError(`The render failed (exit ${result.exitCode}).`);
    const bytes = await box.read(job.output).catch(() => { throw new RenderError("The render finished without writing its file."); });
    if (bytes.length > MAX_OUTPUT_BYTES) throw new RenderError(`The rendered file is over ${MAX_OUTPUT_BYTES / 1024 / 1024} MB.`);
    return { bytes, log, seconds: Math.round((Date.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof RenderError) throw Object.assign(error, { log });
    throw error;
  } finally {
    job.signal?.removeEventListener("abort", onAbort);
    await box?.kill();
    release();
  }
}

/** Where a task's renders are kept on this server. */
export function outputPath(taskId: string, name: string) {
  const dir = path.join(STUDIO_DIR, "output", taskId.replace(/[^a-z0-9-]/gi, ""));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
