import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageFacts, TextSample } from "./agent/design/types";

// test_preview_visual end to end through the real tool, visual check, audit and report, with a
// fake page standing in for the cloud browser: two screenshots (desktop, phone), the design audit
// in the model's result, and the shared session's viewport and media always restored.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-visual-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0123";

const text = (overrides: Partial<TextSample> = {}): TextSample => ({
  el: "p", tag: "p", chars: 80, size: 16, weight: 400, line: 25.6, tracking: 0, upper: false, family: "Source Serif 4",
  color: [17, 17, 17, 1], bg: [[255, 255, 255]], estimated: false, cpl: 64, heading: false, height: 52, ...overrides,
});
const facts = (width: number, overrides: Partial<PageFacts> = {}): PageFacts => ({
  viewport: { width, height: width === 390 ? 844 : 800 }, scrollWidth: width, scrollHeight: 3000, lang: "en", title: "Lumen", viewportMeta: "width=device-width, initial-scale=1",
  headings: [1, 2], landmarks: { main: 1, header: 1, nav: 1, footer: 1 }, overflow: { px: 0, clipped: 0, offenders: [] },
  text: [text(), text({ el: "p.muted", color: [156, 163, 175, 1] }), text({ el: "h1", tag: "h1", size: 56, weight: 700, heading: true, chars: 20, cpl: null, height: 70 })],
  hidden: { count: 0, chars: 0, samples: [] }, controls: { total: 4, unnamed: [], small: [], under44: 0, checked: 4 }, focus: { checked: 4, missing: [] },
  images: { total: 0, noAlt: [], broken: [], unsized: 0 }, fields: { total: 0, unlabeled: [], smallFont: 0 },
  fonts: { families: [{ name: "Source Serif 4", chars: 180 }], loaded: ["Source Serif 4"] },
  styles: { gradients: 0, violetGradients: 0, gradientText: 0, backdrop: 0, shadows: 0, sameShadow: 0, radii: 1, transitionAll: 0, layoutKeyframes: [], reducedMotionRule: true, eyebrows: 0, emoji: 0, accentWords: 0 },
  animations: { running: 0, infinite: 0, longestMs: 0 }, copy: { lorem: false, buzzwords: [], placeholders: [] }, perf: { lcpMs: 500, lcpEl: "h1", cls: 0, nodes: 300 }, errors: [], ...overrides,
});

const browser = vi.hoisted(() => ({ page: null as any, live: null as any, failPhone: false, height: 3000, calls: [] as string[], loadError: "" }));
/** A fake page; the phone pass opens a second one through page.context().newPage(). */
function fakePage(name: "desktop" | "phone") {
  let viewport = { width: 1280, height: name === "desktop" ? 800 : 720 };
  const calls = browser.calls;
  const page = {
    goto: vi.fn(async () => {
      if (browser.failPhone && name === "phone") throw new Error("page.goto: net::ERR_ABORTED at https://curialy.tech/api/workspace/preview/task/SECRET-TOKEN/\nCall log: more detail");
      if (browser.loadError && name === "desktop") browser.live.consoleErrors.push(browser.loadError);
      return { status: () => 200 };
    }),
    waitForLoadState: vi.fn(async () => undefined),
    title: vi.fn(async () => "Lumen"),
    url: vi.fn(() => "https://curialy.tech/api/workspace/preview/task/token/"),
    on: vi.fn(),
    close: vi.fn(async () => { calls.push(`${name} closed`); }),
    context: () => ({ newPage: async () => fakePage("phone") }),
    viewportSize: () => viewport,
    setViewportSize: vi.fn(async (size: { width: number; height: number }) => { viewport = size; calls.push(`${name} viewport ${size.width}`); }),
    emulateMedia: vi.fn(async (media: { reducedMotion: string | null }) => { calls.push(`${name} motion ${media.reducedMotion}`); }),
    screenshot: vi.fn(async (opts: Record<string, unknown>) => { calls.push(`${name} shot ${viewport.width}${opts.clip ? ` clip ${(opts.clip as { height: number }).height}` : ""}`); return Buffer.from(`jpeg-${viewport.width}`); }),
    evaluate: vi.fn(async (fn: unknown) => {
      if (typeof fn === "string") return facts(viewport.width);
      const source = String(fn);
      if (source.includes("scrollHeight") && !source.includes("scrollTo")) return browser.height;
      if (source.includes("innerText")) return "Lumen turns support tickets into product insights.";
      return undefined;
    }),
  };
  return page;
}
function fakeLive() {
  const page = fakePage("desktop");
  return { page, consoleErrors: ["stale error from an earlier page"], sessionId: "bb-1", action: vi.fn(), touch: vi.fn() };
}

vi.mock("./agent/browser", async importOriginal => ({
  ...(await importOriginal<typeof import("./agent/browser")>()),
  liveBrowser: vi.fn(async () => browser.live),
}));
const media = vi.hoisted(() => ({ stored: [] as string[] }));
vi.mock("./media/snowflake", async importOriginal => ({
  ...(await importOriginal<typeof import("./media/snowflake")>()),
  assertStorageAvailable: () => undefined,
  storeMedia: vi.fn(async (input: { filename: string }) => { media.stored.push(input.filename); return { id: `m-${media.stored.length}` }; }),
}));

const { executeTool } = await import("./agent/tools");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let root = "";
let events: any[] = [];
const ctx = (overrides: Record<string, unknown> = {}) => ({
  root, sessionId: "00000000-0000-4000-8000-0000000000d1", vision: true, callId: "c1", signal: new AbortController().signal,
  emit: (event: unknown) => events.push(event), onPlan: () => undefined, onFileChange: () => undefined, onCommand: () => undefined,
  design: { surface: "landing" as const, allowed: [] }, ...overrides,
});

beforeEach(() => {
  root = path.join(tmp, "00000000-0000-4000-8000-0000000000d1");
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/index.html"), "<!doctype html><html lang=\"en\"><title>Lumen</title><script src=\"./app.js\"></script></html>");
  events = [];
  media.stored.length = 0;
  browser.failPhone = false;
  browser.height = 3000;
  browser.calls.length = 0;
  browser.loadError = "";
  browser.live = fakeLive();
  browser.page = browser.live.page;
});

describe("test_preview_visual", () => {
  it("returns the desktop and phone screenshots and a design audit, and leaves the shared session's page alone", async () => {
    const outcome = await executeTool("test_preview_visual", {}, ctx());
    expect(outcome.ok).toBe(true);
    expect(outcome.images).toHaveLength(2);
    expect(Buffer.from(outcome.images![1].base64, "base64").toString()).toBe("jpeg-390");
    expect(outcome.content).toContain("Two screenshots are attached: the page at desktop size, then the top of the page at phone width");
    expect(outcome.content).toMatch(/Design audit \(desktop 1280×800, phone 390×844 with reduced motion\): 1 to fix/);
    expect(outcome.content).toContain("p.muted 2.54:1 (#9ca3af on #ffffff, needs 4.5:1)");
    expect(outcome.audit?.findings.map(finding => finding.id)).toContain("contrast");
    // The stale console error from an earlier page is not reported as this page's.
    expect(outcome.content).toContain("No console errors.");
    // The phone pass runs in a tab of its own with reduced motion; the session's page is left as it was.
    expect(browser.calls).toEqual(["desktop shot 1280 clip 7800", "phone viewport 390", "phone motion reduce", "phone shot 390", "phone closed"]);
    expect(media.stored).toEqual(["screenshot.jpg", "screenshot-phone.jpg"]);
    expect(events.filter(event => event.type === "media").map(event => event.caption)).toEqual([expect.stringContaining("Lumen"), expect.stringMatching(/^Phone width · Lumen/)]);
    // The user sees the audit in the tool's output too.
    expect(events.some(event => event.type === "tool_output" && String(event.chunk).startsWith("Design audit"))).toBe(true);
  });

  it("closes the phone tab when the phone pass fails, and still reports the desktop audit", async () => {
    browser.failPhone = true;
    const outcome = await executeTool("test_preview_visual", {}, ctx());
    expect(outcome.ok).toBe(true);
    expect(outcome.images).toHaveLength(1);
    expect(browser.calls.at(-1)).toBe("phone closed");
    expect(browser.calls.filter(call => call.startsWith("desktop"))).toEqual(["desktop shot 1280 clip 7800"]);
    expect(outcome.content).toContain("Design audit");
    expect(outcome.content).toContain("Some checks could not run: phone pass: page.goto: net::ERR_ABORTED at the page");
    expect(outcome.content).not.toContain("SECRET-TOKEN");
  });

  it("captures at most 7,800 px of a very tall page (the model refuses taller images) and says so", async () => {
    browser.height = 12_000;
    const outcome = await executeTool("test_preview_visual", {}, ctx());
    expect(browser.calls[0]).toBe("desktop shot 1280 clip 7800");
    expect(outcome.content).toContain("The page is 12000 px tall; the desktop screenshot shows its first 7800 px.");
  });

  it("never passes on the preview's signed token, even inside console errors", async () => {
    browser.loadError = "Access to font at 'https://curialy.tech/api/workspace/preview/00000000-0000-4000-8000-0000000000d1/tnnlni.SIGNED_abc/assets/x.woff2' from origin 'null' has been blocked by CORS policy";
    const outcome = await executeTool("test_preview_visual", {}, ctx());
    expect(outcome.content).toContain("/api/workspace/preview/00000000-0000-4000-8000-0000000000d1/<token>/assets/x.woff2");
    expect(JSON.stringify([outcome.content, events])).not.toContain("SIGNED_abc");
  });

  it("gives a model without vision the audit as text, and skips the phone pass when the audit is off", async () => {
    const blind = await executeTool("test_preview_visual", {}, ctx({ vision: false }));
    expect(blind.images).toBeUndefined();
    expect(blind.content).toContain("(This model cannot view images; rely on the text, the design audit and console output.)");
    expect(blind.content).toContain("Design audit");

    browser.live = fakeLive();
    browser.page = browser.live.page;
    browser.calls.length = 0;
    const quick = await executeTool("test_preview_visual", { audit: false }, ctx());
    expect(quick.images).toHaveLength(1);
    expect(quick.content).not.toContain("Design audit");
    expect(quick.audit).toBeNull();
    expect(browser.calls).toEqual(["desktop shot 1280 clip 7800"]);
  });

  it("doesn't report the looks the user asked for", async () => {
    browser.page.evaluate.mockImplementation(async (fn: unknown) => (typeof fn === "string" ? facts(1280, { styles: { ...facts(1280).styles, violetGradients: 3 } }) : String(fn).includes("innerText") ? "Lumen" : undefined));
    const plain = await executeTool("test_preview_visual", {}, ctx());
    expect(plain.content).toContain("Purple/indigo gradients on 3 elements");
    browser.live = fakeLive();
    browser.page = browser.live.page;
    browser.page.evaluate.mockImplementation(async (fn: unknown) => (typeof fn === "string" ? facts(1280, { styles: { ...facts(1280).styles, violetGradients: 3 } }) : String(fn).includes("innerText") ? "Lumen" : undefined));
    const asked = await executeTool("test_preview_visual", {}, ctx({ design: { surface: "landing", allowed: ["violet"] } }));
    expect(asked.content).not.toContain("Purple/indigo gradients");
  });
});
