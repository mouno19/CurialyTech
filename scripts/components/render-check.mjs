// Renders every component's preview page in a cloud browser and records whether it really draws:
// an SVG with marks, a canvas with painted pixels, or visible content, and no page errors. The
// result goes into each component.json (quality.rendered, quality.notes); screenshots go to --out.
//   BROWSERBASE_API_KEY=… BROWSERBASE_PROJECT_ID=… node scripts/components/render-check.mjs [--only graph-0] [--out /tmp/shots]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, credentialsFromEnv, makeRedactor, releaseSession } from "../ui-check/browserbase.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(HERE, "../../component-library/components");
const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const ONLY = arg("--only");
const OUT = arg("--out");
const SETTLE_MS = 3500;

const creds = credentialsFromEnv();
if (!creds) throw new Error("Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.");
const redact = makeRedactor([creds.apiKey, creds.projectId]);
if (OUT) fs.mkdirSync(OUT, { recursive: true });

const ids = fs.readdirSync(COMPONENTS).filter(id => (!ONLY || id.startsWith(ONLY)) && fs.existsSync(path.join(COMPONENTS, id, "preview.html"))).sort();
const { chromium } = await import("playwright-core");
const session = await createSession(creds, { width: 1280, height: 900, timeout: 3600 }, redact);
const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 60_000 });
const context = browser.contexts()[0] ?? await browser.newContext();
const results = [];
try {
  for (const id of ids) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(`page error: ${String(error.message).slice(0, 200)}`));
    page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`); });
    const started = Date.now();
    let facts = null;
    try {
      await page.setContent(fs.readFileSync(path.join(COMPONENTS, id, "preview.html"), "utf8"), { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(SETTLE_MS);
      facts = await page.evaluate(() => {
        const root = document.querySelector("[data-component]");
        const box = root?.getBoundingClientRect();
        const svgs = [...root.querySelectorAll("svg")].filter(svg => svg.getBoundingClientRect().width > 40 && svg.querySelectorAll("path,rect,circle,line,polyline,polygon,text").length > 2);
        const canvases = [...root.querySelectorAll("canvas")].filter(canvas => canvas.width > 40 && canvas.height > 40);
        let painted = 0;
        for (const canvas of canvases) {
          try {
            const context2d = canvas.getContext("2d");
            if (!context2d) { painted++; continue; } // a WebGL canvas: counted when present
            const { data } = context2d.getImageData(0, 0, canvas.width, canvas.height);
            const colors = new Set();
            for (let index = 0; index < data.length && colors.size < 8; index += 4 * 97) if (data[index + 3]) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
            if (colors.size >= 2) painted++;
          } catch { painted++; }
        }
        const leaflet = root.querySelectorAll(".leaflet-tile-loaded, .leaflet-interactive").length;
        const text = (root.innerText || "").trim().length;
        return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0), svgs: svgs.length, canvases: canvases.length, painted, leaflet, text, elements: root.querySelectorAll("*").length };
      });
      if (OUT) await page.locator("[data-component]").first().screenshot({ path: path.join(OUT, `${id}.png`), timeout: 15_000 }).catch(() => undefined);
    } catch (error) {
      errors.push(`load: ${redact(error.message).split("\n")[0].slice(0, 200)}`);
    }
    await page.close().catch(() => undefined);
    // Markup blocks (a top bar, a list of cards) draw nothing but text and elements.
    const drew = Boolean(facts && facts.height > 40 && (facts.svgs > 0 || facts.painted > 0 || facts.leaflet > 0 || (facts.elements >= 4 && facts.text > 20)));
    const rendered = drew && !errors.some(error => error.startsWith("page error") || error.startsWith("load"));
    results.push({ id, rendered, facts, errors, ms: Date.now() - started });
    console.log(`${rendered ? "ok  " : "FAIL"} ${id.padEnd(34)} ${facts ? `${facts.width}x${facts.height} svg ${facts.svgs} canvas ${facts.painted}/${facts.canvases}${facts.leaflet ? ` map ${facts.leaflet}` : ""} text ${facts.text}` : "-"}${errors.length ? `  ${errors.slice(0, 2).join(" | ")}` : ""}`);
    // Record the result with the component.
    const file = path.join(COMPONENTS, id, "component.json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    meta.quality = { ...meta.quality, rendered, checked_at: new Date().toISOString().slice(0, 10), notes: [...(meta.quality?.notes ?? []).filter(note => !note.startsWith("render:")), ...(rendered ? [] : [`render: ${errors[0] ?? "nothing visible was drawn"}`])] };
    if (!rendered && meta.status === "active") meta.status = "needs-review";
    if (rendered && meta.status === "needs-review" && !(meta.quality.notes ?? []).length) meta.status = "active";
    fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
  }
} finally {
  await browser.close().catch(() => undefined);
  await releaseSession(creds, session.id, redact).catch(error => console.error(error.message));
}
const failed = results.filter(result => !result.rendered);
console.log(`\n${results.length - failed.length}/${results.length} rendered${failed.length ? `; not rendered: ${failed.map(result => result.id).join(", ")}` : ""}`);
