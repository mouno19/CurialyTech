import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The preview handler with a real workspace on disk: a nested build (frontend/dist) must serve its
// relative assets, which arrive without the ?dir= query the first request may have carried.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-preview-"));
process.env.AGENT_WORKSPACE_ROOT = tmp;
process.env.AGENT_SANDBOX = "none";
process.env.SESSION_SECRET = "s".repeat(40);

const TASK = "4c1d2e3f-1111-4222-8333-944455556666";
let base = "";
let server: import("node:http").Server;
let preview: typeof import("./agent/preview");

beforeAll(async () => {
  const root = path.join(tmp, TASK);
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write("frontend/package.json", "{}");
  write("frontend/dist/index.html", '<!doctype html><script type="module" src="./assets/index-AbCd1234.js"></script>');
  write("frontend/dist/assets/index-AbCd1234.js", "console.log('built');");
  // A dev-server template at the root must not be what a nested build's assets resolve against.
  write("index.html", '<!doctype html><script type="module" src="/src/main.tsx"></script>');
  preview = await import("./agent/preview");
  const express = (await import("express")).default;
  const app = express();
  app.use("/api/workspace/preview/:taskId/:token", preview.previewHandler);
  server = await new Promise(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("workspace preview handler", () => {
  it("serves a nested build's relative assets from the folder signed into the token", async () => {
    const token = preview.previewToken(TASK, 600, "frontend/dist");
    expect(preview.verifyPreviewToken(TASK, token)).toBe(true);
    expect(preview.previewTokenDir(token)).toBe("frontend/dist");
    const page = await fetch(`${base}/api/workspace/preview/${TASK}/${token}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("./assets/index-AbCd1234.js");
    const asset = await fetch(`${base}/api/workspace/preview/${TASK}/${token}/assets/index-AbCd1234.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("built");
    expect(asset.headers.get("content-security-policy")).toMatch(/^sandbox/);
    // The sandboxed page has an opaque origin: its module scripts, crossorigin CSS and fonts are CORS loads.
    expect(asset.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects a token whose signed folder was changed", async () => {
    const token = preview.previewToken(TASK, 600, "frontend/dist");
    const [expires, mac] = token.split(".");
    const forged = `${expires}.${mac}.${Buffer.from("..").toString("base64url")}`;
    expect(preview.verifyPreviewToken(TASK, forged)).toBe(false);
    expect((await fetch(`${base}/api/workspace/preview/${TASK}/${forged}/`)).status).toBe(403);
  });

  it("keeps tokens without a folder valid and picks the built site by default", async () => {
    const token = preview.previewToken(TASK, 600);
    expect(preview.previewTokenDir(token)).toBe("");
    const asset = await fetch(`${base}/api/workspace/preview/${TASK}/${token}/assets/index-AbCd1234.js`);
    expect(asset.status).toBe(200);
  });
});
