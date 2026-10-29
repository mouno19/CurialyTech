import { chromium, type Browser, type Page } from "playwright-core";
import type { Emit } from "./bus";
import { cleanFacts } from "./design/audit";
import { collectorScript } from "./design/collector";
import type { PageFacts } from "./design/types";
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
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
export const PHONE_VIEWPORT = { width: 390, height: 844 };

export type BrowseResult = {
  finalUrl: string;
  status: number | null;
  title: string;
  text: string;
  screenshot: Buffer | null;
  consoleErrors: string[];
  sessionId: string;
  replayUrl: string;
  /** Height of a page too tall to capture in full: the screenshot shows its first MAX_SHOT_HEIGHT px. */
  clippedFrom?: number;
};

/** The model API refuses images with a side over 8,000 px, and one refusal strips every image from the conversation. */
export const MAX_SHOT_HEIGHT = 7800;

/** Vendor API call with a deadline: a hung request must never hold a run open. */
const bb = (path: string, init: RequestInit = {}) => fetch(`https://api.browserbase.com/v1${path}`, {
  ...init,
  signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  headers: { "X-BB-API-Key": PROVIDER_ENV.browserbaseKey, "content-type": "application/json", ...(init.headers ?? {}) },
});

export const browserConfigured = () => Boolean(PROVIDER_ENV.browserbaseKey && PROVIDER_ENV.browserbaseProject);
export const replayUrl = (sessionId: string) => `https://www.browserbase.com/sessions/${sessionId}`;

async function createSession(signal?: AbortSignal) {
  if (!browserConfigured()) throw new Error("The live browser is not configured on this server.");
  const response = await bb("/sessions", { method: "POST", body: JSON.stringify({ projectId: PROVIDER_ENV.browserbaseProject, keepAlive: false, timeout: SESSION_TIMEOUT_S }), signal });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.connectUrl) throw new Error(`Could not start a live browser session (${response.status}): ${data?.message ?? data?.error ?? "no connection URL"}`);
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

  /** Whether the remote browser is still attached (the live view can only show a connected session). */
  get connected() {
    return !this.closed && this.browser.isConnected();
  }

  async close(reason: BrowserEndReason) {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.onClose();
    // Report the end first: releasing the remote session is housekeeping and must not delay the run.
    this.emit({ type: "browser_session", sessionId: this.sessionId, status: "ended", liveUrl: null, replayUrl: "", reason });
    void Promise.race([this.browser.close(), new Promise(resolve => setTimeout(resolve, 10_000))]).catch(() => undefined).then(() => release(this.sessionId));
  }
}

export type BrowserEndReason = "done" | "agent" | "idle" | "disconnected" | "cancelled" | "interrupted";

const sessions = new Map<string, LiveSession>();
const opening = new Map<string, Promise<LiveSession>>();

/** The task's live browser, created (and announced to the UI) on first use. */
/**
 * interactive: the operator's tasks get the live view (an embeddable, clickable remote browser).
 * Other accounts get none: they see the agent's screenshots, and can't act on websites themselves.
 */
export function liveBrowser(taskId: string, emit: Emit, signal?: AbortSignal, interactive = true): Promise<LiveSession> {
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
      await page.setViewportSize(DESKTOP_VIEWPORT);
      if (signal?.aborted) throw signal.reason ?? new Error("Cancelled");
      const liveUrl = interactive ? await liveViewUrl(session.id).catch(() => null) : null;
      const live = new LiveSession(taskId, session.id, browser, page, liveUrl, emit, () => { if (sessions.get(taskId) === live) sessions.delete(taskId); });
      sessions.set(taskId, live);
      console.log(`[browser] ${taskId} session ${session.id} opened`);
      // The live-view address carries an access token: it is handed out on request (sessionStatus),
      // never stored in the event log.
      emit({ type: "browser_session", sessionId: session.id, status: "live", liveUrl: null, replayUrl: "", viewer: Boolean(liveUrl) });
      // A run cancelled while the session was opening must not leave it running (and billed).
      if (signal?.aborted) await live.close("cancelled");
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

export async function closeLiveBrowser(taskId: string, reason: BrowserEndReason = "done") {
  await sessions.get(taskId)?.close(reason);
}

export type BrowserSessionStatus = { status: "live" | "ended"; viewer: string | null; title: string; url: string };

/**
 * What the UI may show for a session: live (with a fresh viewer address) only while this process
 * holds it and the remote browser is still attached; anything else has ended.
 */
export async function sessionStatus(taskId: string, sessionId: string, fresh = false): Promise<BrowserSessionStatus> {
  const live = sessions.get(taskId);
  if (!live || live.sessionId !== sessionId || !live.connected) return { status: "ended", viewer: null, title: "", url: "" };
  const viewer = fresh ? await liveViewUrl(sessionId).catch(() => live.liveUrl) : live.liveUrl;
  return { status: "live", viewer, title: await live.page.title().catch(() => ""), url: live.page.url() };
}

export async function snapshot(live: LiveSession, opts: { screenshot: boolean; fullPage: boolean; status?: number | null }): Promise<BrowseResult> {
  const { page } = live;
  const title = await page.title().catch(() => "");
  const text = String((await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")) ?? "");
  // Full-page shots are always clipped (Playwright trims the clip to the page): the page's size is the
  // largest of body and documentElement, so a body that scrolls, or a wide marquee track, can't
  // produce an image the model refuses.
  const full = opts.screenshot && opts.fullPage;
  const height = full ? await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return Math.max(doc.scrollHeight, doc.offsetHeight, doc.clientHeight, body?.scrollHeight ?? 0, body?.offsetHeight ?? 0, body?.clientHeight ?? 0);
  }).catch(() => 0) : 0;
  const clip = full ? { x: 0, y: 0, width: page.viewportSize()?.width ?? DESKTOP_VIEWPORT.width, height: MAX_SHOT_HEIGHT } : undefined;
  const screenshot = opts.screenshot ? await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage, timeout: 30_000, ...(clip ? { clip } : {}) }) : null;
  return { finalUrl: page.url(), status: opts.status ?? null, title, text, screenshot, consoleErrors: live.consoleErrors.splice(0, live.consoleErrors.length), sessionId: live.sessionId, replayUrl: replayUrl(live.sessionId), ...(height > MAX_SHOT_HEIGHT ? { clippedFrom: height } : {}) };
}

/** Navigate the task's live browser. */
export async function navigate(live: LiveSession, url: string, waitMs: number) {
  live.action("navigate", `Opening ${url}`);
  const response = await live.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await live.page.waitForLoadState("networkidle", { timeout: Math.max(1000, waitMs) }).catch(() => undefined);
  live.action("loaded", `Loaded ${(await live.page.title().catch(() => "")) || live.page.url()}`);
  return response?.status() ?? null;
}

export type VisualCheck = {
  desktop: BrowseResult;
  /** Top of the page at phone width, with reduced motion on. */
  phoneShot: Buffer | null;
  facts: { desktop: PageFacts | null; phone: PageFacts | null };
  /** Parts of the check that failed (the rest of the result is still valid). */
  problems: string[];
};

/**
 * Fonts loaded, then one pass down the page so lazy content and scroll reveals run, then back up.
 * Scrolls are instant: with scroll-behavior: smooth (common on generated sites) the page would lag.
 * When the document itself doesn't scroll (app shells, snap sections), its largest inner scroller does.
 */
async function settle(page: Page) {
  await inPage(page, async () => {
    await document.fonts?.ready;
    const root = document.scrollingElement ?? document.documentElement;
    let scroller: Element | null = null;
    if (root.scrollHeight <= window.innerHeight + 1 && document.body) {
      let area = 0;
      for (const el of [document.body, ...Array.from(document.body.querySelectorAll("*")).slice(0, 4000)]) {
        if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height > area) { area = rect.width * rect.height; scroller = el; }
      }
    }
    const to = (top: number) => (scroller ? scroller.scrollTo({ top, behavior: "instant" }) : window.scrollTo({ top, behavior: "instant" }));
    const step = Math.max(240, Math.round(window.innerHeight * 0.8));
    for (let y = 0; y < Math.min((scroller ?? root).scrollHeight, 40_000); y += step) {
      to(y);
      await new Promise(resolve => setTimeout(resolve, 160));
    }
    to(0);
    await new Promise(resolve => setTimeout(resolve, 600));
  });
}

/**
 * Runs `fn` in the page from its source text, with a no-op __name: TypeScript runners that keep
 * function names (tsx, which the dev server uses) wrap inner functions in a helper the page lacks.
 */
const inPage = <T,>(page: Page, fn: () => T | Promise<T>) => page.evaluate(`(() => { const __name = (fn) => fn; return (${fn.toString()})(); })()`) as Promise<T>;

/** Settles with `work`, or rejects as soon as the run is cancelled (and never leaves a dangling rejection). */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error("cancelled"));
  let stop = () => undefined as void;
  const aborted = new Promise<never>((_, reject) => { stop = () => reject(new Error("cancelled")); signal.addEventListener("abort", stop, { once: true }); });
  aborted.catch(() => undefined);
  return Promise.race([work, aborted]).finally(() => signal.removeEventListener("abort", stop));
}

/** First line of an error, without URLs (preview URLs carry a signed token). */
const problem = (label: string, error: unknown) => `${label}: ${String((error as Error)?.message ?? error).split("\n")[0].replace(/https?:\/\/\S+/g, "the page").slice(0, 200)}`;

const collect = (page: Page, signal?: AbortSignal): Promise<PageFacts> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("the design checks took too long")), 25_000); });
  // The result comes from the page's own JavaScript: rebuilt and clipped before anything reads it.
  return abortable(Promise.race([page.evaluate(collectorScript()) as Promise<unknown>, timeout]), signal).then(cleanFacts).finally(() => clearTimeout(timer));
};

/**
 * The visual test: the page at desktop size (screenshot, text, console errors) and, with `audit`,
 * design measurements there and again at phone width with reduced motion. The phone pass runs in a
 * tab of its own, so the session's page (shared with the other browser tools and shown in the
 * operator's live view) stays the desktop load. A cancelled run stops between and during steps.
 */
export async function visualCheck(live: LiveSession, url: string, opts: { waitMs: number; fullPage: boolean; audit: boolean; signal?: AbortSignal }): Promise<VisualCheck> {
  const { page } = live;
  const { signal } = opts;
  const problems: string[] = [];
  // Errors from pages opened earlier in the session are not this page's.
  live.consoleErrors.splice(0, live.consoleErrors.length);
  const status = await navigate(live, url, opts.waitMs);
  if (opts.audit && !signal?.aborted) await abortable(settle(page), signal).catch(error => problems.push(problem("scrolling the page", error)));
  live.action("visual-test", "Capturing the page for visual review");
  const desktop = await snapshot(live, { screenshot: true, fullPage: opts.fullPage, status });
  const facts: VisualCheck["facts"] = { desktop: null, phone: null };
  let phoneShot: Buffer | null = null;
  if (!opts.audit || signal?.aborted) return { desktop, phoneShot, facts, problems };
  facts.desktop = await collect(page, signal).catch(error => { problems.push(problem("desktop checks", error)); return null; });
  if (signal?.aborted) return { desktop, phoneShot, facts, problems };
  let phone: Page | null = null;
  const phoneErrors: string[] = [];
  try {
    live.action("visual-test", "Checking the phone layout with reduced motion");
    phone = await page.context().newPage();
    watchConsole(phone, phoneErrors);
    await phone.setViewportSize(PHONE_VIEWPORT);
    await phone.emulateMedia({ reducedMotion: "reduce" });
    await abortable(phone.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }), signal);
    await abortable(phone.waitForLoadState("networkidle", { timeout: Math.max(1000, opts.waitMs) }).catch(() => undefined), signal);
    await abortable(settle(phone), signal);
    phoneShot = await abortable(phone.screenshot({ type: "jpeg", quality: 70, timeout: 30_000 }), signal);
    facts.phone = await collect(phone, signal).catch(error => { problems.push(problem("phone checks", error)); return null; });
  } catch (error) {
    if (!signal?.aborted) problems.push(problem("phone pass", error));
  } finally {
    await phone?.close().catch(() => undefined);
  }
  // Errors the phone load raised that the desktop load did not.
  for (const error of phoneErrors) if (!desktop.consoleErrors.includes(error) && desktop.consoleErrors.length < 30) desktop.consoleErrors.push(`(phone) ${error}`);
  return { desktop, phoneShot, facts, problems };
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
