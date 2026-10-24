import { chromium } from "playwright-core";
import { PROVIDER_ENV } from "./providers";

// Cloud browser via Browserbase: a remote Chromium session driven over CDP. No browser runs on
// the VPS, and because the browser is remote it cannot reach the VPS's loopback services.

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

async function createSession(signal: AbortSignal) {
  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: { "X-BB-API-Key": PROVIDER_ENV.browserbaseKey, "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROVIDER_ENV.browserbaseProject, timeout: 180 }),
    signal,
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.connectUrl) throw new Error(`Browserbase session failed (${response.status}): ${data?.message ?? data?.error ?? "no connectUrl"}`);
  return { id: data.id as string, connectUrl: data.connectUrl as string };
}

export async function browse(opts: { url: string; screenshot: boolean; fullPage: boolean; waitMs: number; signal: AbortSignal }): Promise<BrowseResult> {
  if (!PROVIDER_ENV.browserbaseKey || !PROVIDER_ENV.browserbaseProject) throw new Error("Browserbase is not configured (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID).");
  const session = await createSession(opts.signal);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  const abort = () => void browser.close().catch(() => undefined);
  opts.signal.addEventListener("abort", abort, { once: true });
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1280, height: 800 });
    const consoleErrors: string[] = [];
    page.on("console", message => { if (message.type() === "error" && consoleErrors.length < 20) consoleErrors.push(message.text().slice(0, 300)); });
    page.on("pageerror", error => { if (consoleErrors.length < 20) consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`); });
    const response = await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: Math.max(1000, opts.waitMs) }).catch(() => undefined);
    const title = await page.title().catch(() => "");
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const screenshot = opts.screenshot ? await page.screenshot({ type: "jpeg", quality: 70, fullPage: opts.fullPage }) : null;
    return {
      finalUrl: page.url(),
      status: response?.status() ?? null,
      title,
      text,
      screenshot,
      consoleErrors,
      sessionId: session.id,
      replayUrl: `https://www.browserbase.com/sessions/${session.id}`,
    };
  } finally {
    opts.signal.removeEventListener("abort", abort);
    await browser.close().catch(() => undefined);
  }
}
