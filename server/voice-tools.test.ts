import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The agent's voice tools: a free account's task never reaches the expressive voice, every use is
// charged to the task, and files land (and are attached) where the agent asked.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-voice-tools-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";

const voice = vi.hoisted(() => ({
  transcribe: vi.fn(async () => ({ text: "We ship on Friday.", seconds: 90, language: "en", byParagraph: "Speaker 0: We ship on Friday." })),
  speakStandard: vi.fn(async (text: string) => ({ audio: Buffer.alloc(32_000, 1), mimeType: "audio/mpeg" as const, characters: text.length, engine: "standard" as const })),
  speakExpressive: vi.fn(async (text: string) => ({ audio: Buffer.alloc(16_000, 2), mimeType: "audio/mpeg" as const, characters: text.length, engine: "studio" as const })),
}));
vi.mock("./voice/engines", async importOriginal => ({ ...(await importOriginal<typeof import("./voice/engines")>()), ...voice, voiceConfigured: () => true, studioConfigured: () => true }));
const stored = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("./agent/artifacts", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/artifacts")>()),
  storeArtifacts: vi.fn(async (_session: string, _root: string, files: string[]) => {
    stored.calls.push(files);
    return { stored: files.map(file => ({ mediaId: "m1", source: "vault", path: file, filename: path.basename(file), mimeType: "audio/mpeg", sizeBytes: 1, kind: "audio", primary: true })), skipped: [] };
  }),
}));

const { executeTool, toolsFor } = await import("./agent/tools");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let root = "";
const charges: [number, string][] = [];
const ctx = (operator: boolean) => ({
  root, sessionId: "00000000-0000-4000-8000-0000000000aa", vision: false, callId: "c1", signal: new AbortController().signal,
  emit: () => undefined, onPlan: () => undefined, onFileChange: () => undefined, onCommand: () => undefined, operator,
  charge: (credits: number, detail: string) => { charges.push([credits, detail]); },
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmp, "ws-"));
  charges.length = 0;
  stored.calls.length = 0;
  for (const fn of Object.values(voice)) fn.mockClear();
});

describe("voice tools", () => {
  it("are offered to coding runs when voice is set up", () => {
    const names = toolsFor({ coding: true, web: false, eager: false, operator: false }).map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["transcribe_audio", "generate_speech"]));
  });

  it("transcribes a workspace recording, charges its minutes, and can save the transcript", async () => {
    fs.mkdirSync(path.join(root, "attachments"));
    fs.writeFileSync(path.join(root, "attachments/standup.mp3"), Buffer.alloc(2048, 3));
    const outcome = await executeTool("transcribe_audio", { path: "attachments/standup.mp3", speakers: true, output_path: "notes/standup.txt" }, ctx(false));
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain("Speaker 0: We ship on Friday.");
    expect(fs.readFileSync(path.join(root, "notes/standup.txt"), "utf8")).toBe("Speaker 0: We ship on Friday.\n");
    expect(voice.transcribe).toHaveBeenCalledWith(expect.any(Buffer), "audio/mpeg", expect.objectContaining({ speakers: true }));
    expect(charges).toEqual([[0.15, "transcribed attachments/standup.mp3 (90 s)"]]);
  });

  it("explains a recording it can't read here instead of failing silently", async () => {
    const outcome = await executeTool("transcribe_audio", { path: "missing.wav" }, ctx(false));
    expect(outcome).toMatchObject({ ok: false, summary: "Not found" });
    expect(charges).toEqual([]);
  });

  it("refuses a transcription the account can't cover at worst case, before anything is sent", async () => {
    fs.writeFileSync(path.join(root, "long.ogg"), Buffer.alloc(4096, 1));
    const asks: number[] = [];
    const outcome = await executeTool("transcribe_audio", { path: "long.ogg" }, { ...ctx(false), canSpend: async (credits: number) => { asks.push(credits); return false; } });
    expect(outcome).toMatchObject({ ok: false, summary: "Not enough credits" });
    expect(asks).toEqual([0.01]);
    expect(voice.transcribe).not.toHaveBeenCalled();
    expect(charges).toEqual([]);
  });

  it("refuses a script that is only delivery cues", async () => {
    const outcome = await executeTool("generate_speech", { text: "[laughs] [sighs]", path: "cues.mp3" }, ctx(true));
    expect(outcome).toMatchObject({ ok: false, summary: "Nothing to say" });
    expect(voice.speakStandard).not.toHaveBeenCalled();
    expect(charges).toEqual([]);
  });

  it("speaks with the standard voice by default, saves an MP3 and attaches it", async () => {
    const outcome = await executeTool("generate_speech", { text: "Welcome to the app.", path: "public/audio/intro" }, ctx(false));
    expect(outcome.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "public/audio/intro.mp3"))).toBe(true);
    expect(stored.calls).toEqual([["public/audio/intro.mp3"]]);
    expect(voice.speakExpressive).not.toHaveBeenCalled();
    expect(charges).toEqual([[0.01, "speech: 19 characters"]]);
  });

  it("never gives a free account's task the expressive voice, and drops the acting cues for the standard one", async () => {
    const outcome = await executeTool("generate_speech", { text: "[whispers] Keep it down. [laughs]", path: "a.mp3", style: "expressive" }, ctx(false));
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toContain("operator's account only");
    expect(voice.speakExpressive).not.toHaveBeenCalled();
    expect(voice.speakStandard).toHaveBeenCalledWith("Keep it down.", "thalia", expect.anything());
  });

  it("uses the expressive voice for the operator when asked, and the standard voice once its budget is spent", async () => {
    const acted = await executeTool("generate_speech", { text: "[excited] We did it!", path: "win.mp3", style: "expressive", voice: "apollo" }, ctx(true));
    expect(acted.summary).toMatch(/^Expressive speech/);
    expect(voice.speakExpressive).toHaveBeenCalledWith("[excited] We did it!", "apollo", expect.anything());
    expect(charges.at(-1)?.[1]).toContain("(expressive)");

    const { VoiceError } = await import("./voice/engines");
    voice.speakExpressive.mockRejectedValueOnce(new VoiceError("budget", 409, "studio_budget"));
    const fallback = await executeTool("generate_speech", { text: "[sighs] Again.", path: "again.mp3", style: "expressive" }, ctx(true));
    expect(fallback.ok).toBe(true);
    expect(fallback.content).toContain("budget for this month is used up");
    expect(voice.speakStandard).toHaveBeenLastCalledWith("Again.", "thalia", expect.anything());
  });

  it("refuses expressive scripts over the per-call limit, and paths outside the workspace", async () => {
    const long = await executeTool("generate_speech", { text: "x".repeat(2600), path: "long.mp3", style: "expressive" }, ctx(true));
    expect(long).toMatchObject({ ok: false, summary: "Too long" });
    const escape = await executeTool("generate_speech", { text: "Hi.", path: "../../etc/evil.mp3" }, ctx(true));
    expect(escape.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, "etc"))).toBe(false);
  });
});
