import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { diffLines } from "diff";
import { z } from "zod";
import { rateLimited } from "../auth";
import { storeMedia } from "../media/snowflake";
import { classify } from "./artifacts";
import { digestOutput } from "./output";
import { resolveInWorkspace } from "./sandbox";
import { taskOwner } from "./store";
import { collectProject, hasLoaded, loadedSkills, markLoaded, MAX_OUTPUT_BYTES, outputPath, readSkill, RenderError, renderInStudio, skillCatalog, STUDIO_DIR, type RenderJob } from "./studio";
import type { ToolContext, ToolImage, ToolOutcome } from "./tools";

// The agent's Animation Studio tools. Skills first: load_skill reads a SKILL.md (or one of its
// files); the create_* tools scaffold a project and load the matching skill as they do; the render_*
// tools refuse until a matching skill was loaded in this task. Renders run in a fresh cloud render
// sandbox; the file is kept in /opt/animation-studio/output/<task>/, attached to the chat, and its
// path returned.

const slug = z.string().trim().min(1).max(60).regex(/^[a-z0-9][a-z0-9-]*$/i, "letters, digits and - only");
const projectPath = z.string().trim().min(1).max(300);
const WEB_LIBRARIES = ["animejs", "threejs", "lottie", "konva", "twojs", "tweenjs", "babylonjs", "proton", "canvas"] as const;

export const STUDIO_SCHEMAS = {
  load_skill: z.object({ name: z.string().trim().min(1).max(80), file: z.string().trim().max(200).optional() }),
  create_remotion_project: z.object({
    name: slug,
    composition_id: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9-]{0,40}$/).default("Main"),
    width: z.coerce.number().int().min(16).max(3840).default(1920),
    height: z.coerce.number().int().min(16).max(3840).default(1080),
    fps: z.coerce.number().int().min(1).max(60).default(30),
    duration_seconds: z.coerce.number().min(0.5).max(300).default(6),
  }),
  render_remotion: z.object({
    project_path: projectPath,
    composition: z.string().trim().max(80).optional(),
    format: z.enum(["mp4", "webm", "gif", "png"]).default("mp4"),
    frame: z.coerce.number().int().min(0).optional(),
    frames: z.string().trim().regex(/^\d+(-\d+)?$/).optional(),
    scale: z.coerce.number().min(0.1).max(2).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    output_name: slug.optional(),
  }),
  generate_manim_scene: z.object({ name: slug, scene: z.string().trim().regex(/^[A-Z][A-Za-z0-9_]{0,60}$/).default("Main"), code: z.string().max(60_000).optional() }),
  render_manim: z.object({ file: projectPath, scene: z.string().trim().regex(/^[A-Z][A-Za-z0-9_]{0,60}$/), quality: z.enum(["low", "medium", "high"]).default("medium"), format: z.enum(["mp4", "gif"]).default("mp4"), output_name: slug.optional() }),
  create_web_animation: z.object({
    name: slug,
    library: z.enum(WEB_LIBRARIES),
    width: z.coerce.number().int().min(16).max(3840).default(1280),
    height: z.coerce.number().int().min(16).max(3840).default(720),
    fps: z.coerce.number().int().min(1).max(60).default(30),
    duration_seconds: z.coerce.number().min(0.5).max(60).default(4),
  }),
  render_web_animation: z.object({
    path: projectPath,
    format: z.enum(["mp4", "webm", "gif", "png"]).default("mp4"),
    at: z.coerce.number().min(0).optional(),
    fps: z.coerce.number().int().min(1).max(60).optional(),
    duration_seconds: z.coerce.number().min(0.1).max(60).optional(),
    output_name: slug.optional(),
  }),
};

export type StudioToolName = keyof typeof STUDIO_SCHEMAS;
export const STUDIO_TOOL_NAMES = Object.keys(STUDIO_SCHEMAS) as StudioToolName[];

const FORMAT = { type: "string", enum: ["mp4", "webm", "gif", "png"], description: "Default mp4; png is a single still" };

export const STUDIO_TOOLS: (Anthropic.Tool & { name: StudioToolName })[] = [
  {
    name: "load_skill",
    description: "Load an Animation Studio skill (its SKILL.md, or one of its files with `file`) before writing or rendering animation or video code. Required: never write Remotion, Manim or animation-library code from memory. The skills are listed in the Animation Studio context; Remotion's router is remotion-best-practices.",
    input_schema: { type: "object", properties: { name: { type: "string" }, file: { type: "string", description: "A file of the skill, e.g. compositions.md or remotion-create/REFERENCE.md" } }, required: ["name"] },
  },
  {
    name: "create_remotion_project",
    description: "Scaffold a Remotion project (Remotion 4.0.543, blank template) at animations/<name>/ with one composition, and load the Remotion create skill. Then load remotion-markup before writing the video's markup.",
    input_schema: { type: "object", properties: { name: { type: "string" }, composition_id: { type: "string" }, width: { type: "number" }, height: { type: "number" }, fps: { type: "number" }, duration_seconds: { type: "number" } }, required: ["name"] },
  },
  {
    name: "render_remotion",
    description: "Render a Remotion project of the workspace in the cloud render sandbox: a video (mp4, webm, gif) or a still (png, with frame). Draft first: scale 0.5 or frames \"0-59\"; then the full render. Returns the file's path; the file is attached to the chat. Needs a Remotion skill loaded in this task (remotion-render).",
    input_schema: { type: "object", properties: { project_path: { type: "string", description: "e.g. animations/intro" }, composition: { type: "string", description: "Composition id (default: the only one)" }, format: FORMAT, frame: { type: "number", description: "png: the frame to capture" }, frames: { type: "string", description: "Only these frames, e.g. 0-89" }, scale: { type: "number", description: "0.1-2, e.g. 0.5 for a quick draft" }, props: { type: "object", description: "Input props (merged over defaultProps)" }, output_name: { type: "string" } }, required: ["project_path"] },
  },
  {
    name: "generate_manim_scene",
    description: "Write a Manim scene file at animations/<name>/scene.py (a starter, or the code you pass) and load the Manim skill.",
    input_schema: { type: "object", properties: { name: { type: "string" }, scene: { type: "string", description: "Scene class name" }, code: { type: "string", description: "The full Python file (optional)" } }, required: ["name"] },
  },
  {
    name: "render_manim",
    description: "Render a Manim scene of the workspace in the cloud render sandbox (mp4 or gif; quality low 480p15, medium 720p30, high 1080p60). Returns the file's path; the file is attached to the chat. Needs the manim skill loaded in this task.",
    input_schema: { type: "object", properties: { file: { type: "string", description: "e.g. animations/explainer/scene.py" }, scene: { type: "string" }, quality: { type: "string", enum: ["low", "medium", "high"] }, format: { type: "string", enum: ["mp4", "gif"] }, output_name: { type: "string" } }, required: ["file", "scene"] },
  },
  {
    name: "create_web_animation",
    description: "Scaffold an HTML animation at animations/<name>/index.html for a web library (animejs, threejs, lottie, konva, twojs, tweenjs, babylonjs, proton, or canvas for plain 2D canvas) from its skill's working example, and load that skill.",
    input_schema: { type: "object", properties: { name: { type: "string" }, library: { type: "string", enum: [...WEB_LIBRARIES] }, width: { type: "number" }, height: { type: "number" }, fps: { type: "number" }, duration_seconds: { type: "number" } }, required: ["name", "library"] },
  },
  {
    name: "render_web_animation",
    description: "Render an HTML animation (a page that calls defineAnimation from /studio/web.js) frame by frame in the cloud render sandbox: mp4, webm, gif, or a png still (at seconds). Returns the file's path; the file is attached to the chat. Needs the page's library skill loaded in this task.",
    input_schema: { type: "object", properties: { path: { type: "string", description: "e.g. animations/logo/index.html" }, format: FORMAT, at: { type: "number", description: "png: the moment to capture, in seconds" }, fps: { type: "number" }, duration_seconds: { type: "number" }, output_name: { type: "string" } }, required: ["path"] },
  },
];

/** The Animation Studio block of the agent's context: the rule and the skills, names only. */
export function studioContext() {
  const skills = skillCatalog();
  return `Animation Studio (animations and videos):
RULE: before you write, edit, animate or render any animation or video, call load_skill for the matching skill and follow it; never write Remotion, Manim or animation-library code from memory. Start with curialy-studio (how rendering works here). Remotion (preferred for most video work): unsure which skill -> remotion-best-practices; new project or composition -> remotion-create (create_remotion_project); React markup and animation -> remotion-markup; rendering -> remotion-render; previewing -> remotion-studio (on Curialy: draft renders, see curialy-studio). Other libraries: load the skill of that name. The render_* tools refuse until a matching skill is loaded.
Skills: ${skills.map(skill => `${skill.name} (${skill.description.replace(/\s+/g, " ").slice(0, 110)})`).join("; ")}.`;
}

/** The skill example's HTML (the scaffold for create_web_animation), with the requested size and timing. */
function webTemplate(library: (typeof WEB_LIBRARIES)[number], opts: { width: number; height: number; fps: number; duration: number }) {
  const html = library === "canvas" ? CANVAS_TEMPLATE : /```html\n([\s\S]*?)```/.exec(readSkill(library).text)?.[1];
  if (!html) throw new Error(`The ${library} skill has no example to start from.`);
  return html
    .replace(/width: \d+, height: \d+, fps: \d+, duration: [\d.]+/, `width: ${opts.width}, height: ${opts.height}, fps: ${opts.fps}, duration: ${opts.duration}`);
}

const CANVAS_TEMPLATE = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body>
  <div id="stage"></div>
  <script type="module">
    import { defineAnimation } from "/studio/web.js";

    const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    defineAnimation({
      width: 1280, height: 720, fps: 30, duration: 4, background: "#14110f",
      setup: (stage, { width, height }) => {
        const canvas = Object.assign(document.createElement("canvas"), { width, height });
        stage.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        return ms => {
          const t = ms / 1000;
          ctx.fillStyle = "#14110f";
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = "#ff5a36";
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, 40 + 160 * ease(t / 1.5), 0, Math.PI * 2);
          ctx.fill();
        };
      },
    });
  </script>
</body>
</html>
`;

const REMOTION_ROOT = (id: string, opts: { width: number; height: number; fps: number; frames: number }) => `import { Composition } from "remotion";
import { Main } from "./Main";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="${id}"
        component={Main}
        durationInFrames={${opts.frames}}
        fps={${opts.fps}}
        width={${opts.width}}
        height={${opts.height}}
        defaultProps={{ title: "${id}" }}
      />
    </>
  );
};
`;

const REMOTION_MAIN = `import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { readonly title: string };

const Title: React.FC<{ readonly text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 0.8 * fps], [0, 1], { extrapolateRight: "clamp" });
  return <h1 style={{ margin: 0, fontFamily: "DejaVu Sans, sans-serif", fontSize: 110, color: "#f5f0e8", opacity }}>{text}</h1>;
};

export const Main: React.FC<Props> = ({ title }) => {
  return (
    <AbsoluteFill style={{ background: "#14110f", justifyContent: "center", alignItems: "center" }}>
      <Title text={title} />
    </AbsoluteFill>
  );
};
`;

const MANIM_STARTER = (scene: string) => `from manim import *


class ${scene}(Scene):
    def construct(self):
        title = Text("${scene}", font_size=64)
        self.play(Write(title))
        self.wait(0.5)
`;

const ext = (format: string) => (format === "png" ? "png" : format);

/** The skills a web page uses, from what it imports. */
const PAGE_LIBRARIES: [RegExp, string][] = [[/from\s+["']animejs["']/, "animejs"], [/from\s+["']three["']|three\/addons/, "threejs"], [/from\s+["']lottie-web["']/, "lottie"], [/from\s+["']konva["']/, "konva"], [/from\s+["']two\.js["']/, "twojs"], [/@tweenjs\/tween\.js|@createjs\/tweenjs/, "tweenjs"], [/@babylonjs\/core/, "babylonjs"], [/proton-engine/, "proton"]];

type Ctx = Pick<ToolContext, "sessionId" | "root" | "emit" | "callId" | "signal" | "onFileChange"> & { vision?: boolean };

/** A file a scaffold wrote, shown in the run like the file tools' writes. */
function wrote(ctx: Ctx, file: string, before: string | null, after: string) {
  let added = 0;
  let removed = 0;
  for (const change of diffLines(before ?? "", after)) {
    if (change.added) added += change.count ?? 0;
    if (change.removed) removed += change.count ?? 0;
  }
  ctx.emit({ type: "file_change", callId: ctx.callId, path: file, kind: before === null ? "create" : "modify", before: (before ?? "").slice(0, 200_000), after: after.slice(0, 200_000), bytesBefore: Buffer.byteLength(before ?? ""), bytesAfter: Buffer.byteLength(after), added, removed, truncated: false });
  ctx.onFileChange(file);
}

/**
 * What the model sees of a render (vision models): a still as it is, a video or GIF as three frames
 * (15%, 50% and 85% of it), taken with ffmpeg here, small (a short decode). Empty when it can't be read.
 */
export function previewFrames(file: string): ToolImage[] {
  if (/\.png$/i.test(file)) {
    const size = fs.statSync(file).size;
    return size <= 4 * 1024 * 1024 ? [{ mediaType: "image/png", base64: fs.readFileSync(file).toString("base64") }] : [];
  }
  try {
    const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8", timeout: 15_000 }).trim());
    if (!(duration > 0)) return [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-preview-"));
    try {
      return [0.15, 0.5, 0.85].flatMap((at, index) => {
        const frame = path.join(dir, `${index}.jpg`);
        execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", (duration * at).toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "4", frame], { timeout: 20_000 });
        return fs.existsSync(frame) ? [{ mediaType: "image/jpeg" as const, base64: fs.readFileSync(frame).toString("base64") }] : [];
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return [];
  }
}

/** Keep the file, attach it to the chat, and say where it is (and show it to a vision model). */
async function deliver(ctx: Ctx, bytes: Buffer, filename: string, what: string, seconds: number): Promise<ToolOutcome> {
  const saved = outputPath(ctx.sessionId, filename);
  fs.writeFileSync(saved, bytes);
  const { mimeType, kind } = classify(filename);
  let attached = "";
  if (bytes.length <= 25 * 1024 * 1024) {
    try {
      const owner = await taskOwner(ctx.sessionId);
      const media = await storeMedia({ buffer: bytes, filename, mimeType, kind: "artifact", sessionId: ctx.sessionId, sourcePath: `renders/${filename}`, userId: owner });
      ctx.emit({ type: "artifacts", files: [{ mediaId: media.id, source: "vault", path: `renders/${filename}`, filename: media.filename, mimeType, sizeBytes: bytes.length, kind, primary: true }], auto: false, more: 0, skipped: [] });
      attached = " It is attached to the chat.";
    } catch (error) {
      attached = ` It couldn't be attached to the chat (${error instanceof Error ? error.message : "storage error"}); it is kept on the server.`;
    }
  } else {
    attached = " It is over 25 MB, so it isn't attached to the chat: render it shorter or smaller to share it here.";
  }
  const images = ctx.vision ? previewFrames(saved) : [];
  const shown = images.length ? ` ${images.length === 1 ? "The still is" : `${images.length} frames of it (at 15%, 50% and 85%) are`} below: check them before you call it done.` : "";
  return { ok: true, content: `Rendered ${what} in ${seconds} s: ${saved} (${(bytes.length / 1024 / 1024).toFixed(2)} MB).${attached}${shown}`, summary: `${filename} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`, ...(images.length ? { images } : {}) };
}

async function render(ctx: Ctx, job: Omit<RenderJob, "taskId" | "signal" | "onOutput">, filename: string, what: string, sandbox?: RenderJob["sandbox"]): Promise<ToolOutcome> {
  const owner = await taskOwner(ctx.sessionId);
  if (owner && rateLimited(`studio:${owner}`, 30)) return { ok: false, content: "Too many renders in the last 10 minutes: wait a few minutes before the next one.", summary: "Render limit" };
  const log = (stream: "stdout" | "stderr", chunk: string) => ctx.emit({ type: "tool_output", callId: ctx.callId, stream, chunk });
  try {
    const result = await renderInStudio({ ...job, taskId: ctx.sessionId, signal: ctx.signal, onOutput: log, ...(sandbox ? { sandbox } : {}) });
    return await deliver(ctx, result.bytes, filename, what, result.seconds);
  } catch (error) {
    if (error instanceof RenderError) {
      const output = (error as RenderError & { log?: string }).log ?? "";
      return { ok: false, content: `${error.message}\n${digestOutput(output, { head: 10, tail: 40, maxChars: 8000, rest: "Fix the cause and render again." })}`, summary: error.message };
    }
    throw error;
  }
}

const stamp = () => Date.now().toString(36);

/** A folder (or a file's folder) of the workspace, and the path inside it. */
function within(ctx: Ctx, requested: string) {
  const { absolute, relative } = resolveInWorkspace(ctx.root, requested);
  if (!fs.existsSync(absolute)) throw new Error(`${relative} doesn't exist in the workspace.`);
  return { absolute, relative };
}

/** One of the studio tools. sandbox: tests. */
export async function runStudioTool(name: StudioToolName, input: any, ctx: Ctx, sandbox?: RenderJob["sandbox"]): Promise<ToolOutcome> {
  switch (name) {
    case "load_skill": {
      const { name: skill, file } = input as z.infer<typeof STUDIO_SCHEMAS.load_skill>;
      const loaded = readSkill(skill, file);
      markLoaded(ctx.sessionId, skill);
      const others = loaded.file === "SKILL.md" && loaded.others.length ? `\n\n---\nOther files of this skill (load_skill with file): ${loaded.others.slice(0, 80).join(", ")}` : "";
      return { ok: true, content: `# Skill ${skill}${loaded.file === "SKILL.md" ? "" : ` · ${loaded.file}`}\n\n${loaded.text}${loaded.truncated ? "\n\n[cut at 40,000 characters]" : ""}${others}`, summary: `Loaded ${skill}${loaded.file === "SKILL.md" ? "" : `/${loaded.file}`}` };
    }
    case "create_remotion_project": {
      const { name: project, composition_id: id, width, height, fps, duration_seconds: duration } = input as z.infer<typeof STUDIO_SCHEMAS.create_remotion_project>;
      const { absolute, relative } = resolveInWorkspace(ctx.root, `animations/${project}`);
      if (fs.existsSync(absolute)) return { ok: false, content: `${relative} already exists: edit it, or choose another name.`, summary: "Already exists" };
      const sample = path.join(STUDIO_DIR, "remotion-sample");
      fs.mkdirSync(path.join(absolute, "src"), { recursive: true });
      const pkg = JSON.parse(fs.readFileSync(path.join(sample, "package.json"), "utf8"));
      fs.writeFileSync(path.join(absolute, "package.json"), `${JSON.stringify({ ...pkg, name: project }, null, 2)}\n`);
      for (const file of ["remotion.config.ts", "tsconfig.json", "src/index.ts"]) fs.copyFileSync(path.join(sample, file), path.join(absolute, file));
      fs.writeFileSync(path.join(absolute, "src", "Root.tsx"), REMOTION_ROOT(id, { width, height, fps, frames: Math.round(duration * fps) }));
      fs.writeFileSync(path.join(absolute, "src", "Main.tsx"), REMOTION_MAIN);
      for (const file of ["package.json", "remotion.config.ts", "tsconfig.json", "src/index.ts", "src/Root.tsx", "src/Main.tsx"]) wrote(ctx, `${relative}/${file}`, null, fs.readFileSync(path.join(absolute, file), "utf8"));
      const create = readSkill("remotion-create");
      markLoaded(ctx.sessionId, "remotion-best-practices", "remotion-create");
      return {
        ok: true,
        content: `Created ${relative}/ (Remotion 4.0.543): composition "${id}" ${width}x${height} at ${fps} fps, ${duration} s, in src/Root.tsx; its component in src/Main.tsx. Dependencies are preinstalled where it renders (no npm install needed to render).\nNext: load_skill("remotion-markup") before writing the markup, then render_remotion({ project_path: "${relative}" }) (a draft first).\n\n# Skill remotion-create (loaded)\n\n${create.text}`,
        summary: `Created ${relative}`,
      };
    }
    case "render_remotion": {
      const { project_path: requested, composition, format, frame, frames, scale, props, output_name: outName } = input as z.infer<typeof STUDIO_SCHEMAS.render_remotion>;
      if (!hasLoaded(ctx.sessionId, skill => skill.startsWith("remotion-"))) return { ok: false, content: 'Load a Remotion skill first: load_skill({ name: "remotion-render" }) (and remotion-markup when you wrote the markup). Then render again.', summary: "Load the skill first" };
      const { absolute, relative } = within(ctx, requested);
      const files = collectProject(absolute);
      const entry = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx"].find(file => files.some(item => item.path === file));
      if (!entry) return { ok: false, content: `${relative} has no src/index.ts (registerRoot): render a Remotion project folder.`, summary: "No Remotion entry" };
      let id = composition;
      if (!id) {
        const ids = [...new Set(files.filter(file => /\.(tsx|jsx|ts|js)$/.test(file.path)).flatMap(file => [...file.data.toString("utf8").matchAll(/<(?:Composition|Still)[\s\S]*?\bid=["']([^"']+)["']/g)].map(match => match[1])))];
        if (ids.length !== 1) return { ok: false, content: ids.length ? `${relative} has several compositions (${ids.join(", ")}): pass composition.` : `No composition id found in ${relative}: pass composition.`, summary: "Which composition?" };
        id = ids[0];
      }
      if (!/^[A-Za-z0-9-]+$/.test(id)) return { ok: false, content: "A composition id has letters, digits and - only.", summary: "Invalid composition" };
      const filename = `${outName ?? `${path.basename(relative)}-${id}`.toLowerCase()}-${stamp()}.${ext(format)}`;
      const out = `/home/user/out/${filename}`;
      if (props) files.push({ path: ".curialy-props.json", data: Buffer.from(JSON.stringify(props)) });
      const draft = scale !== undefined && scale < 1 || frames !== undefined;
      const flags = [
        format === "png" ? `--frame=${frame ?? 0}` : `--codec=${format === "mp4" ? "h264" : format === "webm" ? "vp8" : "gif"}`,
        ...(frames && format !== "png" ? [`--frames=${frames}`] : []),
        ...(scale ? [`--scale=${scale}`] : []),
        ...(props ? ["--props=./.curialy-props.json"] : []),
        ...(draft && process.env.REMOTION_LICENSE_KEY ? ["--is-production=false"] : []),
      ];
      const command = format === "png"
        ? `ln -sfn /opt/studio/node_modules node_modules && mkdir -p /home/user/out && npx --no-install remotion still ${entry} ${id} ${out} ${flags.join(" ")}`
        : `/opt/studio/bin/render-remotion.sh /home/user/job ${entry} ${id} ${out} ${flags.join(" ")}`;
      return render(ctx, { files, command, output: out, timeoutMs: 10 * 60_000 }, filename, `${relative} (${id}, ${format}${draft ? ", draft" : ""})`, sandbox);
    }
    case "generate_manim_scene": {
      const { name: project, scene, code } = input as z.infer<typeof STUDIO_SCHEMAS.generate_manim_scene>;
      if (code && (!/from manim import|import manim/.test(code) || !new RegExp(`class\\s+${scene}\\s*\\(`).test(code))) return { ok: false, content: `The code must import manim and define class ${scene}(Scene).`, summary: "Invalid scene" };
      const { absolute, relative } = resolveInWorkspace(ctx.root, `animations/${project}/scene.py`);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const before = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
      const after = code ?? MANIM_STARTER(scene);
      fs.writeFileSync(absolute, after);
      wrote(ctx, relative, before, after);
      markLoaded(ctx.sessionId, "manim");
      return { ok: true, content: `Wrote ${relative} (scene ${scene}). Render it with render_manim({ file: "${relative}", scene: "${scene}" }).\n\n# Skill manim (loaded)\n\n${readSkill("manim").text}`, summary: `Wrote ${relative}` };
    }
    case "render_manim": {
      const { file, scene, quality, format, output_name: outName } = input as z.infer<typeof STUDIO_SCHEMAS.render_manim>;
      if (!hasLoaded(ctx.sessionId, skill => skill === "manim")) return { ok: false, content: 'Load the Manim skill first: load_skill({ name: "manim" }). Then render again.', summary: "Load the skill first" };
      const { absolute, relative } = within(ctx, file);
      if (!relative.endsWith(".py")) return { ok: false, content: "Pass the scene's .py file.", summary: "Not a .py file" };
      const files = collectProject(path.dirname(absolute));
      const filename = `${outName ?? `${path.basename(path.dirname(relative))}-${scene}`.toLowerCase()}-${stamp()}.${format}`;
      const out = `/home/user/out/${filename}`;
      return render(ctx, { files, command: `/opt/studio/bin/render-manim.sh /home/user/job ${path.basename(relative)} ${scene} ${out} ${quality[0]} ${format}`, output: out, timeoutMs: 10 * 60_000 }, filename, `${relative} (${scene}, ${quality}, ${format})`, sandbox);
    }
    case "create_web_animation": {
      const { name: project, library, width, height, fps, duration_seconds: duration } = input as z.infer<typeof STUDIO_SCHEMAS.create_web_animation>;
      const { absolute, relative } = resolveInWorkspace(ctx.root, `animations/${project}/index.html`);
      if (fs.existsSync(absolute)) return { ok: false, content: `${relative} already exists: edit it, or choose another name.`, summary: "Already exists" };
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const html = webTemplate(library, { width, height, fps, duration });
      fs.writeFileSync(absolute, html);
      wrote(ctx, relative, null, html);
      const skill = library === "canvas" ? "curialy-studio" : library;
      markLoaded(ctx.sessionId, skill);
      return { ok: true, content: `Created ${relative} from the ${library} skill's working example (${width}x${height}, ${fps} fps, ${duration} s). Change the scene in setup() and the seek function, then render_web_animation({ path: "${relative}" }).\n\n# Skill ${skill} (loaded)\n\n${readSkill(skill).text}`, summary: `Created ${relative}` };
    }
    case "render_web_animation": {
      const { path: page, format, at, fps, duration_seconds: duration, output_name: outName } = input as z.infer<typeof STUDIO_SCHEMAS.render_web_animation>;
      const { absolute, relative } = within(ctx, page);
      if (!/\.html?$/i.test(relative)) return { ok: false, content: "Pass the animation's .html page.", summary: "Not a page" };
      const html = fs.readFileSync(absolute, "utf8");
      if (!/defineAnimation\s*\(/.test(html)) return { ok: false, content: `${relative} doesn't call defineAnimation() from /studio/web.js, so it can't be rendered frame by frame: see the curialy-studio skill.`, summary: "No defineAnimation" };
      const needed = PAGE_LIBRARIES.filter(([pattern]) => pattern.test(html)).map(([, skill]) => skill);
      const missing = needed.filter(skill => !loadedSkills(ctx.sessionId).includes(skill));
      if (missing.length || (!needed.length && !hasLoaded(ctx.sessionId, skill => skill === "curialy-studio"))) {
        const list = missing.length ? missing : ["curialy-studio"];
        return { ok: false, content: `Load the skill${list.length > 1 ? "s" : ""} for this page first: ${list.map(skill => `load_skill({ name: "${skill}" })`).join(", ")}. Then render again.`, summary: "Load the skill first" };
      }
      const dir = path.dirname(absolute);
      const files = collectProject(dir);
      const filename = `${outName ?? path.basename(path.dirname(relative))}-${stamp()}.${ext(format)}`.toLowerCase();
      const out = `/home/user/out/${filename}`;
      const flags = [`--format ${format}`, ...(at !== undefined ? [`--at ${at}`] : []), ...(fps ? [`--fps ${fps}`] : []), ...(duration ? [`--duration ${duration}`] : [])];
      return render(ctx, { files, command: `node /opt/studio/bin/render-web.mjs /home/user/job ${JSON.stringify(path.relative(dir, absolute))} ${out} ${flags.join(" ")}`, output: out, timeoutMs: 10 * 60_000 }, filename, `${relative} (${format})`, sandbox);
    }
  }
}

export { MAX_OUTPUT_BYTES };
