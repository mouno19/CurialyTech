#!/usr/bin/env node
// UI + accessibility check of the BUILT client in one cloud browser session. Every request the page
// makes is answered locally through page.route: the client from dist-next/public, /api/* from
// fixtures.mjs. No real server, no real data. This script never builds anything.
//
// Usage (from /srv/curialyai-next):
//   UI_CHECK_DRY=1 node scripts/ui-check/run.mjs      fixtures, routing, live-stream transport and plan; no browser
//   npm run ui:check                                   needs BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in the env
// Environment (all optional):
//   UI_CHECK_DIST         built client (default <repo>/dist-next/public)
//   UI_CHECK_OUT          screenshots + report.json (default /home/ubuntu/ui-review/new-shots)
//   UI_CHECK_ONLY         regex on "<check id>@<W>x<H>", e.g. "^task-" or "@390x844$"
//   UI_CHECK_VIEWPORTS    "1440x900,390x844" (default 1440x900,1280x720,1024x768,390x844,360x740)
//   UI_CHECK_FONTS        pass (default: Google Fonts load from the network, so text metrics are real) | block
//   UI_CHECK_DEPLOY_URL   vendor (default: deployments carry the host the server stores today) | branded
//   UI_CHECK_MEDIA_LIMIT  most /api/agent/media/ requests one check may make (default 6)
//   UI_CHECK_TABS         Tab presses in the focus check (default 4)
//   UI_CHECK_BB_TIMEOUT   cloud session timeout in seconds (default 1800; the project default if refused)
// Exit code: 0 every check passed · 1 a check failed or the run broke · 2 setup problem · 130 interrupted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtures, ORIGIN, VENDOR_PATTERN } from "./fixtures.mjs";
import { createRouter, FONT_HOSTS } from "./router.mjs";
import { buildPlan, formatSummary, judge, newRecord, noteRequest, serializeRecord, summarize, VIEWPORTS } from "./harness.mjs";
import { heldEventSourceScript, installProbes } from "./probes.mjs";
import { createSession, credentialsFromEnv, makeRedactor, releaseSession } from "./browserbase.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SHOT_NAME = /^\d{2,3}-[a-z0-9-]+-\d{3,4}x\d{3,4}\.png$/;
const CHECK_BUDGET_MS = 75_000;

class SetupError extends Error {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const firstLine = text => String(text ?? "").split("\n").find(line => line.trim())?.trim() ?? "";
const log = message => process.stdout.write(`${message}\n`);

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function readConfig(env = process.env) {
  const viewports = env.UI_CHECK_VIEWPORTS
    ? env.UI_CHECK_VIEWPORTS.split(",").map(item => {
      const match = /^\s*(\d{3,4})x(\d{3,4})\s*$/.exec(item);
      if (!match) throw new SetupError(`UI_CHECK_VIEWPORTS: "${item}" is not WIDTHxHEIGHT.`);
      return { width: Number(match[1]), height: Number(match[2]) };
    })
    : VIEWPORTS;
  let only = null;
  if (env.UI_CHECK_ONLY) {
    try {
      only = new RegExp(env.UI_CHECK_ONLY);
    } catch (error) {
      throw new SetupError(`UI_CHECK_ONLY is not a valid regular expression: ${error.message}`);
    }
  }
  return {
    dry: env.UI_CHECK_DRY === "1",
    repo: REPO,
    dist: path.resolve(env.UI_CHECK_DIST || path.join(REPO, "dist-next/public")),
    out: path.resolve(env.UI_CHECK_OUT || "/home/ubuntu/ui-review/new-shots"),
    only,
    viewports,
    fonts: env.UI_CHECK_FONTS === "block" ? "block" : "pass",
    deployUrls: env.UI_CHECK_DEPLOY_URL === "branded" ? "branded" : "vendor",
    mediaLimit: positive(env.UI_CHECK_MEDIA_LIMIT, 6),
    tabs: positive(env.UI_CHECK_TABS, 4),
    bbTimeout: positive(env.UI_CHECK_BB_TIMEOUT, 1800),
    touchMin: 40,
  };
}

// ---- Wiring one Playwright page to the router ----

function attach(page, router, redact) {
  const state = { record: null, inflight: new Map(), lastActivity: Date.now(), routed: new WeakMap() };
  const settled = request => {
    if (state.inflight.delete(request)) state.lastActivity = Date.now();
  };
  page.on("request", request => {
    if (!state.record || /^(data|blob):/.test(request.url())) return;
    state.inflight.set(request, Date.now());
    state.lastActivity = Date.now();
  });
  page.on("requestfinished", settled);
  page.on("requestfailed", request => {
    settled(request);
    const record = state.record;
    if (!record || state.routed.get(request)?.action === "abort") return; // aborts were judged when routed
    const failure = request.failure()?.errorText ?? "failed";
    if (/ERR_ABORTED/.test(failure)) return; // cancelled by the page itself (navigation, AbortController)
    let host = "";
    try {
      host = new URL(request.url()).hostname;
    } catch {
      host = "";
    }
    if (FONT_HOSTS.has(host)) return void record.fontFailures.push(`${request.url().slice(0, 120)}: ${failure}`); // the network, not the app
    record.network.push({ type: "failed", detail: `${request.method()} ${request.url().slice(0, 200)}: ${failure}`, url: request.url() });
  });
  page.on("console", message => {
    const record = state.record;
    if (record && message.type() === "error") record.console.push({ text: redact(message.text()).slice(0, 500), url: message.location()?.url ?? "" });
  });
  page.on("pageerror", error => state.record?.pageErrors.push(redact(error?.stack || error?.message || String(error)).slice(0, 800)));
  page.on("dialog", dialog => {
    state.record?.dialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 200)}`);
    dialog.dismiss().catch(() => undefined);
  });
  page.on("popup", popup => {
    state.record?.dialogs.push(`popup: ${popup.url().slice(0, 200)}`);
    popup.close().catch(() => undefined);
  });

  const route = async intercepted => {
    const request = intercepted.request();
    let postData = null;
    try {
      postData = request.postData();
    } catch {
      postData = null;
    }
    let reply;
    try {
      reply = router.handle({ method: request.method(), url: request.url(), resourceType: request.resourceType(), postData });
    } catch (error) {
      reply = { action: "fulfill", status: 500, headers: { "content-type": "text/plain; charset=utf-8" }, body: Buffer.from("ui-check router error"), kind: "router-error", expected: false };
      if (state.record) state.record.error = `router error for ${request.url().slice(0, 160)}: ${firstLine(error?.message)}`;
    }
    state.routed.set(request, reply);
    try {
      if (state.record) noteRequest(state.record, { method: request.method(), url: request.url(), resourceType: request.resourceType(), reply });
    } catch {
      /* bookkeeping must never stop the response */
    }
    try {
      if (reply.action === "continue") await intercepted.continue();
      else if (reply.action === "abort") await intercepted.abort(reply.errorCode ?? "blockedbyclient");
      else await intercepted.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
    } catch {
      /* the page navigated away or closed */
    }
  };

  // Quiet = nothing in flight (a request that never reports back stops counting after 5 s) for quietMs.
  const quiet = async (quietMs, deadline) => {
    while (Date.now() < deadline) {
      const now = Date.now();
      const busy = [...state.inflight.values()].some(started => now - started < 5000);
      if (!busy && now - state.lastActivity >= quietMs) return true;
      await sleep(50);
    }
    return false;
  };
  return { state, route, quiet };
}

// ---- One check ----

async function settle(page, driver, check, record, { quietMs = 400, budgetMs = 12_000, first = true } = {}) {
  const deadline = Date.now() + budgetMs;
  if (first) {
    const ready = check.signedOut ? "main.login, form" : "#main";
    await page.waitForSelector(ready, { state: "attached", timeout: Math.max(500, deadline - Date.now()) }).catch(() => record.ready.push(`"${ready}" did not appear`));
    if (check.live) {
      await page.waitForFunction(() => {
        const sse = window.__uiCheckSse;
        return Boolean(sse && sse.opened > 0 && sse.pending === 0);
      }, null, { timeout: Math.max(500, Math.min(8000, deadline - Date.now())), polling: 100 }).catch(() => record.ready.push("the live stream did not finish delivering its events"));
    }
  }
  if (!(await driver.quiet(quietMs, deadline))) record.ready.push(`the network was not quiet within ${budgetMs} ms`);
  await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, wait(2000)]);
    const finite = document.getAnimations().filter(animation => animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming?.().endTime));
    await Promise.race([Promise.allSettled(finite.map(animation => animation.finished)), wait(800)]);
  }).catch(() => undefined);
  await sleep(200);
}

async function act(page, check, record) {
  try {
    if (check.action === "model-menu") {
      await page.getByRole("button", { name: /^Model:/ }).first().click({ timeout: 6000 });
      await page.locator("[role=\"menu\"]").first().waitFor({ state: "visible", timeout: 5000 });
    } else if (check.action === "inspector") {
      await page.getByRole("tab", { name: /^Inspector\b/ }).first().click({ timeout: 6000 });
      await page.locator("#inspector-panel").first().waitFor({ state: "visible", timeout: 5000 });
    } else if (check.action === "raw-log") {
      await page.getByRole("button", { name: "More inspector views" }).first().click({ timeout: 6000 });
      await page.getByRole("menuitem", { name: /Raw log/ }).first().click({ timeout: 5000 });
      await page.locator("ol.raw, [aria-label=\"Events\"]").first().waitFor({ state: "visible", timeout: 5000 });
    } else if (check.action === "export-overwrite") {
      // Topbar "Push" (inline on wide screens, in the overflow menu on phones).
      const inline = page.getByRole("button", { name: /^Push$/ }).first();
      if (await inline.isVisible().catch(() => false)) await inline.click({ timeout: 6000 });
      else {
        await page.getByRole("button", { name: /More actions/ }).first().click({ timeout: 6000 });
        // Menu items carry their description in the name ("Push · Push the latest files to …").
        await page.getByRole("menuitem", { name: /^Push\b/ }).first().click({ timeout: 5000 });
      }
      await page.getByRole("dialog").getByText(/has commits that weren't pushed from here/).first().waitFor({ state: "visible", timeout: 6000 });
    }
  } catch (error) {
    record.actionError = `${check.action}: ${firstLine(error?.message)}`;
  }
}

async function runCheck(page, driver, check, record, ctx) {
  const { config, fx, viewport } = ctx;
  if (!viewport.current || viewport.current.width !== check.viewport.width || viewport.current.height !== check.viewport.height) {
    await page.setViewportSize(check.viewport);
    viewport.current = check.viewport;
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // A blank same-origin page clears localStorage/sessionStorage: every check starts like a first visit.
  driver.state.record = null;
  await page.goto(`${ORIGIN}/__ui-check/blank`, { waitUntil: "load", timeout: 15_000 });
  fx.reset();
  fx.state.signedIn = !check.signedOut;
  driver.state.inflight.clear();
  driver.state.lastActivity = Date.now();
  driver.state.record = record;

  await page.goto(`${ORIGIN}${check.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page, driver, check, record);
  if (check.action) {
    await act(page, check, record);
    await settle(page, driver, check, record, { quietMs: 250, budgetMs: 5000, first: false });
  }
  await page.evaluate(installProbes);
  record.facts = await page.evaluate(opts => window.__uiCheck.facts(opts), { vendor: { source: VENDOR_PATTERN.source, flags: VENDOR_PATTERN.flags }, phone: check.phone, touchMin: config.touchMin });
  if (check.action === "model-menu") record.menu = await page.evaluate(() => window.__uiCheck.menu());
  const file = path.join(config.out, check.shot);
  await page.screenshot({ path: file, type: "png", animations: "disabled", timeout: 20_000 });
  record.screenshot = file;

  // Reduced motion before the focus walk: it also makes focus-ring transitions instant.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sleep(250);
  record.motion = await page.evaluate(() => window.__uiCheck.motion());
  if (check.action === "model-menu") {
    // An open menu keeps Tab inside it by design (arrow keys move focus there); the walk is meaningless.
    record.notes.focus = "skipped: a menu is open, and Tab does not move focus inside a menu";
  } else {
    for (let press = 0; press < config.tabs; press++) {
      await page.keyboard.press("Tab");
      await page.evaluate(() => (window.__uiCheck ? window.__uiCheck.focusStep() : 0));
    }
    record.focus = await page.evaluate(() => (window.__uiCheck ? window.__uiCheck.focusFinish() : []));
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

// ---- The run ----

async function live(config) {
  const creds = credentialsFromEnv();
  if (!creds) throw new SetupError("Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in the environment (they are read from there only and never printed).");
  const redact = makeRedactor([creds.apiKey, creds.projectId]);
  if (!fs.existsSync(path.join(config.dist, "index.html"))) throw new SetupError(`No built client at ${config.dist} (index.html is missing). Build it first; this script never builds.`);
  fs.mkdirSync(config.out, { recursive: true });
  for (const name of fs.readdirSync(config.out)) if (SHOT_NAME.test(name)) fs.rmSync(path.join(config.out, name), { force: true });

  const fx = createFixtures({ deployUrls: config.deployUrls });
  const plan = buildPlan(fx, config);
  if (!plan.length) throw new SetupError("UI_CHECK_ONLY matched no checks.");
  const router = createRouter({ publicDir: config.dist, fixtures: fx, fonts: config.fonts });
  const { chromium } = await import("playwright-core");

  const started = Date.now();
  const records = [];
  const reportPath = path.join(config.out, "report.json");
  const report = {
    startedAt: new Date(started).toISOString(), finishedAt: null, durationMs: 0, complete: false,
    origin: ORIGIN, dist: config.dist, fonts: config.fonts, deployUrls: config.deployUrls, mediaLimit: config.mediaLimit, tabs: config.tabs,
    viewports: config.viewports.map(viewport => `${viewport.width}x${viewport.height}`), planned: plan.length, session: null,
    summary: null, checks: [],
  };
  const writeReport = () => {
    report.durationMs = Date.now() - started;
    report.summary = summarize(records);
    report.checks = records.map(serializeRecord);
    const temp = `${reportPath}.tmp`;
    fs.writeFileSync(temp, redact(JSON.stringify(report, null, 2)));
    fs.renameSync(temp, reportPath);
  };

  let session = null;
  let pendingSession = null;
  let browser = null;
  let released = false;
  let interrupted = false;
  const release = async () => {
    if (released) return;
    released = true;
    if (browser) await browser.close().catch(() => undefined);
    // A signal can arrive while the session is being created: wait for it, then release it too.
    const active = session ?? (pendingSession ? await pendingSession.catch(() => null) : null);
    if (active) await releaseSession(creds, active.id, redact).then(() => log(`Session ${active.id} released.`), error => log(`Warning: ${redact(error?.message)}`));
  };
  const onSignal = signal => {
    if (interrupted) return;
    interrupted = true;
    log(`${signal}: stopping and releasing the session…`);
    release().finally(() => {
      report.finishedAt = new Date().toISOString();
      writeReport();
      process.exit(130);
    });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let page;
  let driver;
  let disconnected = false;
  try {
    try {
      pendingSession = createSession(creds, { ...plan[0].viewport, timeout: config.bbTimeout }, redact);
      session = await pendingSession;
      report.session = session.id;
      if (interrupted) return 130;
      log(`Browserbase session ${session.id} (${session.timeout ? `timeout ${session.timeout} s` : "the project's default timeout"}); ${plan.length} checks, fonts ${config.fonts}.`);
      browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 60_000 });
      browser.on("disconnected", () => {
        disconnected = true;
      });
      const context = browser.contexts()[0] ?? (await browser.newContext());
      page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(30_000);
      driver = attach(page, router, redact);
      await page.addInitScript({ content: heldEventSourceScript(fx.liveTaskIds) });
      await page.route("**/*", driver.route);
    } catch (error) {
      throw error instanceof SetupError ? error : new SetupError(redact(firstLine(error?.message) || String(error)));
    }

    const viewport = { current: null };
    for (const check of plan) {
      if (interrupted) break;
      const record = newRecord(check);
      const t0 = Date.now();
      if (disconnected) {
        record.error = "the browser session ended before this check could run";
      } else {
        let timer;
        try {
          await Promise.race([
            runCheck(page, driver, check, record, { config, fx, viewport }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`check took longer than ${CHECK_BUDGET_MS / 1000} s`)), CHECK_BUDGET_MS);
            }),
          ]);
        } catch (error) {
          record.error = redact(firstLine(error?.message) || String(error));
          if (!record.screenshot && !disconnected) {
            const file = path.join(config.out, check.shot);
            await page.screenshot({ path: file, type: "png", timeout: 10_000 }).then(() => {
              record.screenshot = file;
            }, () => undefined);
          }
          await page.emulateMedia({ reducedMotion: "no-preference" }).catch(() => undefined);
        } finally {
          clearTimeout(timer);
          driver.state.record = null;
        }
      }
      record.ms = Date.now() - t0;
      records.push(judge(record, config));
      const label = `[${String(check.n).padStart(String(plan.length).length)}/${plan.length}] ${check.key}`;
      log(`${label.padEnd(58)} ${record.ok ? "ok  " : `FAIL ${record.failures.join(", ")}`}${record.warnings.length ? `  (warn: ${record.warnings.join(", ")})` : ""}  ${(record.ms / 1000).toFixed(1)} s`);
      writeReport();
    }
    report.complete = !interrupted && records.length === plan.length && !disconnected;
    if (!report.complete) report.notRun = plan.slice(records.length).map(check => check.key);
  } finally {
    await release();
    report.finishedAt = new Date().toISOString();
    writeReport();
  }
  const summary = summarize(records);
  log("");
  log(formatSummary(summary, { ms: Date.now() - started, reportPath }));
  if (!report.complete) log(`The run stopped early: ${records.length} of ${plan.length} checks ran.`);
  return summary.failed === 0 && report.complete ? 0 : 1;
}

async function main() {
  const redact = makeRedactor(Object.values(credentialsFromEnv() ?? {}));
  let config;
  try {
    config = readConfig();
    if (config.dry) {
      const { selfTest } = await import("./selftest.mjs");
      return await selfTest(config);
    }
    return await live(config);
  } catch (error) {
    if (error instanceof SetupError) {
      log(`ui-check: ${error.message}`);
      return 2;
    }
    log(`ui-check: the run broke: ${redact(firstLine(error?.message) || String(error))}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
  // Idle keep-alive sockets must not hold the process open (the timer itself never does).
  setTimeout(() => process.exit(process.exitCode), 10_000).unref();
}
