import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseChoice, resolveTheme, THEME_COLOR, THEME_KEY } from "./theme";

describe("theme choice", () => {
  it("keeps light or dark, and anything else (nothing stored, old or odd values) means the device decides", () => {
    expect(parseChoice("light")).toBe("light");
    expect(parseChoice("dark")).toBe("dark");
    for (const value of [null, undefined, "", "system", "Dark", "auto", 1]) expect(parseChoice(value)).toBe("system");
  });

  it("follows the device only when the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("is applied before the first paint by index.html with the same key and colors", () => {
    // The inline script can't import this module: it repeats the key, the rule and the colors.
    const html = fs.readFileSync(path.resolve(import.meta.dirname, "../../index.html"), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain(`localStorage.getItem("${THEME_KEY}")`);
    expect(script).toContain('"(prefers-color-scheme: dark)"');
    expect(script).toContain(`dark ? "${THEME_COLOR.dark}" : "${THEME_COLOR.light}"`);
    // The page background of each theme, as tokens.css defines it.
    const tokens = fs.readFileSync(path.resolve(import.meta.dirname, "../styles/tokens.css"), "utf8");
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
    expect(tokens).toMatch(new RegExp(`--paper: ${THEME_COLOR.light};`));
    expect(dark).toMatch(new RegExp(`--paper: ${THEME_COLOR.dark};`));
  });
});
