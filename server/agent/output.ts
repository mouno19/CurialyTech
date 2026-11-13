import { clip } from "./sandbox";

// What the model reads of a command's output. The user sees every line live in the run log; the
// conversation keeps only what helps the next step (the first lines, the lines that look like
// errors, the last lines), so a long install or build log never rides along in every later turn.

/** Terminal control sequences: colours, cursor moves, window titles. */
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Lines that usually carry the cause of a failure: compilers, test runners, package managers, tracebacks. */
const ERROR_LINE = /\berr!|\b(?:errors?|fail(?:ed|ure|s|ing)?|fatal|exception|traceback|panic(?:ked)?|cannot|can't|could not|unable to|not found|no such file|denied|refused|segmentation fault|aborted|assertion|expected|unexpected|unhandled|invalid|missing)\b|ERR_[A-Z_]+|\bTS\d{4}\b|^\s*at .+:\d+(?::\d+)?\)?$|^\s*File ".+", line \d+|^E\s|^\s*[✗✖×✘]\s|[\w./@-]+\.[A-Za-z]{1,5}:\d+(?::\d+)?\b/i;

const HEAD_LINES = 10;
const TAIL_LINES = 30;
/** Error lines kept from the middle, with the two lines after each (a message often spans a few). */
const MAX_ERROR_LINES = 40;

/** Strip control sequences, keep only the last state of lines a progress bar redrew, and fold repeats. */
export function sanitizeOutput(text: string) {
  const lines = text.replace(ANSI, "").replace(/\r\n/g, "\n").split("\n").map(line => {
    const trimmed = line.replace(/\r+$/, "");
    return trimmed.slice(trimmed.lastIndexOf("\r") + 1);
  });
  const out: string[] = [];
  let repeats = 0;
  const fold = () => {
    if (repeats) out[out.length - 1] += ` [repeated ${repeats} more time${repeats === 1 ? "" : "s"}]`;
    repeats = 0;
  };
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (out.length && line === previous && line.trim()) { repeats++; continue; }
    fold();
    // Blank runs fold to one blank line.
    if (!line.trim() && out.length && !previous?.trim()) continue;
    out.push(line);
  }
  fold();
  return out.join("\n");
}

/**
 * A long log as the model needs it: the first lines, the error lines from the middle (with a little
 * context) and the last lines, marking what was left out. Short output comes back whole.
 */
/** rest: how to get what was left out (for a command: redirect it to a file). */
export function digestOutput(text: string, opts: { head?: number; tail?: number; maxChars?: number; rest?: string } = {}) {
  const head = opts.head ?? HEAD_LINES;
  const tail = opts.tail ?? TAIL_LINES;
  const maxChars = opts.maxChars ?? 6000;
  const lines = sanitizeOutput(text).split("\n");
  if (lines.length <= head + tail + 10) return clip(lines.join("\n"), maxChars);
  const middleEnd = lines.length - tail;
  const keep = new Set<number>();
  for (let index = head; index < middleEnd && keep.size < MAX_ERROR_LINES; index++) {
    if (!ERROR_LINE.test(lines[index])) continue;
    for (let offset = 0; offset <= 2 && index + offset < middleEnd; offset++) keep.add(index + offset);
  }
  const out = lines.slice(0, head);
  let skipped = 0;
  for (let index = head; index < middleEnd; index++) {
    if (!keep.has(index)) { skipped++; continue; }
    if (skipped) out.push(`… [${skipped} line${skipped === 1 ? "" : "s"} omitted] …`);
    skipped = 0;
    out.push(lines[index]);
  }
  if (skipped) out.push(`… [${skipped} line${skipped === 1 ? "" : "s"} omitted] …`);
  out.push(...lines.slice(middleEnd));
  return clip(`[Long output: the first ${head} lines, the lines that look like errors, and the last ${tail}. ${opts.rest ?? "Redirect it to a file and read_file that for the rest."}]\n${out.join("\n")}`, maxChars);
}

/** Commands whose output is the answer (file contents, diffs, listings, searches): kept whole, up to a size. */
const INSPECT = /^(?:sudo\s+)?(?:cat|head|tail|sed|awk|grep|egrep|rg|ls|find|tree|nl|wc|jq|yq|diff|cmp|file|stat|du|df|which|type|echo|printf|pwd|env|printenv|uname|whoami|id|date|cut|sort|uniq|tr|column|xxd|od|strings|readlink|realpath|basename|dirname|git\s+(?:diff|show|log|status|blame|ls-files|branch|remote|rev-parse|grep|config)|node\s+-[ep]|python3?\s+-c)\b/;
const INSPECT_MAX = 16_000;

/** Whether every part of a command line only looks at things (cd and cat, grep or git diff and the like). */
export function isInspection(command: string) {
  const parts = command.split(/&&|\|\||[;|\n]/).map(part => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => /^cd\s/.test(part) || INSPECT.test(part));
}

/** A command's output as the model gets it in the tool result. */
export function commandOutput(command: string, output: string, ok: boolean) {
  return isInspection(command) ? clip(sanitizeOutput(output), INSPECT_MAX) : digestOutput(output, { maxChars: ok ? 4000 : 8000 });
}
