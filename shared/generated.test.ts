import { describe, expect, it } from "vitest";
import { generatedRoot, isGeneratedPath, looksLikeBuildOutput, splitGenerated, summarizeGenerated } from "./generated";

describe("isGeneratedPath", () => {
  it("recognises bundles, hashed assets, source maps and built pages", () => {
    for (const path of [
      "frontend/dist/assets/Chat-BSEziAk6.js",
      "assets/hls-Cxumxs-1.js",
      "frontend/dist/assets/hls-Cxumxs-1.js",
      "assets/index-7hlOrPdg.css",
      "assets/LiveCommentary-nB1llD0_.js",
      "assets/MatchActionRow-DivAYIUg.js",
      "main.3f9a1c2b.js",
      "build/static/js/main.3f9a1c2b.js",
      "x.js.map",
      "dist/index.html",
      "./dist/index.html",
      "frontend\\dist\\index.html",
      "node_modules/react/index.js",
      "package-lock.json",
      "coverage/lcov-report/index.html",
    ]) expect(isGeneratedPath(path), path).toBe(true);
  });

  it("keeps sources and deliverables", () => {
    for (const path of [
      "src/App.tsx",
      "README.md",
      "out/report.pdf",
      "dist/release.zip",
      "scripts/build/run.ts",
      "src/assets/logo.png",
      "src/assets/hero-image.png",
      "src/main.tsx",
      "index.html",
      "docs/guide.md",
    ]) expect(isGeneratedPath(path), path).toBe(false);
  });
});

describe("generated summaries", () => {
  it("groups by the outermost generated directory", () => {
    expect(generatedRoot("frontend/dist/assets/a.js")).toBe("frontend/dist");
    expect(generatedRoot("build/dist/x.js")).toBe("build");
    expect(generatedRoot("assets/Chat-BSEziAk6.js")).toBe("assets");
    expect(generatedRoot("x.js.map")).toBe(".");
    const summary = summarizeGenerated([
      { path: "frontend/dist/assets/Chat-BSEziAk6.js", size: 100 },
      { path: "frontend/dist/assets/index-7hlOrPdg.css", size: 50 },
      { path: "frontend/dist/index.html", size: 10 },
      { path: "dist/main.3f9a1c2b.js", size: 5 },
      { path: "x.js.map" },
    ]);
    expect(summary).toEqual({ count: 5, bytes: 165, dirs: [{ dir: "frontend/dist", count: 3 }, { dir: ".", count: 1 }, { dir: "dist", count: 1 }] });
  });

  it("splits a file list into kept and generated", () => {
    const { kept, generated } = splitGenerated([{ path: "src/App.tsx" }, { path: "dist/assets/App-BSEziAk6.js" }, { path: "report.pdf" }]);
    expect(kept.map(file => file.path)).toEqual(["src/App.tsx", "report.pdf"]);
    expect(generated.map(file => file.path)).toEqual(["dist/assets/App-BSEziAk6.js"]);
  });
});

describe("looksLikeBuildOutput", () => {
  it("recognises a typical build listing", () => {
    const vite = [
      "vite v5.4.10 building for production...",
      "✓ 1532 modules transformed.",
      "dist/index.html                   0.46 kB │ gzip:  0.30 kB",
      "dist/assets/index-7hlOrPdg.css   12.34 kB │ gzip:  3.21 kB",
      "dist/assets/index-BSEziAk6.js   145.67 kB │ gzip: 46.78 kB",
      "✓ built in 2.34s",
    ].join("\n");
    expect(looksLikeBuildOutput(vite)).toBe(true);
    expect(looksLikeBuildOutput("added 214 packages in 9s\nnpm notice New minor version\nnpm WARN deprecated x@1\nnpm warn old lockfile")).toBe(true);
    // Hashed bundle names pasted into prose.
    expect(looksLikeBuildOutput("Built Chat-BSEziAk6.js, index-7hlOrPdg.css and MatchActionRow-DivAYIUg.js.")).toBe(true);
  });

  it("leaves prose and code alone", () => {
    expect(looksLikeBuildOutput("I added a login form and wired it to the API.\n\nRun `npm test` to check it.\nEverything passes.\nLet me know if you want changes.")).toBe(false);
    expect(looksLikeBuildOutput("export function add(a: number, b: number) {\n  return a + b;\n}\n\nconsole.log(add(1, 2));")).toBe(false);
    expect(looksLikeBuildOutput("The build is in dist/. Open dist/index.html to view it.")).toBe(false);
    expect(looksLikeBuildOutput("")).toBe(false);
  });
});
