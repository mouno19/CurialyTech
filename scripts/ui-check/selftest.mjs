// Dry run (UI_CHECK_DRY=1): everything the harness does except the browser. Validates the fixtures
// against the contract, routes synthetic requests (static, SPA fallback, every client endpoint, SSE,
// tRPC, external hosts), runs the held-open EventSource in a vm sandbox, installs the page probes on a
// fake window, builds the plan and judges synthetic records. Exit 0 when nothing is wrong.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { BUNDLES, createFixtures, DEEP_FILE, LONG_PDF, LONG_REPO, ORIGIN, SECRET_LIVE_URL, STATUSES, TASK, TOKEN_300, VENDOR_PATTERN } from "./fixtures.mjs";
import { compileRoute, createRouter } from "./router.mjs";
import { buildPlan, judge, newRecord, noteRequest, serializeRecord, summarize, VIEWPORTS } from "./harness.mjs";
import { heldEventSourceScript, installProbes } from "./probes.mjs";
import { makeRedactor } from "./browserbase.mjs";

const EVENT_TYPES_FALLBACK = [
  "status", "run_start", "team_agent", "handoff", "user_message", "phase", "dispatch", "turn_start", "thinking_start", "thinking_delta",
  "thinking_end", "text_start", "text_delta", "text_end", "tool_start", "tool_input_delta", "tool_call", "tool_output", "tool_result",
  "file_change", "plan", "verify_start", "verify_result", "heal", "recovery", "usage", "external", "media", "deployment", "artifacts",
  "browser_session", "browser_action", "preview", "repo", "repo_push", "repo_pr", "notice", "error", "done",
];
const ACTIVE = new Set(["queued", "running", "cancelling"]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseSse(text) {
  const blocks = [];
  for (const raw of text.split("\n\n")) {
    if (!raw.trim()) continue;
    const block = { event: "message", id: null, data: "" };
    for (const line of raw.split("\n")) {
      const colon = line.indexOf(":");
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") block.event = value;
      else if (field === "id") block.id = value;
      else if (field === "data") block.data += value;
    }
    blocks.push(block);
  }
  return blocks;
}

/** Walks plain data; calls visit(value, path) for every string. */
function walkStrings(value, visit, at = "$", seen = new Set()) {
  if (typeof value === "string") return visit(value, at);
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Buffer.isBuffer(value)) return;
  if (value instanceof Map) return value.forEach((item, key) => walkStrings(item, visit, `${at}[${key}]`, seen));
  if (value instanceof Set) return [...value].forEach((item, index) => walkStrings(item, visit, `${at}{${index}}`, seen));
  for (const [key, item] of Object.entries(value)) walkStrings(item, visit, `${at}.${key}`, seen);
}

function makePublicDir(config) {
  if (fs.existsSync(path.join(config.dist, "index.html"))) return { dir: config.dist, temporary: false };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-check-dist-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><head><link rel=\"icon\" href=\"/favicon.svg\"><link rel=\"stylesheet\" href=\"/assets/index-Ab12Cd34.css\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/index-Ef56Gh78.js\"></script></body></html>");
  fs.writeFileSync(path.join(dir, "assets/index-Ef56Gh78.js"), "console.log('fixture bundle');\n");
  fs.writeFileSync(path.join(dir, "assets/index-Ab12Cd34.css"), "body{margin:0}\n");
  fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"/>");
  return { dir, temporary: true };
}

function listClientFiles(dir) {
  const out = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (full.endsWith(`${path.sep}components${path.sep}ui`)) continue;
        visit(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  visit(dir);
  return out;
}

export async function selfTest(config) {
  const sections = [];
  let current = null;
  const section = (name, detail = "") => {
    current = { name, detail, problems: [], notes: [] };
    sections.push(current);
    return current;
  };
  const expect = (condition, message) => {
    if (!condition) current.problems.push(message);
    return Boolean(condition);
  };
  const fx = createFixtures({ deployUrls: config.deployUrls });
  const tasks = [...fx.tasks.values()];
  const rows = tasks.map(task => task.row);
  const byKey = key => tasks.find(task => task.key === key);

  // ---- Fixtures vs the contract ----
  const s1 = section("fixtures");
  let eventTypes = EVENT_TYPES_FALLBACK;
  try {
    const agentSource = fs.readFileSync(path.join(config.repo, "shared/agent.ts"), "utf8");
    const union = agentSource.slice(agentSource.indexOf("export type AgentEventBody"), agentSource.indexOf("export type GeneratedSummary"));
    const parsed = [...union.matchAll(/\{\s*type:\s*"([a-z_]+)"/g)].map(match => match[1]);
    if (parsed.length >= 20) eventTypes = parsed;
    else s1.notes.push("could not read the AgentEventBody union from shared/agent.ts; used the built-in list");
  } catch (error) {
    s1.notes.push(`shared/agent.ts not readable (${error.message}); used the built-in event list`);
  }
  const known = new Set(eventTypes);
  const types = { id: "string", prompt: "string", status: "string", mode: "string", model: "string", effort: "string", webSearch: "boolean", usage: "object", filesChanged: "number", createdAt: "string", updatedAt: "string" };
  for (const row of rows) {
    for (const [key, type] of Object.entries(types)) expect(typeof row[key] === type, `${row.id}: ${key} must be a ${type}`);
    expect(STATUSES.includes(row.status), `${row.id}: unknown status ${row.status}`);
    expect(["agent", "chat"].includes(row.mode) && ["low", "medium", "high"].includes(row.effort), `${row.id}: bad mode/effort`);
    for (const key of ["createdAt", "updatedAt", "startedAt", "finishedAt", "statusChangedAt"]) if (row[key] !== undefined) expect(!Number.isNaN(Date.parse(row[key])), `${row.id}: ${key} is not a date`);
    expect(["inputTokens", "outputTokens", "thinkingTokens"].every(key => typeof row.usage[key] === "number"), `${row.id}: usage needs input/output/thinking tokens`);
  }
  for (const status of STATUSES) expect(rows.some(row => row.status === status), `no task row with status "${status}"`);
  expect(rows.some(row => row.status === "completed" && row.outcome?.verification === "failed"), "no completed row with a failed verification");
  expect(rows.some(row => row.status === "completed" && row.outcome?.verification !== "failed"), "no clean completed row");
  expect(rows.some(row => row.status === "interrupted" && row.statusReason === "server_restart" && !row.error), "no legacy restart row (interrupted, server_restart, error cleared)");
  expect(LONG_REPO.length === 120, `LONG_REPO is ${LONG_REPO.length} characters, not 120`);
  expect(rows.some(row => row.githubRepo === LONG_REPO), "no row carries the 120-character repository");
  expect(rows.some(row => row.prompt.length >= 400), "no prompt of 400+ characters");
  expect(LONG_PDF.length >= 100 && DEEP_FILE.split("/").length - 1 >= 12, "long filename / 12-deep path missing");
  expect(TOKEN_300.length === 300 && !/\s/.test(TOKEN_300), "TOKEN_300 must be 300 characters without whitespace");

  let eventCount = 0;
  for (const task of tasks) {
    const events = task.events;
    eventCount += events.length;
    const opened = { tool: new Set(), text: new Set(), thinking: new Set() };
    events.forEach((event, index) => {
      expect(event.seq === index + 1, `${task.key}: seq ${event.seq} at index ${index}`);
      expect(known.has(event.type), `${task.key}: unknown event type ${event.type}`);
      expect(!Number.isNaN(Date.parse(event.ts)) && Date.parse(event.ts) <= fx.now, `${task.key} #${event.seq}: ts must be a past date`);
      if (index) expect(Date.parse(event.ts) >= Date.parse(events[index - 1].ts), `${task.key} #${event.seq}: ts goes backwards`);
      if (event.type === "tool_start") opened.tool.add(event.callId);
      if (["tool_call", "tool_output", "tool_result", "tool_input_delta"].includes(event.type)) expect(opened.tool.has(event.callId), `${task.key} #${event.seq}: ${event.type} before tool_start ${event.callId}`);
      if (event.type === "text_start") opened.text.add(event.blockId);
      if (event.type === "text_delta" || event.type === "text_end") expect(opened.text.has(event.blockId), `${task.key} #${event.seq}: text before text_start`);
      if (event.type === "thinking_start") opened.thinking.add(event.blockId);
      if (event.type === "thinking_delta" || event.type === "thinking_end") expect(opened.thinking.has(event.blockId), `${task.key} #${event.seq}: thinking before thinking_start`);
      if (event.type === "browser_session" && task.key !== "interrupted") expect(event.liveUrl === null, `${task.key} #${event.seq}: new logs carry liveUrl null`);
      if (event.type === "deployment") expect(typeof event.deploymentId === "string" && event.deploymentId.length === 36, `${task.key} #${event.seq}: deployment needs the row id`);
    });
    const last = events.at(-1);
    if (task.live || ACTIVE.has(task.row.status)) expect(!events.some(event => event.type === "done" && events.indexOf(event) > events.map(item => item.type).lastIndexOf("run_start")), `${task.key}: an active run has no done`);
    else if (task.key !== "interrupted") expect(last.type === "done" && last.status === task.row.status, `${task.key}: a finished run ends with done{status:${task.row.status}}`);
    if (task.live) expect(task.liveFrom > 1 && task.liveFrom <= events.length, `${task.key}: liveFrom out of range`);
  }
  {
    const legacy = byKey("interrupted").events;
    const statuses = legacy.filter(event => event.type === "status");
    expect(!legacy.some(event => event.type === "run_start" || event.type === "done"), "interrupted: a legacy log has no run_start and no done");
    expect(statuses.at(-1)?.status === "running", "interrupted: the log must end on status running");
    expect(legacy.some(event => event.type === "browser_session" && event.status === "live" && event.liveUrl === SECRET_LIVE_URL), "interrupted: needs a live browser_session with the tokenised legacy liveUrl");
    expect(!legacy.some(event => event.type === "browser_session" && event.status === "ended"), "interrupted: the browser session must still look live in the log");
  }
  {
    const completed = byKey("completed");
    const artifacts = completed.events.find(event => event.type === "artifacts");
    const bundles = artifacts?.files.filter(file => file.path.startsWith("frontend/dist/assets/")) ?? [];
    expect(artifacts && artifacts.files.length === 23 && bundles.length === 20, "completed: artifacts must list 20 hashed bundles + 3 files");
    expect(artifacts?.generated?.count === 37 && artifacts.generated.dirs[0]?.dir === "frontend/dist", "completed: artifacts.generated summary missing");
    const liveEvent = completed.events.find(event => event.type === "deployment" && event.status === "live");
    expect(liveEvent && Date.parse(liveEvent.expiresAt) < fx.now, "completed: the deployment event must say live with expiresAt in the past");
    expect(completed.deployments[0]?.state === "expired", "completed: the deployment row must be expired");
    expect(completed.preview.archived === true && completed.preview.build?.dir === "frontend/dist" && completed.preview.build?.fileCount === 37, "completed: preview must be archived with build frontend/dist (37 files)");
    expect(completed.events.some(event => event.type === "run_start" && event.trigger === "deploy"), "completed: needs a deploy run");
  }
  {
    const answer = byKey("chat").row.answer;
    const header = answer.split("\n").find(line => line.startsWith("| Library"));
    expect(header && header.split("|").length - 2 >= 12, "chat: the table needs 12 columns");
    expect(answer.includes(TOKEN_300), "chat: the 300-character token is missing");
    expect(/```[a-z]*\nvite v\d/.test(answer), "chat: the vite build log code block is missing");
  }
  {
    const failed = byKey("failed");
    expect(failed.row.error && failed.events.some(event => event.type === "error") && failed.events.some(event => event.type === "text_delta"), "failed: needs error, done.error and partial text");
    const running = byKey("running");
    expect(running.events.some(event => event.type === "browser_session" && event.status === "live" && event.viewer === true), "running: needs a live browser session");
    expect(running.events.some(event => event.type === "tool_output" && event.chunk.split("\n").some(line => line.length >= 300)), "running: needs a tool output line of 300+ characters");
    expect(Object.values(running.browsers).some(session => session.status === "live" && session.viewer?.startsWith(ORIGIN)), "running: the live viewer must be a fixture page");
  }
  s1.detail = `${rows.length} task rows, ${fx.scenarios.length} scenario pages, ${eventCount} events`;

  // ---- Cross-check with shared/ (optional: Node strips the TypeScript types) ----
  const s2 = section("shared/");
  try {
    const status = await import(pathToFileURL(path.join(config.repo, "shared/taskStatus.ts")).href);
    const generated = await import(pathToFileURL(path.join(config.repo, "shared/generated.ts")).href);
    for (const row of rows) expect(status.STATUS_META[row.status], `STATUS_META has no ${row.status}`);
    expect(status.deriveTaskStatus({ streamStatus: "running", streamLive: false, streamEnded: true, rowStatus: "interrupted" }) === "interrupted", "deriveTaskStatus: an ended replay of the legacy log must show interrupted");
    expect(status.displayState("completed", byKey("issues").row.outcome) === "issues", "the failed-check row must display as issues");
    for (const key of ["completed", "chat", "preview"]) expect(status.displayState("completed", byKey(key).row.outcome) === "success", `${key} must display as a clean success`);
    const expired = byKey("completed").deployments[0];
    expect(status.deriveDeploymentState({ status: "live", expiresAt: expired.expiresAt, deletedAt: expired.removedAt, removedReason: expired.removedReason }, fx.now, false) === "expired", "deriveDeploymentState must say expired");
    expect(status.deriveDeploymentState({ status: "live", expiresAt: byKey("preview").deployments[0].expiresAt }, fx.now, false) === "live", "the preview deployment must still be live");
    for (const key of ["failed", "cancelled", "interrupted"]) expect(status.isRetryable(byKey(key).row.status), `${key} must be retryable`);
    const files = byKey("completed").events.find(event => event.type === "artifacts").files;
    expect(files.filter(file => generated.isGeneratedPath(file.path)).length === 20, "isGeneratedPath must flag exactly the 20 bundles");
    const block = /```text\n([\s\S]*?)```/.exec(byKey("chat").row.answer)?.[1] ?? "";
    expect(generated.looksLikeBuildOutput(block), "looksLikeBuildOutput must recognise the build log");
    s2.detail = "taskStatus.ts and generated.ts agree with the fixtures";
  } catch (error) {
    s2.notes.push(`skipped (could not import shared/*.ts: ${error.message.split("\n")[0]})`);
    s2.detail = "skipped";
  }

  // ---- Router ----
  const s3 = section("router");
  const publicDir = makePublicDir(config);
  const router = createRouter({ publicDir: publicDir.dir, fixtures: fx, fonts: config.fonts });
  const send = (method, url, { type = "fetch", body } = {}) => router.handle({ method, url: url.startsWith("http") ? url : `${ORIGIN}${url}`, resourceType: type, postData: body === undefined ? null : JSON.stringify(body) });
  const asJson = reply => {
    try {
      return JSON.parse(reply.body.toString("utf8"));
    } catch {
      return undefined;
    }
  };
  let routed = 0;
  const check = (name, reply, want) => {
    routed++;
    if (want.action) expect(reply.action === want.action, `${name}: action ${reply.action}, expected ${want.action}`);
    if (want.status !== undefined) expect(reply.action === "fulfill" && reply.status === want.status, `${name}: status ${reply.status ?? reply.action}, expected ${want.status}`);
    if (want.kind) expect(reply.kind === want.kind, `${name}: kind ${reply.kind}, expected ${want.kind}`);
    if (want.type) expect(want.type.test(reply.headers?.["content-type"] ?? ""), `${name}: content-type ${reply.headers?.["content-type"]}`);
    if (reply.action === "fulfill" && /json/.test(reply.headers?.["content-type"] ?? "") && reply.body.length) expect(asJson(reply) !== undefined, `${name}: body is not valid JSON`);
    if (want.json) expect(want.json(asJson(reply)), `${name}: unexpected body ${reply.body?.toString("utf8").slice(0, 160)}`);
    if (want.expected !== undefined) expect(reply.expected === want.expected, `${name}: expected=${reply.expected}`);
    if (want.kind !== "api-unknown") expect(reply.kind !== "api-unknown", `${name}: no fixture answered it`);
    return reply;
  };
  const index = fs.readFileSync(path.join(publicDir.dir, "index.html"));
  check("app root", send("GET", "/", { type: "document" }), { status: 200, kind: "static", type: /text\/html/ });
  check("SPA fallback", send("GET", `/tasks/${TASK.running}`, { type: "document" }), { status: 200, kind: "spa", type: /text\/html/ });
  check("SPA fallback with a query", send("GET", `/sandbox?task=${TASK.completed}`, { type: "document" }), { status: 200, kind: "spa" });
  const assets = [...index.toString("utf8").matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg|png|ico|webmanifest))"/g)].map(match => match[1]);
  expect(assets.length > 0, "index.html references no local assets");
  for (const asset of assets) check(`asset ${asset}`, send("GET", asset, { type: "script" }), { status: 200, kind: "static" });
  const script = assets.find(asset => asset.endsWith(".js"));
  if (script) check("script content type", send("GET", script, { type: "script" }), { type: /^text\/javascript/ });
  const css = assets.find(asset => asset.endsWith(".css"));
  if (css) check("stylesheet content type", send("GET", css, { type: "stylesheet" }), { type: /^text\/css/ });
  if (fs.existsSync(path.join(publicDir.dir, "favicon.svg"))) check("favicon", send("GET", "/favicon.svg", { type: "image" }), { status: 200, type: /^image\/svg\+xml/ });
  check("missing asset", send("GET", "/assets/missing-Zz99Yy88.js", { type: "script" }), { status: 404, kind: "missing-static" });
  check("encoded traversal", send("GET", "/..%2f..%2f..%2fetc%2fpasswd", { type: "document" }), { status: 404, kind: "blocked-path" });
  const dotted = send("GET", "/../../etc/passwd", { type: "document" });
  expect(dotted.kind === "spa" && dotted.body.equals(index), "a dot-dot path must never leave the client directory");
  check("reset page", send("GET", "/__ui-check/blank", { type: "document" }), { status: 200, kind: "internal" });
  check("live view page", send("GET", `/__fixtures__/live-view/${Object.keys(byKey("running").browsers)[0]}`, { type: "document" }), { status: 200, type: /text\/html/ });
  const fontAction = config.fonts === "block" ? "abort" : "continue";
  check("Google Fonts stylesheet", send("GET", "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&display=swap", { type: "stylesheet" }), { action: fontAction, kind: "font" });
  check("font file", send("GET", "https://fonts.gstatic.com/s/geist/v1/geist-latin.woff2", { type: "font" }), { action: fontAction, kind: "font" });
  check("GitHub avatar", send("GET", "https://avatars.githubusercontent.com/u/9919?v=4", { type: "image" }), { status: 200, kind: "external-stub", type: /^image\/svg/ });
  check("vendor preview frame", send("GET", "https://curialy-preview-7d3f2a10.onrender.com/", { type: "document" }), { status: 200, kind: "external", expected: false });
  check("branded preview host", send("GET", "https://curialy-preview-7d3f2a10.preview.curialy.test/", { type: "document" }), { status: 200, kind: "fixture-page", type: /text\/html/ });
  check("third-party script", send("GET", "https://cdn.example.com/widget.js", { type: "script" }), { action: "abort", kind: "external", expected: false });
  const trpcInput = encodeURIComponent(JSON.stringify({ 0: { json: null, meta: { values: ["undefined"], v: 1 } } }));
  check("tRPC auth.me", send("GET", `/api/trpc/auth.me?batch=1&input=${trpcInput}`), { status: 200, kind: "trpc", json: body => Array.isArray(body) && body[0]?.result?.data?.json?.admin === true });
  check("tRPC unknown procedure", send("GET", `/api/trpc/nothing.here?batch=1&input=${trpcInput}`), { status: 404, kind: "api-unknown" });
  check("unknown API route", send("GET", "/api/agent/definitely-not-a-route"), { status: 404, kind: "api-unknown" });

  const id = TASK.completed;
  const liveId = TASK.running;
  const sessionId = Object.keys(byKey("running").browsers)[0];
  const endedSession = Object.keys(byKey("interrupted").browsers)[0];
  const deploymentId = byKey("completed").deployments[0].id;
  const media = fx.data.media[0].id;
  const enc = encodeURIComponent;
  const calls = [
    ["GET", "/api/agent/models", 200, null, body => body.models.length >= 3],
    ["GET", "/api/agent/health", 200, null, body => body.providers.some(probe => probe.id === "vault" && !probe.ok) && body.providers.filter(probe => !probe.ok && probe.id !== "vault").length === 1],
    ["GET", "/api/agent/health?deep=1", 200],
    ["GET", "/api/agent/keys", 200, null, body => body.keys.length > 5],
    ["GET", "/api/agent/stats", 200, null, body => body.total === rows.length && body.active === 3],
    ["GET", "/api/agent/tasks", 200, null, body => body.tasks.length === rows.length && body.tasks.every(row => row.answer === undefined)],
    ["POST", "/api/agent/tasks", 201, { prompt: "x", model: "auto", mode: "agent", effort: "high", webSearch: false, attachmentIds: [] }],
    ["GET", `/api/agent/tasks/${id}`, 200, null, body => body.task.id === id && body.live === false && typeof body.task.answer === "string"],
    ["GET", `/api/agent/tasks/${liveId}`, 200, null, body => body.live === true && body.running === true],
    ["GET", "/api/agent/tasks/00000000-0000-4000-8000-000000000000", 404],
    ["POST", `/api/agent/tasks/${id}/messages`, 202, { prompt: "x", attachmentIds: [] }, body => body.ok === true && body.status === "queued"],
    ["POST", `/api/agent/tasks/${liveId}/messages`, 409, { prompt: "x" }],
    ["POST", `/api/agent/tasks/${liveId}/cancel`, 202, { runId: byKey("running").row.runId }, body => body.status === "cancelling"],
    ["POST", `/api/agent/tasks/${id}/cancel`, 200, {}, body => body.changed === false],
    ["POST", `/api/agent/tasks/${TASK.failed}/retry`, 202, {}],
    ["POST", `/api/agent/tasks/${id}/retry`, 409, {}],
    ["POST", `/api/agent/tasks/${id}/deploy`, 202, { confirm: true }],
    ["POST", `/api/agent/tasks/${id}/deploy`, 400, {}],
    ["DELETE", `/api/agent/tasks/${id}`, 200],
    ["DELETE", `/api/agent/tasks/${liveId}`, 409],
    ["GET", `/api/agent/tasks/${id}/tree`, 200, null, body => body.source === "archived" && body.entries.some(entry => entry.path === DEEP_FILE)],
    ["GET", `/api/agent/tasks/${id}/file?path=${enc(DEEP_FILE)}`, 200, null, body => body.content.length > 300],
    ["GET", `/api/agent/tasks/${id}/file?path=nothing.txt`, 404],
    ["POST", `/api/agent/tasks/${id}/repo`, 200, { repo: LONG_REPO, branch: "main" }],
    ["POST", `/api/agent/tasks/${id}/export/plan`, 200, {}, body => body.target.kind === "new"],
    ["POST", `/api/agent/tasks/${id}/export`, 400, { repoName: "x" }, body => body.code === "visibility_required"],
    ["POST", `/api/agent/tasks/${id}/export`, 400, { repoName: "x", visibility: "public" }, body => body.code === "confirm_public"],
    ["POST", `/api/agent/tasks/${id}/export`, 200, { repoName: "x", visibility: "private" }],
    ["POST", `/api/agent/tasks/${liveId}/export/plan`, 200, {}, body => body.target.kind === "linked"],
    ["GET", `/api/agent/tasks/${id}/preview`, 200, null, body => body.available === false && body.archived === true && body.build.fileCount === 37],
    ["GET", `/api/agent/tasks/${TASK.preview}/preview?dir=dist`, 200, null, body => body.available === true && body.url.startsWith("/api/workspace/preview/")],
    ["POST", `/api/agent/tasks/${id}/workspace/restore`, 200, {}],
    ["POST", `/api/agent/tasks/${TASK.preview}/preview/screenshot`, 200, {}],
    ["GET", `/api/agent/tasks/${id}/deployments`, 200, null, body => body.deployments[0].state === "expired" && body.capabilities.configured === true],
    ["DELETE", `/api/agent/tasks/${id}/deployments/${deploymentId}`, 200],
    ["GET", "/api/agent/deployments", 200],
    ["DELETE", `/api/agent/deployments/${deploymentId}`, 200],
    ["GET", `/api/agent/tasks/${liveId}/browser/${sessionId}?fresh=1`, 200, null, body => body.status === "live" && body.viewer.startsWith(ORIGIN)],
    ["POST", `/api/agent/tasks/${liveId}/browser/${sessionId}/reconnect`, 200, {}],
    ["GET", `/api/agent/tasks/${TASK.interrupted}/browser/${endedSession}?fresh=1`, 200, null, body => body.status === "ended" && body.viewer === null],
    ["POST", `/api/agent/tasks/${TASK.interrupted}/browser/${endedSession}/reconnect`, 410, {}],
    ["GET", "/api/agent/media", 200, null, body => body.files.length >= 10 && body.storage.ok === false && body.storage.retryAfter === 30 && body.quota.reason === "operator" && body.nextCursor === null && body.matching === body.summary.total],
    ["GET", "/api/agent/media?kind=upload", 200, null, body => body.files.every(file => file.kind === "upload") && body.matching === body.summary.byKind.upload],
    ["GET", "/api/agent/media/ids", 200, null, body => body.ids.length === body.total && body.total >= 10],
    ["POST", "/api/agent/media/delete", 503, { ids: [media] }, body => body.code === "storage_unavailable" && body.failed.length === 1 && body.deleted.length === 0],
    ["POST", "/api/agent/media", 503, null, body => body.code === "storage_unavailable"],
    ["GET", "/api/agent/media/health", 200, null, body => body.state === "unavailable"],
    ["GET", "/api/agent/media/health?probe=1", 200],
    ["GET", `/api/agent/media/${media}`, 503, null, body => body.code === "storage_unavailable" && body.retryAfter === 30],
    ["GET", `/api/agent/media/${media}?download=1`, 503],
    ["GET", `/api/agent/media/${media}/text`, 503],
    ["DELETE", `/api/agent/media/${media}`, 503],
    ["GET", "/api/agent/media/00000000-0000-4000-8000-000000000000", 404, null, body => body.code === "media_not_found"],
    ["GET", "/api/agent/github", 200, null, body => body.connected === true && body.login === "mouno19"],
    ["DELETE", "/api/agent/github", 200],
    ["GET", "/api/github/repos", 200, null, body => body.repos.some(repo => repo.full_name === LONG_REPO)],
    ["GET", "/api/agent/github/repos", 200],
    ["GET", "/api/auth/github/start", 200],
    ["POST", "/api/auth/login", 200, { password: "x" }],
    ["POST", "/api/auth/logout", 200, {}],
    ["GET", "/api/health", 200],
  ];
  for (const [method, url, status, body, test] of calls) check(`${method} ${url}`, send(method, url, { body: body ?? undefined }), { status, json: test ?? undefined });
  const head = check("HEAD media", send("HEAD", `/api/agent/media/${media}`), { status: 503, expected: true });
  expect(head.headers["retry-after"] === "30" && head.body.length === 0, "HEAD media: needs Retry-After: 30 and no body");
  expect(send("GET", `/api/agent/media/${media}`).headers["retry-after"] === "30", "GET media: needs Retry-After: 30");
  check("raw workspace image", send("GET", `/api/agent/tasks/${id}/file?raw=1&path=${enc(byKey("completed").events.find(event => event.type === "artifacts").files[2].path)}`, { type: "image" }), { status: 200, type: /^image\/png/ });
  const previewUrl = byKey("preview").preview.url;
  check("workspace preview frame", send("GET", previewUrl, { type: "document" }), { status: 200, type: /text\/html/ });
  check("workspace preview HEAD", send("HEAD", previewUrl), { status: 200 });
  fx.state.signedIn = false;
  check("signed out: admin API", send("GET", "/api/agent/tasks"), { status: 401, expected: false });
  check("signed out: auth.me", send("GET", `/api/trpc/auth.me?batch=1&input=${trpcInput}`), { status: 200, json: body => body[0].result.data.json.admin === false });
  check("signed out: login", send("POST", "/api/auth/login", { body: { password: "x" } }), { status: 200 });
  fx.reset();
  expect(compileRoute(["GET", "/api/workspace/preview/:taskId/:token/*", () => ({})]).regex.test("/api/workspace/preview/a/b"), "the /* route must also match without a trailing path");
  s3.detail = `${routed} requests routed${publicDir.temporary ? " (no build at UI_CHECK_DIST yet: a stand-in client was used)" : ` (built client at ${publicDir.dir})`}`;

  // ---- Billing fixtures vs shared/billing.ts ----
  const sb = section("billing");
  {
    const ORDER_KEYS = ["code", "kind", "planId", "planDays", "planCreditsPerWindow", "planMonths", "title", "listUsd", "discountPercent", "priceUsd", "creditUsd", "network", "coin", "payAddress", "expectedAmount", "quoteUsdPrice", "txHash", "receivedAmount", "status", "statusDetail", "confirmations", "requiredConfirmations", "createdAt", "quotedAt", "expiresAt", "submitUntil", "submittedAt", "completedAt", "applied", "explorerUrl", "events"];
    const ADMIN_KEYS = [...ORDER_KEYS, "user", "adminNote", "txFrom", "txBlockTime", "checkCount", "lastCheckedAt", "chainVerifiedAt"];
    const TOTAL_KEYS = ["requests", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "costMicros", "listMicros"];
    const PAY_STATUSES = ["awaiting_payment", "pending", "confirming", "review", "completed", "rejected", "expired"];
    const hasKeys = (value, keys, what) => expect(value && keys.every(key => key in value) && Object.keys(value).every(key => keys.includes(key)), `${what}: keys differ from the type (${Object.keys(value ?? {}).filter(key => !keys.includes(key)).concat(keys.filter(key => !(key in (value ?? {})))).join(", ")})`);
    let shared = null;
    try {
      shared = await import(pathToFileURL(path.join(config.repo, "shared/billing.ts")).href);
    } catch (error) {
      sb.notes.push(`shared/billing.ts not importable (${error.message.split("\n")[0]}): the catalog is checked against itself only`);
    }
    const data = fx.data.billing;
    const catalog = asJson(send("GET", "/api/billing/catalog"));
    expect(catalog?.plans?.length === 2 && catalog.plans.every(plan => plan.discountPercent === 90 && plan.priceUsd === Math.round(plan.listUsd * 10) / 100), "catalog: Pro and Max at 90% off");
    expect(catalog?.networks?.length === 4 && catalog.models?.length === 19, `catalog: 4 networks and 19 models (got ${catalog?.networks?.length} and ${catalog?.models?.length})`);
    if (shared && catalog) {
      for (const model of catalog.models) {
        const list = shared.API_PRICES[model.id];
        expect(list && ["input", "output", "cacheRead", "cacheWrite"].every(key => list[key] === model.list[key]), `catalog: ${model.id} list prices differ from API_PRICES (run billing-catalog.gen.mjs)`);
        const limits = shared.modelLimits(model.id);
        expect((limits?.contextWindow ?? null) === model.contextWindow && (limits?.maxOutput ?? null) === model.maxOutput, `catalog: ${model.id} limits differ from MODEL_LIMITS (run billing-catalog.gen.mjs)`);
        const offer = shared.discountedPrices(model.list, catalog.discount.apiPercent);
        expect(["input", "output", "cacheRead", "cacheWrite"].every(key => offer[key] === model.price[key]), `catalog: ${model.id} offer prices are not discountedPrices()`);
      }
      expect(catalog.networks.every(network => shared.networkInfo(network.id)?.coins.length === network.coins.length), "catalog: networks differ from PAYMENT_NETWORKS");
    }
    const operatorOrders = asJson(send("GET", "/api/billing/orders"));
    expect(operatorOrders?.orders?.length === 0, "the operator's own order list should be empty");
    fx.state.account = "free";
    const own = asJson(send("GET", "/api/billing/orders"))?.orders ?? [];
    for (const status of PAY_STATUSES) expect(own.some(order => order.status === status), `the free account has no order in status ${status}`);
    for (const order of data.customerOrders) {
      hasKeys(order, ORDER_KEYS, `order ${order.code}`);
      expect(/^CUR-[0-9A-HJKMNP-TV-Z]{8}$/.test(order.code), `order ${order.code}: not a CUR- code`);
      expect(PAY_STATUSES.includes(order.status) && order.events.every(event => PAY_STATUSES.includes(event.status) && ["customer", "system", "admin"].includes(event.actor) && !Number.isNaN(Date.parse(event.at))), `order ${order.code}: bad status or events`);
      expect(!order.events.some(event => event.actor === "admin" && event.note), `order ${order.code}: the payer's view must not carry the operator's notes`);
      if (order.network) expect(order.payAddress && order.expectedAmount && /^\d+(\.\d+)?$/.test(order.expectedAmount), `order ${order.code}: details issued without a wallet or amount`);
      if (shared && order.txHash) expect(shared.normalizeTxHash(order.network, order.txHash) !== null && order.explorerUrl === shared.explorerTxUrl(order.network, order.txHash), `order ${order.code}: the hash or explorer link isn't valid for ${order.network}`);
    }
    for (const order of data.orders) hasKeys(order, ADMIN_KEYS, `admin order ${order.code}`);
    for (const state of fx.billing.payStates) {
      const reply = send("GET", `/api/billing/orders/${state.code}`);
      check(`pay state ${state.key}`, reply, state.key === "unknown" ? { status: 404, expected: true } : { status: 200, json: body => body.order.code === state.code });
    }
    for (const range of ["24h", "7d", "30d", "90d"]) {
      const report = asJson(send("GET", `/api/billing/api/usage?range=${range}&tz=${encodeURIComponent("America/New_York")}`));
      expect(report?.buckets?.length === { "24h": 24, "7d": 7, "30d": 30, "90d": 90 }[range] && report.bucket === (range === "24h" ? "hour" : "day"), `api usage ${range}: wrong bucket count or size`);
      const sum = rows => Object.fromEntries(TOTAL_KEYS.map(key => [key, rows.reduce((total, row) => total + row[key], 0)]));
      for (const [what, rows] of [["buckets", report.buckets], ["byModel", report.byModel], ["byKey", report.byKey]]) {
        const got = sum(rows);
        expect(TOTAL_KEYS.every(key => got[key] === report.totals[key]), `api usage ${range}: ${what} don't add up to the totals`);
      }
      expect(report.totals.requests > 0 && report.totals.costMicros > 0 && report.totals.costMicros < report.totals.listMicros, `api usage ${range}: no charged requests at the offer price`);
      const starts = report.buckets.map(bucket => Date.parse(bucket.start));
      expect(starts.every((start, index) => !index || start > starts[index - 1]) && starts.at(-1) <= fx.now, `api usage ${range}: buckets out of order or in the future`);
      const credits = asJson(send("GET", `/api/billing/credits/usage?range=${range}&tz=UTC`));
      expect(credits?.buckets?.length === report.buckets.length && Math.abs(credits.buckets.reduce((total, bucket) => total + bucket.credits, 0) - credits.totals.credits) < 0.05 && credits.allowance === 6000, `credit usage ${range}: buckets, totals or allowance wrong`);
    }
    check("bad usage range", send("GET", "/api/billing/api/usage?range=1y&tz=UTC"), { status: 400, expected: true });
    const account = asJson(send("GET", "/api/billing/account"));
    expect(account?.plan?.id === "pro" && account.apiWallet.reservedMicros > 0 && account.apiWallet.availableMicros === account.apiWallet.balanceMicros - account.apiWallet.reservedMicros && account.operator === false, "the free account: on Pro, with a reservation");
    const me = asJson(send("GET", "/api/account"));
    expect(me?.credits?.plan?.id === "pro" && me.credits.allowance === me.credits.plan.creditsPerWindow, "the free account's credits: the plan's allowance");
    fx.state.account = "newcomer";
    const fresh = asJson(send("GET", "/api/account"));
    expect(fresh?.credits?.plan === null && asJson(send("GET", "/api/billing/orders"))?.orders?.length === 0 && asJson(send("GET", "/api/billing/account"))?.apiWallet.balanceMicros === 0, "the newcomer: no plan, no orders, no API balance");
    fx.reset();
    for (const user of fx.data.adminUsers) expect("plan" in user.credits && "plan" in user && typeof user.apiBalanceUsd === "number", `admin user ${user.login}: credits.plan, plan or apiBalanceUsd missing`);
    const wallets = asJson(send("GET", "/api/admin/billing/wallets"));
    expect(wallets?.networks?.some(network => network.unavailable) && wallets.networks.some(network => network.coins.some(coin => coin.amount === "0")), "wallet balances: need a zero and an unreachable network");
    const overview = asJson(send("GET", "/api/admin/billing/overview"));
    expect(overview && PAY_STATUSES.every(status => typeof overview.counts[status] === "number") && overview.counts.review === 2, "admin overview: counts per status (two in review)");
    check("admin orders: attention", send("GET", "/api/admin/billing/orders?status=attention&q=&offset=0"), { status: 200, json: body => body.orders.length === 2 && body.orders.every(order => order.status === "review") });
    check("admin orders: search", send("GET", "/api/admin/billing/orders?status=all&q=hedy&offset=0"), { status: 200, json: body => body.orders.length === 1 });
    check("admin order dialog", send("GET", `/api/admin/billing/orders/${fx.billing.reviewOrderCode}`), { status: 200, json: body => body.order.status === "review" && body.order.txFrom });
    check("admin account billing", send("GET", `/api/admin/billing/users/${fx.billing.users.free.id}`), { status: 200, json: body => body.plan && body.orders.length > 5 && body.ledger.length >= 3 && body.orders.every(order => order.events.length === 0) });
    check("developer keys", send("GET", "/api/keys"), { status: 200, json: body => Array.isArray(body.keys) });
    fx.state.signedIn = false;
    check("signed out: the catalog is public", send("GET", "/api/billing/catalog"), { status: 200 });
    check("signed out: orders need a session", send("GET", "/api/billing/orders"), { status: 401, expected: false });
    fx.reset();
    sb.detail = `${data.customerOrders.length} orders (${PAY_STATUSES.length} statuses), ${catalog?.models?.length ?? 0} priced models, 4 usage ranges${shared ? ", prices match shared/billing.ts" : ""}`;
  }

  // ---- SSE bodies ----
  const s4 = section("streams");
  for (const task of tasks) {
    const url = `/api/agent/tasks/${task.row.id}/events?after=0`;
    const reply = send("GET", url, { type: "eventsource" });
    if (!expect(reply.status === 200 && /^text\/event-stream/.test(reply.headers["content-type"]), `${task.key}: SSE status/content type`)) continue;
    const blocks = parseSse(reply.body.toString("utf8"));
    const sync = blocks[0]?.event === "sync" ? JSON.parse(blocks[0].data) : null;
    expect(sync && typeof sync.maxSeq === "number" && sync.status === task.row.status && sync.live === task.live, `${task.key}: the first message must be sync with maxSeq/status/live`);
    const messages = blocks.filter(block => block.event === "message");
    expect(messages.length === task.events.length && messages.every((block, index) => Number(block.id) === index + 1 && JSON.parse(block.data).seq === index + 1), `${task.key}: every event once, in order, id = seq`);
    expect((blocks.at(-1)?.event === "end") === !task.live, `${task.key}: ${task.live ? "a live stream stays open (no end)" : "a finished stream ends with event: end"}`);
    const half = Math.floor(task.events.length / 2);
    const later = parseSse(send("GET", `/api/agent/tasks/${task.row.id}/events?after=${half}`, { type: "eventsource" }).body.toString("utf8"));
    const laterSync = JSON.parse(later[0].data);
    expect(later.filter(block => block.event === "message").every(block => Number(block.id) > half), `${task.key}: after=${half} must only replay later events`);
    expect(laterSync.maxSeq >= (task.live ? Math.min(half, task.liveFrom - 1) : half), `${task.key}: maxSeq below the client's position would force a reset loop`);
    if (task.live) {
      expect(sync.maxSeq === task.liveFrom - 1, `${task.key}: the first sync must mark the live tail`);
      const tail = parseSse(send("GET", `/api/agent/tasks/${task.row.id}/events?after=${task.events.length}`, { type: "eventsource" }).body.toString("utf8"));
      expect(JSON.parse(tail[0].data).maxSeq === task.events.length && tail.length === 1, `${task.key}: a reconnect at the end gets sync only`);
    }
  }
  s4.detail = `${tasks.length} task streams`;

  // ---- The held-open EventSource, in a vm sandbox with fetch wired to the router ----
  const s5 = section("live stream");
  {
    let nativeUsed = 0;
    class NativeStub {
      constructor(url) {
        nativeUsed++;
        this.url = url;
      }
      close() {}
    }
    const sandbox = {
      console, URL, AbortController, EventTarget, Event, MessageEvent, setTimeout, clearTimeout, Response,
      location: { href: `${ORIGIN}/tasks/${TASK.running}`, origin: ORIGIN },
      EventSource: NativeStub,
      fetch: async url => {
        const reply = send("GET", String(url), { type: "fetch" });
        return new Response(reply.body, { status: reply.status, headers: reply.headers });
      },
    };
    sandbox.window = sandbox;
    sandbox.top = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(heldEventSourceScript(fx.liveTaskIds), sandbox);
    expect(sandbox.EventSource !== NativeStub && sandbox.__uiCheckSse, "the transport did not install");
    const running = byKey("running");
    const seen = { open: 0, sync: [], messages: [], end: 0, error: 0, times: [] };
    const es = new sandbox.EventSource(`${ORIGIN}/api/agent/tasks/${running.row.id}/events?after=0`, { withCredentials: true });
    es.onopen = () => seen.open++;
    es.onmessage = message => {
      seen.messages.push(JSON.parse(message.data).seq);
      seen.times.push(Date.now());
    };
    es.onerror = () => seen.error++;
    es.addEventListener("sync", message => seen.sync.push(JSON.parse(message.data)));
    es.addEventListener("end", () => seen.end++);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !(sandbox.__uiCheckSse.delivered > 0 && sandbox.__uiCheckSse.pending === 0)) await sleep(25);
    await sleep(150);
    const liveCount = running.events.length - running.liveFrom + 1;
    expect(seen.open === 1 && seen.sync.length === 1 && seen.sync[0].maxSeq === running.liveFrom - 1, "open + one sync marking the live tail");
    expect(seen.messages.length === running.events.length && seen.messages.every((seq, index) => seq === index + 1), `all ${running.events.length} events in order (got ${seen.messages.length})`);
    expect(seen.end === 0 && seen.error === 0 && es.readyState === 1, "a live stream stays open: no end, no error, readyState OPEN");
    const liveTimes = seen.times.slice(running.liveFrom - 1);
    expect(liveTimes.length === liveCount && liveTimes.at(-1) - liveTimes[0] >= (liveCount - 1) * 60, "live events must arrive paced, not all at once");
    es.close();
    expect(es.readyState === 2 && sandbox.__uiCheckSse.pending === 0, "close() must stop the stream");
    const again = new sandbox.EventSource(`${ORIGIN}/api/agent/tasks/${running.row.id}/events?after=${running.events.length}`);
    let late = 0;
    again.onmessage = () => late++;
    await sleep(120);
    expect(again.readyState === 1 && late === 0, "a reconnect at the end stays open with nothing new");
    again.close();
    new sandbox.EventSource(`${ORIGIN}/api/agent/tasks/${TASK.failed}/events?after=0`);
    expect(nativeUsed === 1, "finished tasks must use the browser's own EventSource");
    s5.detail = `${running.events.length} events, ${liveCount} delivered live ${80} ms apart, stream held open`;
  }

  // ---- Page probes install and run on a fake window ----
  const s6 = section("probes");
  {
    const fake = {
      activeElement: null, body: {}, documentElement: {},
      getAnimations: () => [], querySelectorAll: () => [], querySelector: () => null,
    };
    const sandbox = { document: fake, location: { pathname: "/", search: "" }, innerWidth: 1440, innerHeight: 900, getComputedStyle: () => ({}), NodeFilter: {}, HTMLInputElement: class {} };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    try {
      vm.runInContext(`(${installProbes.toString()})()`, sandbox);
      const probes = sandbox.__uiCheck;
      expect(probes && ["facts", "focusStep", "focusFinish", "motion", "menu"].every(name => typeof probes[name] === "function"), "window.__uiCheck is incomplete");
      expect(Array.isArray(probes.motion()) && probes.motion().length === 0, "motion() on an idle page");
      expect(probes.menu().open === false, "menu() with no menu open");
      probes.focusStep();
      const trail = probes.focusFinish();
      expect(trail.length === 1 && trail[0].none, "focus probes with nothing focused");
    } catch (error) {
      expect(false, `installing the probes threw: ${error.message}`);
    }
    expect(VENDOR_PATTERN.test(SECRET_LIVE_URL) && !VENDOR_PATTERN.test("https://curialy.test/tasks"), "vendor pattern sanity");
    s6.detail = "installer and probes evaluate standalone";
  }

  // ---- Plan ----
  const s7 = section("plan");
  const plan = buildPlan(fx, config);
  const keys = new Set(plan.map(item => item.key));
  const shots = new Set(plan.map(item => item.shot));
  expect(keys.size === plan.length && shots.size === plan.length, "check keys and screenshot names must be unique");
  if (!config.only && config.viewports === VIEWPORTS) {
    const ids = new Set(plan.map(item => item.id));
    for (const required of ["dashboard", "tasks", "sandbox", "media", "integrations", "skills", "keys", "login", "not-found", "dashboard-model-menu", "task-interrupted-raw-log", ...fx.scenarios.map(scenario => `task-${scenario.key}`), ...fx.scenarios.map(scenario => `task-${scenario.key}-inspector`)]) expect(ids.has(required), `the plan has no ${required} check`);
    expect(plan.filter(item => item.action === "inspector").every(item => item.viewport.width < 640), "Inspector checks are for phones");
  }
  const perViewport = {};
  for (const item of plan) perViewport[`${item.viewport.width}x${item.viewport.height}`] = (perViewport[`${item.viewport.width}x${item.viewport.height}`] ?? 0) + 1;
  s7.detail = `${plan.length} checks (${Object.entries(perViewport).map(([size, count]) => `${size}: ${count}`).join(", ")})`;

  // ---- Judge ----
  const s8 = section("judge");
  {
    const facts = (extra = {}) => ({
      url: "/", title: "x", vw: 1440, vh: 900, overflow: { px: 0 }, controls: 4, scrollable: 0, parked: [], offscreen: [], clipped: [], unnamed: [], touch: [], imgNoAlt: [],
      brokenImages: [], duplicateIds: [], emptyTablists: [], vendor: [], frames: [], h1: [{ text: "x", width: 200 }], topbarTitleWidth: 200, stackedIcons: [], composer: null, selectedPane: null, ...extra,
    });
    const clean = newRecord({ n: 1, key: "clean@1440x900", id: "clean", path: "/", viewport: { width: 1440, height: 900 } });
    clean.facts = facts();
    clean.focus = [{ el: "a.skip-link", via: "outline", shown: true, inViewport: true }];
    clean.motion = [];
    noteRequest(clean, { method: "GET", url: `${ORIGIN}/api/agent/media/x`, resourceType: "image", reply: { action: "fulfill", status: 503, expected: true, kind: "api" } });
    clean.console.push({ text: "Failed to load resource: the server responded with a status of 503 ()", url: `${ORIGIN}/api/agent/media/x` });
    clean.fontFailures.push("https://fonts.gstatic.com/s/geist/v1/a.woff2: net::ERR_TIMED_OUT");
    clean.console.push({ text: "Failed to load resource: net::ERR_TIMED_OUT", url: "https://fonts.gstatic.com/s/geist/v1/a.woff2" });
    judge(clean, { mediaLimit: 6 });
    expect(clean.ok && clean.failures.length === 0, `a clean record failed: ${clean.failures.join(", ")}`);
    expect(clean.warnings.includes("fonts"), "a font outage must be a warning");
    const bad = newRecord({ n: 2, key: "bad@390x844", id: "task-x", path: "/tasks/x", viewport: { width: 390, height: 844 } });
    bad.facts = facts({ overflow: { px: 14 }, offscreen: [{ el: "button" }], unnamed: [{ el: "button" }], vendor: [{ match: "onrender" }], topbarTitleWidth: 0, selectedPane: "Inspector" });
    bad.focus = [{ el: "button", via: null, shown: true, inViewport: true }];
    bad.motion = [{ name: "spin", duration: 900, iterations: "infinite" }];
    for (let n = 0; n < 7; n++) noteRequest(bad, { method: "GET", url: `${ORIGIN}/api/agent/media/m${n}`, resourceType: "image", reply: { action: "fulfill", status: 503, expected: true, kind: "api" } });
    noteRequest(bad, { method: "GET", url: `${ORIGIN}/api/agent/nope`, resourceType: "fetch", reply: { action: "fulfill", status: 404, expected: false, kind: "api-unknown" } });
    noteRequest(bad, { method: "GET", url: `${ORIGIN}/api/agent/tasks/x`, resourceType: "fetch", reply: { action: "fulfill", status: 500, expected: false, kind: "api" } });
    bad.console.push({ text: "TypeError: cannot read properties of undefined", url: "" });
    judge(bad, { mediaLimit: 6 });
    for (const category of ["overflow", "offscreen", "names", "vendor", "focus", "motion", "media", "unknownApi", "network", "console"]) expect(bad.failures.includes(category), `judge missed ${category}`);
    expect(bad.warnings.includes("titleWidth") && bad.warnings.includes("pane"), "judge missed the phone warnings");
    const summary = summarize([clean, bad]);
    expect(summary.failed === 1 && summary.byCategory.overflow?.checks === 1 && summary.unknownApiRoutes.length === 1, "summary counts");
    expect(JSON.stringify(serializeRecord(bad)).length > 0, "records serialise");
    s8.detail = "synthetic records judged as expected";
  }

  // ---- Client endpoints vs fixture routes (drift: the client is being rewritten in parallel) ----
  const s9 = section("client API");
  {
    const compiled = fx.routes.map(compileRoute);
    const referenced = new Map();
    const clientDir = path.join(config.repo, "client/src");
    if (!fs.existsSync(clientDir)) s9.notes.push(`no ${clientDir}; skipped`);
    else {
      for (const file of listClientFiles(clientDir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(/["'`](\/api\/[^"'`\s]*)/g)) {
          const normalized = match[1].split("?")[0].replace(/\$\{[^}]*\}/g, "X").replace(/\$\{.*$/, "");
          if (normalized === "/api" || normalized === "/api/") continue;
          const list = referenced.get(normalized) ?? new Set();
          list.add(path.relative(config.repo, file));
          referenced.set(normalized, list);
        }
      }
      for (const [endpoint, files] of referenced) {
        // A strict prefix of a route ("/api/auth" in startsWith checks) is a comparison, not a call.
        const prefix = fx.routes.some(([, pattern]) => pattern.startsWith(`${endpoint.replace(/\/$/, "")}/`));
        const covered = prefix || endpoint === "/api/trpc" || endpoint.startsWith("/api/trpc/") || compiled.some(route => route.regex.test(endpoint) || route.regex.test(endpoint.replace(/\/$/, "")));
        expect(covered, `the client references ${endpoint} (${[...files].join(", ")}) but no fixture route matches it`);
      }
      s9.detail = `${referenced.size} endpoints referenced in client/src, each answered by a fixture`;
    }
  }

  // ---- Fixtures must not trip the vendor scan by themselves ----
  const s10 = section("vendor scan");
  {
    let bait = 0;
    const visit = (value, at) => {
      if (fx.baitValues.has(value)) {
        bait++;
        return;
      }
      if (/^data:/.test(value)) return;
      expect(!VENDOR_PATTERN.test(value), `fixture text would trip the vendor scan by itself at ${at}: "${value.slice(0, 80)}"`);
    };
    walkStrings({ rows, events: tasks.map(task => task.events), deployments: tasks.map(task => task.deployments), previews: tasks.map(task => task.preview), plans: tasks.map(task => task.exportPlan), trees: tasks.map(task => task.tree), browsers: tasks.map(task => task.browsers), data: fx.data }, visit);
    for (const page of [send("GET", `/__fixtures__/live-view/x`).body, send("GET", byKey("preview").preview.url).body, send("GET", "/__ui-check/blank").body]) visit(page.toString("utf8"), "fixture page");
    expect(bait >= 3, "the leak bait (tokenised liveUrl, deploy hosts) is missing");
    s10.detail = `clean apart from ${bait} deliberate bait values`;
  }

  // ---- Redaction ----
  const s11 = section("redaction");
  {
    const redact = makeRedactor(["bb_live_0123456789abcdef", "proj-5f2e9a"]);
    const text = redact("connect wss://connect.example-cloud.com/?signingKey=abc.def&x=1 key bb_live_0123456789abcdef project proj-5f2e9a https://api.example.com/v1?apiKey=zzz");
    expect(!/bb_live_|proj-5f2e9a|abc\.def|zzz/.test(text), `redaction leaked: ${text}`);
    s11.detail = "credentials, connect URLs and signed parameters are removed";
  }

  if (publicDir.temporary) fs.rmSync(publicDir.dir, { recursive: true, force: true });

  // ---- Output ----
  const problems = sections.reduce((sum, item) => sum + item.problems.length, 0);
  process.stdout.write("ui-check dry run (no browser)\n");
  for (const item of sections) {
    process.stdout.write(`  ${item.name.padEnd(12)} ${item.problems.length ? `FAIL (${item.problems.length})` : "ok"}${item.detail ? `  ${item.detail}` : ""}\n`);
    for (const note of item.notes) process.stdout.write(`      note: ${note}\n`);
    for (const problem of item.problems.slice(0, 25)) process.stdout.write(`      - ${problem}\n`);
    if (item.problems.length > 25) process.stdout.write(`      … ${item.problems.length - 25} more\n`);
  }
  process.stdout.write(problems ? `\n${problems} problem(s).\n` : "\nNo problems: fixtures, routing and the plan are ready for a browser run.\n");
  return problems ? 1 : 0;
}
