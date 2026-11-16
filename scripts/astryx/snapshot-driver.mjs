// Runs inside scripts/astryx/jail.sh (no network, transient user, read-only project). Asks the
// staged Astryx CLI for everything the snapshot holds through its public commands, and prints one
// JSON record per line on stdout: {key, args, code, out, err}. Node builtins only: the CLI runs as
// child processes in the staged project, which is the code this jail exists to contain.
//   node snapshot-driver.mjs [--sample]   (--sample: a few of each, to check shapes quickly)

import { spawn } from "node:child_process";

const PROJECT = "/srv/stage/project";
const CLI = `${PROJECT}/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs`;
const SAMPLE = process.argv.includes("--sample");
const POOL = 3;
const MAX_OUT = 8 * 1024 * 1024;

/** Docs groups worth serving to an agent that builds apps (cli, global and authoring document the CLI itself). */
const DOC_ROOTS = ["guides", "foundations", "layout", "migration", "styling", "styling-libraries", "tokens", "typography", "internationalization", "calendars"];
/** Ideas whose official build kits become fixtures for the ranking tests. */
const BUILD_IDEAS = [
  "analytics dashboard", "saas admin panel with users table", "settings page", "login page", "sign up with sso", "checkout flow",
  "payment form", "product detail page", "photo gallery", "kanban board for tasks", "ai chat assistant", "chat app with conversations",
  "documentation site", "api reference docs", "file explorer", "code editor ide", "incident response console", "inbox with message list",
  "crm contacts table with filters", "multi step onboarding form", "contact form", "course page for online learning", "media library",
  "project management work item detail", "team directory", "billing and invoices", "notifications center", "marketing hero section",
  "sales funnel and retention analytics", "kpi scorecard report", "alerts monitoring dashboard", "data table with grouping", "tree view of files",
  "comparison table of plans", "design editor canvas", "messaging inbox", "user profile page", "order history table", "calendar scheduling",
  "landing page for an ai product",
];

function run(args, { cwd = PROJECT, input } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let size = 0;
    child.stdout.on("data", chunk => { size += chunk.length; if (size <= MAX_OUT) out += chunk; });
    child.stderr.on("data", chunk => { if (err.length < 4000) err += chunk; });
    if (input) child.stdin.end(input);
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", code => { clearTimeout(timer); resolve({ code, out: size > MAX_OUT ? null : out, err: err.slice(0, 4000) }); });
    child.on("error", error => { clearTimeout(timer); resolve({ code: -1, out: "", err: String(error).slice(0, 4000) }); });
  });
}

const cli = args => run([CLI, ...args]);
const emit = (key, args, result) => process.stdout.write(`${JSON.stringify({ key, args, ...result })}\n`);

async function pool(items, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }));
}

async function json(key, args) {
  const result = await cli(args);
  emit(key, args, result);
  try { return result.code === 0 ? JSON.parse(result.out) : null; } catch { return null; }
}

async function text(key, args) {
  emit(key, args, await cli(args));
}

const take = list => (SAMPLE ? list.slice(0, 3) : list);

// ---- Lists ----
const version = await cli(["--version"]);
emit("version", ["--version"], version);
const components = await json("list:components", ["component", "--list", "--detail", "compact", "--json"]);
const hooks = await json("list:hooks", ["hook", "--list", "--detail", "compact", "--json"]);
const templates = await json("list:templates", ["template", "--list", "--json"]);
await json("list:docs", ["docs", "--json"]);
await json("list:themes", ["theme", "list", "--json"]);

// ---- Components and hooks: structured and dense ----
const componentNames = Object.values(components?.data?.components ?? {}).flat().map(item => item.name);
await pool(take(componentNames), async name => {
  await json(`component:${name}`, ["component", name, "--json"]);
  await text(`component-dense:${name}`, ["component", name, "--dense"]);
});
const hookNames = Object.values(hooks?.data?.components ?? {}).flat().map(item => item.name);
await pool(take(hookNames), async name => text(`hook-dense:${name}`, ["hook", name, "--dense"]));

// ---- Docs tree: breadth first from the roots, each node as JSON (its children) and as text ----
const seen = new Set();
let frontier = [...DOC_ROOTS];
while (frontier.length) {
  const level = take(frontier.filter(route => !seen.has(route)));
  level.forEach(route => seen.add(route));
  const found = [];
  await pool(level, async route => {
    const node = await json(`doc:${route}`, ["docs", route, "--json"]);
    await text(`doc-full:${route}`, ["docs", route, "--full"]);
    await text(`doc-dense:${route}`, ["docs", route, "--full", "--dense"]);
    for (const slot of node?.data?.slots ?? []) for (const child of slot.children ?? []) if (typeof child.route === "string") found.push(child.route);
  });
  frontier = found;
}

// ---- Templates: the source a copy writes, and the skeleton of every page ----
const templateList = templates?.data ?? [];
await pool(take(templateList), async item => {
  await json(`template:${item.id}`, ["template", item.id, "--json"]);
  if (item.type === "page") await text(`skeleton:${item.id}`, ["template", item.id, "--skeleton"]);
});

// ---- The search index (plain JSON the CLI's own search ranks), and official build kits as fixtures ----
const indexScript = "const m = await import('@astryxdesign/cli/api'); process.stdout.write(JSON.stringify(await m.exportSearchIndex({ cwd: process.cwd() })));";
emit("search-index", ["exportSearchIndex"], await run(["--input-type=module", "-e", indexScript]));
await pool(take(BUILD_IDEAS), async idea => json(`build:${idea}`, ["build", idea, "--json"]));

process.stdout.write(`${JSON.stringify({ key: "done", args: [], code: 0, out: String(seen.size), err: "" })}\n`);
