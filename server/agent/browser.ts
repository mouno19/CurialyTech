import { chromium, type Browser, type Page } from "playwright-core";
import type { Emit } from "./bus";
import { PROVIDER_ENV } from "./providers";

// Cloud browser via Browserbase: a remote Chromium driven over CDP. Nothing renders on the VPS
// (this process only holds a WebSocket), and because the browser is remote it cannot reach the
// VPS's loopback services.
//
// Each agent task gets one live session that persists across tool calls, so the user can watch
// it through Browserbase's embeddable live view. It is released when the run ends, when the agent
// closes it, or after IDLE_MS without activity.

const IDLE_MS = 3 * 60_000;
const SESSION_TIMEOUT_S = 15 * 60;

export type BrowseResult = {
  finalUrl: string;
  status: number | null;
  title: string;
  text: string;
  screenshot: Buffer | null;
  consoleErrors: string[];
  sessionId: string;
  replayUrl: string;
};

const bb = (path: string, init: RequestInit = {}) => fetch(`https://api.browserbase.com/v1${path}`, {
  ...init,
  headers: { "X-BB-API-Key": PROVIDER_ENV.browserbaseKey, "content-type": "application/json", ...(init.headers ?? {}) },
});

export const browserConfigured = () => Boolean(PROVIDER_ENV.browserbaseKey && PROVIDER_ENV.browserbaseProject);
export const replayUrl = (sessionId: string) => `https://www.browserbase.com/sessions/${sessionId}`;

async function createSession(signal?: AbortSignal) {
  if (!browserConfigured()) throw new Error("Browserbase is not configured (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID).");
  const response = await bb("/sessions", { method: "POST", body: JSON.stringify({ projectId: PROVIDER_ENV.browserbaseProject, keepAlive: false, timeout: SESSION_TIMEOUT_S }), signal });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.connectUrl) throw new Error(`Browserbase session failed (${response.status}): ${data?.message ?? data?.error ?? "no connectUrl"}`);
  return { id: data.id as string, connectUrl: data.connectUrl as string };
}

/** Embeddable live view (DevTools screencast). The dashboard /sessions/{id} page needs a Browserbase login. */
async function liveViewUrl(sessionId: string) {
  const response = await bb(`/sessions/${sessionId}/debug`);
  const data: any = await response.json().catch(() => null);
  return (data?.debuggerFullscreenUrl as string | undefined) ?? null;
}

async function release(sessionId: string) {
  await bb(`/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ projectId: PROVIDER_ENV.browserbaseProject, status: "REQUEST_RELEASE" }) }).catch(() => undefined);
}

function watchConsole(page: Page, sink: string[]) {
  page.on("console", message => { if (message.type() === "error" && sink.length < 30) sink.push(message.text().slice(0, 300)); });
  page.on("pageerror", error => { if (sink.length < 30) sink.push(`pageerror: ${error.message.slice(0, 300)}`); });
}

class LiveSession {
  readonly consoleErrors: string[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  closed = false;

  constructor(readonly taskId: string, readonly sessionId: string, readonly browser: Browser, readonly page: Page, readonly liveUrl: string | null, private emit: Emit, private onClose: () => void) {
    watchConsole(page, this.consoleErrors);
    browser.on("disconnected", () => void this.close("disconnected"));
    this.touch();
  }

  touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close("idle"), IDLE_MS);
    this.idleTimer.unref();
  }

  /** Report an action to the UI (status line in the live view and the activity log). */
  action(action: string, detail: string) {
    this.touch();
    this.emit({ type: "browser_action", sessionId: this.sessionId, action, detail, url: this.page.url(), title: "" });
  }

  async close(reason: "done" | "agent" | "idle" | "disconnected" | "cancelled") {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.onClose();
    await this.browser.close().catch(() => undefined);
    await release(this.sessionId);
    this.emit({ type: "browser_session", sessionId: this.sessionId, status: "ended", liveUrl: null, replayUrl: replayUrl(this.sessionId), reason });
  }
}

const sessions = new Map<string, LiveSession>();
const opening = new Map<string, Promise<LiveSession>>();

/** The task's live browser, created (and announced to the UI) on first use. */
export function liveBrowser(taskId: string, emit: Emit, signal?: AbortSignal): Promise<LiveSession> {
  const existing = sessions.get(taskId);
  if (existing && !existing.closed) {
    existing.touch();
    return Promise.resolve(existing);
  }
  const pending = opening.get(taskId);
  if (pending) return pending;
  const promise = (async () => {
    const session = await createSession(signal);
    let browser: Browser | null = null;
    try {
      browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      await page.setViewportSize({ width: 1280, height: 800 });
      const liveUrl = await liveViewUrl(session.id).catch(() => null);
      const live = new LiveSession(taskId, session.id, browser, page, liveUrl, emit, () => sessions.delete(taskId));
      sessions.set(taskId, live);
      emit({ type: "browser_session", sessionId: session.id, status: "live", liveUrl, replayUrl: replayUrl(session.id) });
      return live;
    } catch (error) {
      await browser?.close().catch(() => undefined);
      await release(session.id);
      throw error;
    }
  })().finally(() => opening.delete(taskId));
  opening.set(taskId, promise);
  return promise;
}

export async function closeLiveBrowser(taskId: string, reason: "done" | "agent" | "cancelled" = "done") {
  await sessions.get(taskId)?.close(reason);
}

export async function snapshot(live: LiveSession, opts: { screenshot: boolean; fullPage: boolean; status?: number | null }): Promise<BrowseResult> {
  const { page } = live;
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const screenshot = opts.screenshot ? await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage, timeout: 30_000 }) : null;
  return { finalUrl: page.url(), status: opts.status ?? null, title, text, screenshot, consoleErrors: live.consoleErrors.splice(0, live.consoleErrors.length), sessionId: live.sessionId, replayUrl: replayUrl(live.sessionId) };
}

/** Navigate the task's live browser. */
export async function navigate(live: LiveSession, url: string, waitMs: number) {
  live.action("navigate", `Opening ${url}`);
  const response = await live.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await live.page.waitForLoadState("networkidle", { timeout: Math.max(1000, waitMs) }).catch(() => undefined);
  live.action("loaded", `Loaded ${(await live.page.title().catch(() => "")) || live.page.url()}`);
  return response?.status() ?? null;
}

/** One-shot capture outside any task (used by the Preview tab's screenshot button). */
export async function browse(opts: { url: string; screenshot: boolean; fullPage: boolean; waitMs: number; signal: AbortSignal }): Promise<BrowseResult> {
  const session = await createSession(opts.signal);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const abort = () => void browser.close().catch(() => undefined);
  opts.signal.addEventListener("abort", abort, { once: true });
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1280, height: 800 });
    const consoleErrors: string[] = [];
    watchConsole(page, consoleErrors);
    const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: Math.max(1000, opts.waitMs) }).catch(() => undefined);
    const title = await page.title().catch(() => "");
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const screenshot = opts.screenshot ? await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage }) : null;
    return { finalUrl: page.url(), status: response?.status() ?? null, title, text, screenshot, consoleErrors, sessionId: session.id, replayUrl: replayUrl(session.id) };
  } finally {
    opts.signal.removeEventListener("abort", abort);
    await browser.close().catch(() => undefined);
    await release(session.id);
  }
}
