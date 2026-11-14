import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventBody } from "@shared/agent";

// The Animation Studio tools on a studio folder of their own and a stand-in render sandbox: skills
// load (one of their files too, never a path outside them), every render tool refuses until a
// matching skill was loaded, projects upload without their dependencies, the render command is the
// right one, and the file is kept under output/<task>/ and attached to the chat.

const studio = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-studio-"));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-studio-ws-"));
process.env.STUDIO_DIR = studio;
process.env.E2B_API_KEY = "test";

const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(studio, file)), { recursive: true });
  fs.writeFileSync(path.join(studio, file), text);
};
put("skills/curialy-studio/SKILL.md", "---\nname: curialy-studio\ndescription: How animation works here\nrender: none\n---\n# Studio\nLoad a skill first.");
put("skills/animejs/SKILL.md", "---\nname: animejs\ndescription: Anime.js v4\nrender: web\n---\n# Anime.js\n```html\n<!doctype html><html><body><script type=\"module\">import { defineAnimation } from \"/studio/web.js\"; import { animate } from \"animejs\"; defineAnimation({ width: 1280, height: 720, fps: 30, duration: 4, setup: s => ms => {} });</script></body></html>\n```\n");
put("skills/remotion-render/SKILL.md", "---\nname: remotion-render\ndescription: Export a Remotion video\n---\nRender with npx remotion render.");
put("skills/remotion-render/codecs.md", "# Codecs\nh264 for mp4.");
put("skills/remotion-create/SKILL.md", "---\nname: remotion-create\ndescription: Create a new Remotion video\n---\nScaffold.");
put("skills/manim/SKILL.md", "---\nname: manim\ndescription: Manim CE\nrender: manim\n---\nNo LaTeX here.");
put("secret.md", "outside the skills");
put("remotion-sample/package.json", JSON.stringify({ name: "remotion-sample", dependencies: { remotion: "4.0.543" } }));
put("remotion-sample/remotion.config.ts", "export {};");
put("remotion-sample/tsconfig.json", "{}");
put("remotion-sample/src/index.ts", "import { registerRoot } from \"remotion\";");
put("render/template.json", "{}");
put("render/studio/bin/render-remotion.sh", "#!/bin/sh");
put("render/studio/bin/render-web.mjs", "// web");
put("render/studio/bin/render-manim.sh", "#!/bin/sh");
put("render/studio/web/web.js", "export function defineAnimation() {}");

const state = vi.hoisted(() => ({ stored: [] as { filename: string; size: number }[] }));
vi.mock("./media/snowflake", async importOriginal => ({ ...(await importOriginal<typeof import("./media/snowflake")>()), storeMedia: async (input: { buffer: Buffer; filename: string }) => { state.stored.push({ filename: input.filename, size: input.buffer.length }); return { id: `media-${state.stored.length}`, filename: input.filename }; } }));
vi.mock("./agent/store", () => ({ taskOwner: async () => "user-a" }));
vi.mock("./auth", async importOriginal => ({ ...(await importOriginal<typeof import("./auth")>()), rateLimited: () => false }));

const { resetStudio, skillCatalog, studioAvailable } = await import("./agent/studio");
const { runStudioTool, STUDIO_SCHEMAS, studioContext } = await import("./agent/studio-tools");

afterAll(() => {
  fs.rmSync(studio, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

type Call = { files: { path: string; data: Buffer }[]; command: string };
let calls: Call[] = [];
let exitCode = 0;
const sandbox = async () => {
  const call: Call = { files: [], command: "" };
  calls.push(call);
  return {
    write: async (files: { path: string; data: Buffer }[]) => { call.files.push(...files); },
    run: async (command: string, opts: { onStdout: (data: string) => void }) => { call.command = command; opts.onStdout("frame 1/30\n"); return { exitCode, stdout: "", stderr: exitCode ? "Error: Cannot find module './Missing'\n" : "" }; },
    read: async () => Buffer.from("rendered video bytes"),
    kill: async () => undefined,
  };
};

let events: AgentEventBody[] = [];
const ctx = () => ({ sessionId: "00000000-0000-4000-8000-0000000000aa", root: workspace, callId: "call-1", signal: new AbortController().signal, emit: (body: AgentEventBody) => { events.push(body); }, onFileChange: () => undefined });
const tool = (name: keyof typeof STUDIO_SCHEMAS, input: Record<string, unknown>) => runStudioTool(name, STUDIO_SCHEMAS[name].parse(input), ctx() as never, sandbox);

beforeEach(() => {
  resetStudio();
  calls = [];
  events = [];
  exitCode = 0;
  state.stored = [];
});

describe("skills", () => {
  it("lists the skills (the platform's first) and the rule for the agent", () => {
    expect(studioAvailable()).toBe(true);
    expect(skillCatalog().map(skill => skill.name)).toEqual(["curialy-studio", "animejs", "manim", "remotion-create", "remotion-render"]);
    expect(studioContext()).toMatch(/RULE: before you write, edit, animate or render any animation or video, call load_skill/);
    expect(studioContext()).toContain("animejs (Anime.js v4)");
  });

  it("loads a skill, one of its files, and nothing outside it", async () => {
    const loaded = await tool("load_skill", { name: "remotion-render" });
    expect(loaded.content).toContain("Render with npx remotion render.");
    expect(loaded.content).toContain("Other files of this skill (load_skill with file): codecs.md");
    expect((await tool("load_skill", { name: "remotion-render", file: "codecs.md" })).content).toContain("h264 for mp4.");
    await expect(tool("load_skill", { name: "remotion-render", file: "../../secret.md" })).rejects.toThrow(/isn't a file of the remotion-render skill/);
    await expect(tool("load_skill", { name: "nope" })).rejects.toThrow(/No skill named "nope"/);
  });
});

describe("web animations", () => {
  it("scaffold from the skill's example (with the size asked for) and load the skill", async () => {
    const created = await tool("create_web_animation", { name: "dots", library: "animejs", width: 1080, height: 1080, fps: 24, duration_seconds: 3 });
    expect(created.ok).toBe(true);
    const html = fs.readFileSync(path.join(workspace, "animations/dots/index.html"), "utf8");
    expect(html).toContain("width: 1080, height: 1080, fps: 24, duration: 3");
    expect(events.find(event => event.type === "file_change")).toMatchObject({ path: "animations/dots/index.html", kind: "create" });
  });

  it("render only once the page's library skill is loaded, without the project's dependencies, then keep and attach the file", async () => {
    fs.mkdirSync(path.join(workspace, "animations/logo/node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "animations/logo/node_modules/x/index.js"), "dependency");
    fs.writeFileSync(path.join(workspace, "animations/logo/index.html"), '<script type="module">import { defineAnimation } from "/studio/web.js"; import { animate } from "animejs"; defineAnimation({ setup: s => ms => {} });</script>');
    fs.writeFileSync(path.join(workspace, "animations/logo/logo.svg"), "<svg/>");
    const refused = await tool("render_web_animation", { path: "animations/logo/index.html" });
    expect(refused).toMatchObject({ ok: false, summary: "Load the skill first" });
    expect(refused.content).toContain('load_skill({ name: "animejs" })');
    expect(calls).toEqual([]);
    await tool("load_skill", { name: "animejs" });
    const rendered = await tool("render_web_animation", { path: "animations/logo/index.html", format: "gif" });
    expect(rendered.ok).toBe(true);
    const call = calls[0];
    expect(call.command).toMatch(/node \/opt\/studio\/bin\/render-web\.mjs \/home\/user\/job "index\.html" \/home\/user\/out\/logo-\w+\.gif --format gif$/);
    expect(call.files.map(file => file.path)).toEqual(expect.arrayContaining(["/home/user/job/index.html", "/home/user/job/logo.svg", "/opt/studio/bin/render-web.mjs", "/opt/studio/web/web.js"]));
    expect(call.files.some(file => file.path.includes("node_modules"))).toBe(false);
    const saved = /: (\/\S+\.gif) \(/.exec(rendered.content)![1];
    expect(saved.startsWith(path.join(studio, "output", "00000000-0000-4000-8000-0000000000aa"))).toBe(true);
    expect(fs.readFileSync(saved, "utf8")).toBe("rendered video bytes");
    expect(state.stored).toEqual([{ filename: path.basename(saved), size: 20 }]);
    expect(events.find(event => event.type === "artifacts")).toMatchObject({ files: [{ mediaId: "media-1", kind: "image", mimeType: "image/gif" }] });
    expect(events.some(event => event.type === "tool_output" && event.chunk === "frame 1/30\n")).toBe(true);
  });

  it("report a failed render with what its log says", async () => {
    fs.mkdirSync(path.join(workspace, "animations/broken"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "animations/broken/index.html"), '<script type="module">import { defineAnimation } from "/studio/web.js"; defineAnimation({});</script>');
    await tool("load_skill", { name: "curialy-studio" });
    exitCode = 1;
    const failed = await tool("render_web_animation", { path: "animations/broken/index.html" });
    expect(failed).toMatchObject({ ok: false, summary: "The render failed (exit 1)." });
    expect(fs.existsSync(path.join(studio, "output", "00000000-0000-4000-8000-0000000000aa", "broken"))).toBe(false);
  });
});

describe("Remotion", () => {
  it("scaffolds a project, loads the create skill, and renders its composition (or a still)", async () => {
    const created = await tool("create_remotion_project", { name: "intro", composition_id: "Launch", width: 1080, height: 1920, fps: 30, duration_seconds: 4 });
    expect(created.content).toContain("# Skill remotion-create (loaded)");
    const root = fs.readFileSync(path.join(workspace, "animations/intro/src/Root.tsx"), "utf8");
    expect(root).toContain('id="Launch"');
    expect(root).toContain("durationInFrames={120}");
    expect(root).toContain("width={1080}");
    const video = await tool("render_remotion", { project_path: "animations/intro", scale: 0.5 });
    expect(video.ok).toBe(true);
    expect(calls[0].command).toMatch(/\/opt\/studio\/bin\/render-remotion\.sh \/home\/user\/job src\/index\.ts Launch \/home\/user\/out\/intro-launch-\w+\.mp4 --codec=h264 --scale=0\.5$/);
    const still = await tool("render_remotion", { project_path: "animations/intro", format: "png", frame: 45 });
    expect(still.ok).toBe(true);
    expect(calls[1].command).toMatch(/npx --no-install remotion still src\/index\.ts Launch \/home\/user\/out\/intro-launch-\w+\.png --frame=45$/);
  });

  it("asks which composition when there are several, and refuses before a Remotion skill is loaded", async () => {
    fs.mkdirSync(path.join(workspace, "animations/two/src"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "animations/two/src/index.ts"), "registerRoot(Root);");
    fs.writeFileSync(path.join(workspace, "animations/two/src/Root.tsx"), '<Composition id="A" /><Composition id="B" />');
    expect(await tool("render_remotion", { project_path: "animations/two" })).toMatchObject({ ok: false, summary: "Load the skill first" });
    await tool("load_skill", { name: "remotion-render" });
    expect(await tool("render_remotion", { project_path: "animations/two" })).toMatchObject({ ok: false, summary: "Which composition?" });
    expect(calls).toEqual([]);
  });
});

describe("what the model sees of a render", () => {
  it("a still as it is, a video as three frames, nothing for what can't be read", async () => {
    const { previewFrames } = await import("./agent/studio-tools");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-preview-"));
    const video = path.join(dir, "clip.mp4");
    const { execFileSync } = await import("node:child_process");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=2", "-pix_fmt", "yuv420p", video]);
    const frames = previewFrames(video);
    expect(frames).toHaveLength(3);
    expect(frames.every(frame => frame.mediaType === "image/jpeg" && frame.base64.length > 100)).toBe(true);
    const still = path.join(dir, "still.png");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64", "-frames:v", "1", still]);
    expect(previewFrames(still)).toEqual([{ mediaType: "image/png", base64: fs.readFileSync(still).toString("base64") }]);
    fs.writeFileSync(path.join(dir, "broken.mp4"), "not a video");
    expect(previewFrames(path.join(dir, "broken.mp4"))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Manim", () => {
  it("writes a scene (checking the code it is given), loads the skill, and renders it", async () => {
    expect(await tool("generate_manim_scene", { name: "waves", scene: "Waves", code: "print('no manim')" })).toMatchObject({ ok: false });
    expect(await tool("render_manim", { file: "animations/waves/scene.py", scene: "Waves" })).toMatchObject({ ok: false, summary: "Load the skill first" });
    const written = await tool("generate_manim_scene", { name: "waves", scene: "Waves" });
    expect(written.content).toContain("# Skill manim (loaded)");
    const rendered = await tool("render_manim", { file: "animations/waves/scene.py", scene: "Waves", quality: "low", format: "gif" });
    expect(rendered.ok).toBe(true);
    expect(calls[0].command).toMatch(/\/opt\/studio\/bin\/render-manim\.sh \/home\/user\/job scene\.py Waves \/home\/user\/out\/waves-waves-\w+\.gif l gif$/);
  });
});
