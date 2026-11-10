// The check plan, per-check records and how they are judged. No Playwright here (the dry run uses it).
import { ORIGIN } from "./fixtures.mjs";
import { routeTemplate } from "./router.mjs";

export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 360, height: 740 },
];
export const PHONE_MAX = 639;

/** Failing categories, in report order. */
export const CATEGORIES = {
  overflow: "document scrolls horizontally",
  offscreen: "controls beyond the viewport",
  names: "interactive elements without an accessible name",
  imgAlt: "img without alt",
  duplicateIds: "duplicate ids",
  tablist: "tablist without tabs",
  focus: "keyboard focus not visible",
  motion: "animations running under reduced motion",
  vendor: "vendor name or secret in text/attributes",
  console: "console errors",
  network: "unexpected network failures",
  media: "too many /api/agent/media/ requests",
  unknownApi: "API requests without a fixture",
  images: "broken images",
  action: "interaction could not be performed",
  harness: "check could not run",
};
/** Reported, never failing. */
export const WARNINGS = {
  clipped: "control clipped by an overflow:hidden ancestor",
  touch: "touch target under 40px (phones)",
  titleWidth: "topbar title under 96px (phones, LAYOUT-5)",
  pane: "phone task page did not open on Conversation (LAYOUT-5)",
  stackedIcons: "icon stacked above its label (LAYOUT-1)",
  contrast: "text under its contrast target (4.5:1, 3:1 large; WCAG 2.x)",
  theme: "the page did not take the color scheme the check asked for",
  composer: "composer Run wrapped below the tools or composer overflows (LAYOUT-2)",
  menu: "model menu outside the viewport, over the top bar, or Auto hidden (LAYOUT-3)",
  headings: "page does not have exactly one visible h1",
  frames: "iframe without a title",
  obscured: "focused element covered by another element",
  dialogs: "native dialog opened (alert/confirm/prompt)",
  fonts: "web fonts did not load from the network (text metrics use fallbacks)",
  ready: "page did not reach its ready state in time",
};

const vp = viewport => `${viewport.width}x${viewport.height}`;
const slug = text => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

/** Pages × viewports, then the interactions (model menu everywhere, Inspector on phones, raw log once). */
export function buildPlan(fx, { viewports = VIEWPORTS, only = null } = {}) {
  const pages = [
    { id: "dashboard", path: "/" },
    { id: "tasks", path: "/tasks" },
    ...fx.scenarios.map(scenario => ({ id: `task-${scenario.key}`, path: `/tasks/${scenario.id}`, scenario: scenario.key, live: scenario.live, task: true })),
    { id: "sandbox", path: `/sandbox?task=${encodeURIComponent(fx.sandbox.taskId)}&path=${encodeURIComponent(fx.sandbox.path)}` },
    { id: "media", path: "/media" },
    { id: "integrations", path: "/integrations" },
    { id: "skills", path: "/skills" },
    { id: "keys", path: "/keys" },
    // The operator's dashboard (accounts, promo codes, settings).
    { id: "admin", path: "/admin" },
    { id: "login", path: "/login", signedOut: true },
    // The public homepage: scrolled through first (every reveal fires), then captured whole.
    { id: "home", path: "/", signedOut: true, fullPage: true, action: "scroll-through" },
    { id: "welcome", path: "/welcome", fullPage: true, action: "scroll-through" },
    { id: "not-found", path: "/no-such-page/at-all" },
  ];
  // Billing (crypto payments, 30-day plans, the paid Developer API): the free account's pages (on
  // Pro, with an API balance and requests running) and a newcomer's, the payment page in every
  // state, the operator's Payments and Plans tabs, the homepage's pricing. tall: one screenshot
  // holds the whole page or dialog (run.mjs); clip: just that section of the homepage.
  const billing = fx.billing ? [
    { id: "billing", path: "/billing", account: "free", tall: true },
    { id: "billing-newcomer", path: "/billing", account: "newcomer", tall: true, action: "credits-30d" },
    ...fx.billing.payStates.map(state => ({ id: `pay-${state.key}`, path: `/pay/${state.code}`, account: "free", tall: !state.short, ...(state.action ? { action: state.action } : {}) })),
    { id: "developer", path: "/developer", account: "free", tall: true },
    { id: "developer-30d", path: "/developer", account: "free", tall: true, action: "range-30d" },
    { id: "developer-24h", path: "/developer", account: "free", tall: true, action: "range-24h" },
    { id: "developer-add-balance", path: "/developer", account: "free", action: "add-balance" },
    { id: "admin-payments", path: "/admin?tab=payments", tall: true },
    { id: "admin-order", path: `/admin?tab=payments&order=${encodeURIComponent(fx.billing.reviewOrderCode)}`, tall: true },
    { id: "admin-plans", path: "/admin?tab=plans", tall: true },
    { id: "admin-account-billing", path: "/admin", tall: true, action: "account-billing" },
    { id: "home-pricing", path: "/", signedOut: true, action: "nav-pricing", clip: "#pricing" },
    { id: "credits-dialog", path: "/billing", account: "free", action: "credits-dialog" },
    { id: "credits-dialog-newcomer", path: "/billing", account: "newcomer", action: "credits-dialog" },
  ] : [];
  // The Media Vault while storage works: on Pro (unlimited, more pages) and a full free vault; choosing
  // many files, deleting the chosen ones or all of them, and several uploads at once (one refused).
  // Stored images load here, so more of the vault's requests are expected than with storage down.
  const vault = [
    { id: "media-pro", path: "/media", account: "free", mediaLimit: 14 },
    { id: "media-full", path: "/media", account: "newcomer", mediaLimit: 14 },
    { id: "media-select", path: "/media", account: "free", action: "media-select", mediaLimit: 14 },
    { id: "media-delete-selected", path: "/media", account: "free", action: "media-delete-selected", mediaLimit: 14 },
    { id: "media-delete-all", path: "/media", account: "free", action: "media-delete-all", mediaLimit: 14 },
    { id: "media-uploads", path: "/media", account: "free", action: "media-uploads", mediaLimit: 14 },
  ];
  const checks = [];
  for (const viewport of viewports) {
    const phone = viewport.width <= PHONE_MAX;
    for (const page of pages) checks.push({ ...page, viewport, phone });
    for (const page of vault) checks.push({ ...page, viewport, phone });
    checks.push({ id: "dashboard-model-menu", path: "/", viewport, phone, action: "model-menu" });
    if (phone) for (const scenario of fx.scenarios) checks.push({ id: `task-${scenario.key}-inspector`, path: `/tasks/${scenario.id}`, scenario: scenario.key, live: scenario.live, task: true, viewport, phone, action: "inspector" });
    for (const page of billing) checks.push({ ...page, viewport, phone });
    // Below 1024px the homepage's sections (Pricing among them) are in the menu sheet.
    if (billing.length && viewport.width < 1024) checks.push({ id: "home-menu", path: "/", signedOut: true, viewport, phone, action: "home-menu" });
  }
  // The dark theme (the device asks for it: the page follows): every kind of page once wide and once
  // on a phone, and the theme menu itself (opened, never changed: a check never stores a theme).
  const DARK = new Set(["dashboard", "tasks", "task-completed", "task-running", "sandbox", "media", "media-pro", "media-full", "media-select", "media-delete-all",
    "integrations", "skills", "keys", "admin", "login", "home", "not-found", "billing", "pay-usdt", "pay-review", "developer", "admin-payments", "admin-order", "credits-dialog"]);
  const darkPages = [...pages, ...vault, ...billing].filter(page => DARK.has(page.id));
  const darkViewports = [viewports.find(viewport => viewport.width >= 1440) ?? viewports[0], viewports.find(viewport => viewport.width > 360 && viewport.width <= PHONE_MAX) ?? viewports[viewports.length - 1]];
  for (const viewport of darkViewports.filter(Boolean)) {
    const phone = viewport.width <= PHONE_MAX;
    for (const page of darkPages) checks.push({ ...page, id: `${page.id}-dark`, scheme: "dark", viewport, phone });
    checks.push({ id: "theme-menu", path: "/", viewport, phone, action: "theme-menu" });
    checks.push({ id: "theme-menu-dark", path: "/", viewport, phone, action: "theme-menu", scheme: "dark" });
    checks.push({ id: "home-theme-menu-dark", path: "/", signedOut: true, viewport, phone, action: "home-theme-menu", scheme: "dark" });
  }
  const wide = viewports.find(viewport => viewport.width >= 1024);
  const interrupted = fx.scenarios.find(scenario => scenario.key === "interrupted");
  if (wide && interrupted) checks.push({ id: "task-interrupted-raw-log", path: `/tasks/${interrupted.id}`, scenario: "interrupted", task: true, viewport: wide, phone: false, action: "raw-log" });
  // Re-export over a branch with commits from elsewhere (warning + confirmation), and a failed Deploy
  // run (Deploy again instead of Retry): once wide, once on the narrowest phone.
  const narrow = viewports.filter(viewport => viewport.width <= PHONE_MAX).sort((a, b) => a.width - b.width)[0];
  const preview = fx.scenarios.find(scenario => scenario.key === "preview");
  for (const viewport of [wide, narrow].filter(Boolean)) {
    const phone = viewport.width <= PHONE_MAX;
    if (preview) checks.push({ id: "task-preview-export", path: `/tasks/${preview.id}`, scenario: "preview", task: true, viewport, phone, action: "export-overwrite" });
    if (fx.redeployTaskId) checks.push({ id: "task-redeploy", path: `/tasks/${fx.redeployTaskId}`, scenario: "redeploy", task: true, viewport, phone });
    checks.push({ id: "dashboard-starters", path: "/", viewport, phone, action: "starters" });
    // A free account: the credits meter and the dashboard's credits line.
    checks.push({ id: "dashboard-free", path: "/", viewport, phone, account: "free" });
  }
  const selected = only ? checks.filter(check => only.test(`${check.id}@${vp(check.viewport)}`)) : checks;
  const width = String(selected.length).length < 2 ? 2 : String(selected.length).length;
  return selected.map((check, index) => ({ ...check, n: index + 1, key: `${check.id}@${vp(check.viewport)}`, shot: `${String(index + 1).padStart(width, "0")}-${slug(check.id)}-${vp(check.viewport)}.png` }));
}

export function newRecord(check) {
  return {
    n: check.n, key: check.key, id: check.id, path: check.path, viewport: vp(check.viewport), action: check.action ?? null, scheme: check.scheme ?? "light",
    ok: false, failures: [], warnings: [], issues: {}, notes: {}, screenshot: null, ms: 0, error: null,
    requests: [], console: [], pageErrors: [], network: [], unknownApi: [], dialogs: [], fontFailures: [],
    expectedUrls: new Set(), expectedStatuses: new Set(), facts: null, focus: null, motion: null, menu: null, actionError: null, ready: [],
  };
}

/** Called for every routed request while this record is current. */
export function noteRequest(record, { method, url, resourceType, reply }) {
  const parsed = new URL(url);
  const local = parsed.origin === ORIGIN;
  const where = local ? `${parsed.pathname}${parsed.search}` : `${parsed.origin}${parsed.pathname}`;
  const entry = { method, path: where.length > 260 ? `${where.slice(0, 259)}…` : where, type: resourceType, kind: reply.kind, status: reply.action === "fulfill" ? reply.status : reply.action };
  record.requests.push(entry);
  if (reply.kind === "api-unknown") record.unknownApi.push({ method, path: parsed.pathname, template: routeTemplate(parsed.pathname) });
  else if (reply.kind === "external") record.network.push({ type: "external", detail: `left the fixture world: ${method} ${parsed.origin}${parsed.pathname}`, url });
  else if (reply.kind === "missing-static" || reply.kind === "blocked-path") record.network.push({ type: "missing", detail: `${reply.status} ${where}`, url });
  else if (reply.action === "fulfill" && reply.status >= 400 && !reply.expected) record.network.push({ type: "http", detail: `${reply.status} ${method} ${where}`, url });
  if (reply.expected && (reply.action === "abort" || (reply.action === "fulfill" && reply.status >= 400))) {
    record.expectedUrls.add(url);
    if (reply.status) record.expectedStatuses.add(reply.status);
  }
}

/** Turn a record's raw facts into failures (categories above) and warnings. */
export function judge(record, { mediaLimit = 6, touchMin = 40 } = {}) {
  const fail = (category, detail) => {
    record.failures.push(category);
    record.issues[category] = detail;
  };
  const warn = (category, detail) => {
    if (!record.warnings.includes(category)) record.warnings.push(category);
    record.notes[category] = detail;
  };
  const facts = record.facts;
  if (facts) {
    if (facts.overflow.px > 1) fail("overflow", facts.overflow);
    if (facts.offscreen.length) fail("offscreen", facts.offscreen.slice(0, 20));
    if (facts.unnamed.length) fail("names", facts.unnamed.slice(0, 20));
    if (facts.imgNoAlt.length) fail("imgAlt", facts.imgNoAlt.slice(0, 20));
    if (facts.duplicateIds.length) fail("duplicateIds", facts.duplicateIds.slice(0, 20));
    if (facts.emptyTablists.length) fail("tablist", facts.emptyTablists);
    if (facts.vendor.length) fail("vendor", facts.vendor);
    if (facts.brokenImages.length) fail("images", facts.brokenImages);
    if (facts.clipped.length) warn("clipped", facts.clipped.slice(0, 10));
    if (facts.touch.length) warn("touch", { min: touchMin, count: facts.touch.length, smallest: [...facts.touch].sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h)).slice(0, 12) });
    if (facts.stackedIcons.length) warn("stackedIcons", facts.stackedIcons.slice(0, 10));
    if (facts.contrast?.length) fail("contrast", facts.contrast.slice(0, 20));
    if (record.scheme && facts.theme && facts.theme !== record.scheme) fail("theme", { asked: record.scheme, page: facts.theme });
    if (facts.composer && (facts.composer.sendBelowTools || facts.composer.overflowPx > 1)) warn("composer", facts.composer);
    if (facts.h1.length !== 1) warn("headings", facts.h1);
    const untitled = facts.frames.filter(frame => !frame.titled);
    if (untitled.length) warn("frames", untitled);
    const phone = Number(record.viewport.split("x")[0]) <= 639;
    if (phone && facts.topbarTitleWidth !== null && facts.topbarTitleWidth < 96) warn("titleWidth", { width: facts.topbarTitleWidth });
    if (phone && record.id.startsWith("task-") && !record.action && facts.selectedPane && !/conversation/i.test(facts.selectedPane)) warn("pane", { selected: facts.selectedPane });
  }
  if (record.focus) {
    const bad = record.focus.filter(step => !step.none && (!step.via || !step.shown || !step.inViewport) && !step.frame)
      .map(step => ({ ...step, problem: !step.shown ? "focus moved to an element that is not visible" : !step.inViewport ? "focused element is outside the viewport" : "no visible focus indicator (outline or box-shadow)" }));
    if (bad.length) fail("focus", bad);
    const covered = record.focus.filter(step => step.obscured);
    if (covered.length) warn("obscured", covered);
  }
  if (record.motion && record.motion.length) fail("motion", record.motion.slice(0, 20));
  if (record.menu) {
    const m = record.menu;
    if (!m.open || m.bottom > m.innerHeight + 1 || m.top < m.topbarBottom - 1 || m.right > m.innerWidth + 1 || m.left < -1 || !m.autoVisible) warn("menu", m);
  }

  // Console: errors except the browser's own "Failed to load resource" lines for responses that were
  // intended (fixture errors) or are already counted under network.
  const known = new Set([...record.expectedUrls, ...record.network.map(item => item.url)]);
  const errors = record.console.filter(entry => {
    const resource = /^Failed to load resource/.exec(entry.text);
    if (!resource) return true;
    if (entry.url && known.has(entry.url)) return false;
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(entry.url)) return false; // reported as the fonts warning
    const status = /status of (\d{3})/.exec(entry.text);
    return !(status && !entry.url && record.expectedStatuses.has(Number(status[1])));
  });
  record.notes.consoleErrors = errors.length + record.pageErrors.length;
  if (errors.length || record.pageErrors.length) fail("console", { errors: errors.slice(0, 20), pageErrors: record.pageErrors.slice(0, 10) });
  if (record.network.length) fail("network", record.network.slice(0, 30).map(({ url: _url, ...item }) => item));
  const mediaCalls = record.requests.filter(request => request.path.startsWith("/api/agent/media/"));
  record.notes.mediaRequests = mediaCalls.length;
  if (mediaCalls.length > mediaLimit) fail("media", { limit: mediaLimit, count: mediaCalls.length, requests: mediaCalls.slice(0, 20).map(request => `${request.method} ${request.path} ${request.status}`) });
  if (record.unknownApi.length) fail("unknownApi", record.unknownApi.slice(0, 20));
  if (record.actionError) fail("action", record.actionError);
  if (record.error) fail("harness", record.error);
  if (record.dialogs.length) warn("dialogs", record.dialogs);
  if (record.fontFailures.length) warn("fonts", record.fontFailures.slice(0, 5));
  if (record.ready.length) warn("ready", record.ready);
  record.ok = record.failures.length === 0;
  return record;
}

/** What goes into report.json for one check (Sets and DOM-sized data trimmed). */
export function serializeRecord(record) {
  const { expectedUrls: _urls, expectedStatuses: _statuses, facts, console: consoleEntries, pageErrors: _pageErrors, network: _network, unknownApi: _unknown, dialogs: _dialogs, fontFailures: _fonts, ready: _ready, menu, focus, motion: _motion, actionError: _actionError, ...rest } = record;
  return {
    ...rest,
    metrics: facts ? {
      docOverflowX: facts.overflow.px, controls: facts.controls, scrollableControls: facts.scrollable, parkedControls: facts.parked.length,
      requests: record.requests.length, apiRequests: record.requests.filter(request => request.path.startsWith("/api/")).length,
      mediaRequests: record.notes.mediaRequests ?? 0, consoleErrors: record.notes.consoleErrors ?? 0, consoleLines: consoleEntries.length, title: facts.title, url: facts.url,
    } : null,
    focusTrail: focus ? focus.map(step => (step.none ? "(nothing focused)" : `${step.via ?? "NO RING"} · ${step.el}`)) : null,
    menu,
  };
}

/** Counts per category and the checks behind them. */
export function summarize(records) {
  const failed = records.filter(record => !record.ok);
  const byCategory = {};
  for (const category of Object.keys(CATEGORIES)) {
    const hit = records.filter(record => record.failures.includes(category));
    if (hit.length) byCategory[category] = { checks: hit.length, label: CATEGORIES[category], examples: hit.slice(0, 8).map(record => record.key) };
  }
  const warnings = {};
  for (const category of Object.keys(WARNINGS)) {
    const hit = records.filter(record => record.warnings.includes(category));
    if (hit.length) warnings[category] = { checks: hit.length, label: WARNINGS[category], examples: hit.slice(0, 6).map(record => record.key) };
  }
  const unknown = new Map();
  for (const record of records) {
    for (const item of record.unknownApi) {
      const key = `${item.method} ${item.template}`;
      const entry = unknown.get(key) ?? { route: key, requests: 0, checks: new Set() };
      entry.requests += 1;
      entry.checks.add(record.key);
      unknown.set(key, entry);
    }
  }
  return {
    checks: records.length,
    passed: records.length - failed.length,
    failed: failed.length,
    byCategory,
    warnings,
    unknownApiRoutes: [...unknown.values()].map(entry => ({ route: entry.route, requests: entry.requests, checks: entry.checks.size, examples: [...entry.checks].slice(0, 5) })),
    failedChecks: failed.map(record => ({ key: record.key, failures: record.failures, screenshot: record.screenshot })),
  };
}

export function formatSummary(summary, { ms, reportPath }) {
  const lines = [];
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  lines.push(`UI check: ${summary.checks} checks, ${summary.passed} passed, ${summary.failed} failed (${minutes}m ${String(seconds).padStart(2, "0")}s)`);
  const pad = Math.max(10, ...Object.keys(CATEGORIES).map(key => key.length)) + 2;
  if (Object.keys(summary.byCategory).length) {
    lines.push("Failures (checks per category):");
    for (const [category, entry] of Object.entries(summary.byCategory)) lines.push(`  ${category.padEnd(pad)}${String(entry.checks).padStart(3)}  ${entry.label} · e.g. ${entry.examples.slice(0, 3).join(", ")}`);
  }
  if (summary.unknownApiRoutes.length) {
    lines.push("API routes without a fixture:");
    for (const route of summary.unknownApiRoutes) lines.push(`  ${route.route} (${route.requests} requests in ${route.checks} checks)`);
  }
  if (Object.keys(summary.warnings).length) lines.push(`Warnings (not failing): ${Object.entries(summary.warnings).map(([category, entry]) => `${category} ${entry.checks}`).join(", ")}`);
  if (reportPath) lines.push(`Report: ${reportPath}`);
  return lines.join("\n");
}
