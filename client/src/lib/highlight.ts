import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Only the core plus a dozen common grammars, to keep the bundle (and the slow VPS build) small.
const LANGS = { bash, css, go, javascript, json, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, grammar] of Object.entries(LANGS)) hljs.registerLanguage(name, grammar);

const EXTENSIONS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", py: "python", go: "go", rs: "rust", sql: "sql", css: "css", scss: "css", html: "xml", xml: "xml", svg: "xml",
  md: "markdown", yml: "yaml", yaml: "yaml", sh: "bash", bash: "bash", zsh: "bash",
};

const ALIASES: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", sh: "bash", shell: "bash", html: "xml", yml: "yaml", tsx: "typescript", jsx: "javascript" };

export function languageForPath(path: string) {
  return EXTENSIONS[path.split(".").pop()?.toLowerCase() ?? ""];
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Highlighted HTML for one code string; falls back to escaped text for unknown languages. */
export function highlight(code: string, language?: string) {
  const lang = language ? ALIASES[language] ?? language : undefined;
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
  }
  return escape(code);
}
