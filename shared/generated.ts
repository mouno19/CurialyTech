// Recognising generated build output (bundles, hashed assets, source maps, coverage) so it stays
// out of the conversation: the server leaves it out of a run's attachments and the UI collapses it
// in older logs and in pasted build logs. Shared by client and server; no runtime dependencies.
import type { GeneratedSummary } from "./agent";

/** Directory names whose contents are produced by tools, not written by people. */
const GENERATED_DIRS = new Set([
  "dist", "build", "out", ".next", ".nuxt", ".output", ".svelte-kit", "storybook-static", "target", "coverage",
  "test-results", "playwright-report", ".turbo", ".parcel-cache", ".vite", "node_modules", "__pycache__", ".cache",
]);

/** Inside a generated directory these are still treated as sources (e.g. scripts/build/run.ts). */
const SOURCE_EXT = /\.(tsx?|mts|cts|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|astro|sql|sh|ya?ml|toml|md|mdx)$/i;

/** Deliverables that are never "build output", wherever they live (documents, data, packaged apps). */
const DELIVERABLE_EXT = /\.(pdf|zip|tar|tgz|gz|7z|docx?|xlsx?|pptx?|csv|odt|ods|epub|apk|aab|ipa|jar|war|ear|whl|egg|dmg|pkg|exe|msi|deb|rpm|appimage|nupkg|crx|xpi|vsix|snap)$/i;

/**
 * Vite/Rollup/webpack hashed code and fonts: Chat-BSEziAk6.js, index-7hlOrPdg.css, main.3f9a1c2b.js.
 * Images are left to the generated-folder rule: a hand-made src/assets/logo-Version2.png looks hashed.
 */
const HASHED_IN_ASSETS = /(^|\/)(assets|static\/(js|css|media)|chunks|_next\/static\/[^/]+)\/[^/]+[-.](?=[A-Za-z0-9_-]{8}\.)(?=[A-Za-z0-9_-]{0,7}[A-Z0-9])[A-Za-z0-9_-]{8}\.(m?js|cjs|css|woff2?|ttf|eot)$/;
const HEX_HASHED = /(^|\/)[^/]+\.[a-f0-9]{8,32}\.(m?js|css)$/;
const NOISE = /(^|\/)([^/]+\.(map|tsbuildinfo)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.DS_Store)$/;

export function isGeneratedPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (DELIVERABLE_EXT.test(normalized)) return false;
  if (NOISE.test(normalized) || HASHED_IN_ASSETS.test(normalized) || HEX_HASHED.test(normalized)) return true;
  const segments = normalized.split("/");
  const dirs = segments.slice(0, -1);
  if (dirs.some(segment => GENERATED_DIRS.has(segment))) return !SOURCE_EXT.test(normalized);
  return false;
}

/** The outermost generated directory a path sits in ("frontend/dist"), or its parent folder. */
export function generatedRoot(path: string) {
  const segments = path.replace(/\\/g, "/").split("/");
  const index = segments.slice(0, -1).findIndex(segment => GENERATED_DIRS.has(segment));
  if (index >= 0) return segments.slice(0, index + 1).join("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : ".";
}

export function summarizeGenerated(entries: { path: string; size?: number }[]): GeneratedSummary {
  const byDir = new Map<string, number>();
  let bytes = 0;
  for (const entry of entries) {
    const dir = generatedRoot(entry.path);
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    bytes += entry.size ?? 0;
  }
  const dirs = Array.from(byDir, ([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
  return { count: entries.length, bytes, dirs };
}

export function splitGenerated<T extends { path: string }>(files: T[]) {
  const kept: T[] = [];
  const generated: T[] = [];
  for (const file of files) (isGeneratedPath(file.path) ? generated : kept).push(file);
  return { kept, generated };
}

const BUILD_LINE = [
  /^\s*\S+\.(m?js|cjs|css|html|map|wasm|woff2?|svg|png|jpe?g)\s+[\d.,]+\s*[kKmM]?i?B\b/, // dist/assets/x.js  97.8 kB
  /\bgzip:\s*[\d.]+\s*[kKmM]?B\b/,
  /\bbuilt in\s+[\d.]+\s*m?s\b/i,
  /\bmodules? transformed\b/i,
  /^\s*vite v\d/i,
  /\bwebpack\s+\d+\.\d+/i,
  /\b(added|removed|changed) \d+ packages?\b/i,
  /^\s*npm (WARN|notice|warn)\b/,
  /^\s*(rendering chunks|computing gzip size|transforming)\b/i,
  /^\s*[✓✔]\s+\d+ modules/,
  /^\s*\(!\) Some chunks are larger/,
];

const HASHED_NAME = /[A-Za-z0-9_]+[-.](?=[A-Za-z0-9_-]{0,7}[A-Z0-9])[A-Za-z0-9_-]{8}\.(m?js|css)\b/g;

/** Whether a block of text is routine build/install chatter (worth collapsing, not deleting). */
export function looksLikeBuildOutput(text: string) {
  const lines = text.split("\n").map(line => line.trimEnd()).filter(Boolean);
  if (lines.length >= 4) {
    const matching = lines.filter(line => BUILD_LINE.some(pattern => pattern.test(line))).length;
    if (matching / lines.length >= 0.5) return true;
  }
  return (text.match(HASHED_NAME)?.length ?? 0) >= 3;
}
