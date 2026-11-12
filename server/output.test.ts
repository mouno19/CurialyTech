import { describe, expect, it } from "vitest";
import { commandOutput, digestOutput, isInspection, sanitizeOutput } from "./agent/output";

// What the model reads of a command's output: lean, but never missing the error.

const log = (lines: number, at: Record<number, string> = {}) => Array.from({ length: lines }, (_, index) => at[index] ?? `added package-${index}`).join("\n");

describe("command output for the model", () => {
  it("strips colours and progress redraws, and folds repeated lines", () => {
    const text = "\u001b[32mok\u001b[0m\nprogress 10%\rprogress 50%\rprogress 100%\nretrying\nretrying\nretrying\n\n\n\ndone\r\n";
    expect(sanitizeOutput(text)).toBe("ok\nprogress 100%\nretrying [repeated 2 more times]\n\ndone\n");
  });

  it("keeps a short log whole", () => {
    expect(digestOutput(log(30))).toBe(log(30));
  });

  it("keeps the first 10 lines, the error lines with a little context, and the last 30 of a long log", () => {
    const text = log(500, { 250: "src/App.tsx:14:7 - error TS2322: Type 'string' is not assignable to type 'number'.", 251: "  14 count = 'x'", 400: "npm ERR! code ELIFECYCLE" });
    const digest = digestOutput(text);
    const lines = digest.split("\n");
    expect(lines[0]).toMatch(/^\[Long output: the first 10 lines/);
    expect(lines.slice(1, 11)).toEqual(log(10).split("\n"));
    expect(digest).toContain("error TS2322");
    expect(digest).toContain("  14 count = 'x'");
    expect(digest).toContain("npm ERR! code ELIFECYCLE");
    expect(digest).toContain("added package-499");
    expect(digest).not.toContain("added package-100\n");
    expect(digest).toMatch(/… \[\d+ lines omitted\] …/);
    expect(lines.length).toBeLessThan(60);
  });

  it("never mistakes clock times for errors, and caps its size", () => {
    const text = log(400, { 200: "12:34:56 build step 3" });
    expect(digestOutput(text)).not.toContain("12:34:56");
    const wide = log(400).replace(/\n/g, `${"x".repeat(300)}\n`);
    expect(digestOutput(wide, { maxChars: 4000 }).length).toBeLessThan(4200);
  });

  it("keeps what an inspection command printed (file contents, diffs, searches), digests the rest", () => {
    expect(isInspection("cat src/App.tsx")).toBe(true);
    expect(isInspection("cd app && git diff -- src | head -400")).toBe(true);
    expect(isInspection("grep -rn foo src | sort | uniq")).toBe(true);
    expect(isInspection("npm install && cat package.json")).toBe(false);
    expect(isInspection("python3 build.py")).toBe(false);
    const file = log(300);
    expect(commandOutput("cat big.txt", file, true)).toBe(file);
    expect(commandOutput("npm install", file, true).length).toBeLessThan(4100);
  });
});
