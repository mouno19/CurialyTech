// Runs inside scripts/astryx/jail.sh. For each first-party theme, makes a scratch app in the jail's
// private /tmp (its node_modules a link to the staged project's), runs `astryx theme add <slug>` there
// and prints every file the CLI wrote, so the snapshot's setup recipe matches what the CLI generates.
// Output: one JSON line per theme {key, args, code, out, err, files}. Node builtins only.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT = "/srv/stage/project";
const CLI = `${PROJECT}/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs`;
const THEMES = ["neutral", "butter", "chocolate", "gothic", "matcha", "stone", "y2k"];

function run(args, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", chunk => { if (out.length < 1_000_000) out += chunk; });
    child.stderr.on("data", chunk => { if (err.length < 4000) err += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function walk(dir, base = dir, files = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, files);
    else if (entry.isFile()) files[path.relative(base, full)] = fs.readFileSync(full, "utf8").slice(0, 200_000);
  }
  return files;
}

const staged = JSON.parse(fs.readFileSync(`${PROJECT}/package.json`, "utf8"));
for (const slug of THEMES) {
  const app = fs.mkdtempSync(`/tmp/app-${slug}-`);
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: `app-${slug}`, private: true, type: "module", dependencies: staged.dependencies }, null, 2));
  fs.symlinkSync(`${PROJECT}/node_modules`, path.join(app, "node_modules"));
  fs.mkdirSync(path.join(app, "src"));
  fs.writeFileSync(path.join(app, "src", "main.tsx"), "export {};\n");
  const before = walk(app);
  const result = await run([CLI, "theme", "add", slug, "--json"], app);
  const after = walk(app);
  const files = Object.fromEntries(Object.entries(after).filter(([file, content]) => before[file] !== content));
  process.stdout.write(`${JSON.stringify({ key: `theme-add:${slug}`, args: ["theme", "add", slug, "--json"], ...result, files })}\n`);
}
