// Reads a staged component file's definitions and React code generators by running its inline
// scripts in an isolated V8 context with inert stand-ins for the browser and chart libraries
// (no DOM, no network, no require/process). Only strings and JSON cross back to the importer.
// Usage (child process): node evaluate.cjs <file.html> '<json request>' → JSON on stdout.
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");

const [file, rawRequest] = process.argv.slice(2);
const request = JSON.parse(rawRequest);
const html = fs.readFileSync(file, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(code => code.trim() && !code.includes("__codeletBootstrap__"));

const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
// The stand-in: any property, call or construction gives itself back; it reads as "" or 0.
vm.runInContext(`
  const inert = new Proxy(function inert() {}, {
    get: (target, key) => key === Symbol.toPrimitive ? (hint => hint === "number" ? 0 : "") : key === Symbol.iterator ? function* () {} : key === "then" ? undefined : key === "length" ? 0 : inert,
    apply: () => inert, construct: () => inert, set: () => true, has: () => false, deleteProperty: () => true,
  });
  globalThis.window = globalThis; globalThis.self = globalThis;
  for (const name of ["document", "navigator", "location", "localStorage", "sessionStorage", "Chart", "React", "ReactDOM", "lucide", "echarts", "d3", "L", "THREE", "IntersectionObserver", "ResizeObserver", "MutationObserver", "getComputedStyle", "matchMedia", "addEventListener", "removeEventListener", "performance", "Image", "devicePixelRatio", "innerWidth", "innerHeight", "scrollTo", "CustomEvent", "Event", "HTMLElement", "Node", "alert", "console"]) globalThis[name] = inert;
  globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => 0;
  globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => 0; globalThis.setInterval = () => 0; globalThis.clearInterval = () => 0;
  globalThis.queueMicrotask = () => {};
  globalThis.fetch = () => new Promise(() => {});
`, context);

const errors = [];
scripts.forEach((code, index) => {
  const fixed = (request.fixes ?? []).filter(fix => fix.script === index).reduce((text, fix) => text.split(fix.find).join(fix.replace), code);
  try {
    new vm.Script(fixed, { filename: `script-${index}.js` }).runInContext(context, { timeout: 5000 });
  } catch (error) {
    errors.push(`script ${index}: ${String(error && error.message || error).slice(0, 200)}`);
  }
});

// Each family asks for its definition arrays and the generator to call on each item.
const out = { errors, families: {} };
const read = name => vm.runInContext(`typeof ${name} === "undefined" ? undefined : ${name}`, context);
for (const ask of request.arrays) {
  const items = read(ask.array);
  if (!Array.isArray(items)) { out.families[ask.array] = { missing: true }; continue; }
  const generator = ask.generator ? read(ask.generator) : null;
  const renderer = ask.renderer ? read(ask.renderer) : null;
  out.families[ask.array] = {
    items: items.map((item, index) => {
      let react = null;
      let reactError = null;
      if (typeof generator === "function") {
        try { react = String(generator(item, index)); } catch (error) { reactError = String(error && error.message || error).slice(0, 200); }
      }
      // Functions (option builders, components) are kept as their source text.
      const data = JSON.parse(JSON.stringify(item, (key, value) => typeof value === "function" ? `[function ${value.name || "anonymous"}]` : value));
      let rendered = null;
      if (typeof renderer === "function") {
        try { rendered = String(renderer(item, index)); } catch (error) { rendered = null; }
      }
      return { index, data, react, reactError, rendered };
    }),
  };
}
for (const name of request.sources ?? []) {
  const value = read(name);
  out[`source:${name}`] = typeof value === "function" ? value.toString() : value === undefined ? null : JSON.stringify(value);
}
process.stdout.write(JSON.stringify(out));
