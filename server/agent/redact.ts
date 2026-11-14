// Secret values out of text: every occurrence becomes "[secret NAME]". Pure helpers, used on
// command output (as it streams and as a whole), on every event a run stores or shows, and on
// what tools hand back to the model.

export type SecretValue = { name: string; value: string };

const mark = (name: string) => `[secret ${name}]`;

/** Longest values first, so one secret containing another is replaced whole. */
const ordered = (secrets: SecretValue[]) => secrets.filter(secret => secret.value).sort((a, b) => b.value.length - a.value.length);

export function redactText(text: string, secrets: SecretValue[]): string {
  if (!text || !secrets.length) return text;
  let out = text;
  for (const secret of ordered(secrets)) if (out.includes(secret.value)) out = out.split(secret.value).join(mark(secret.name));
  return out;
}

/** Every string inside a value (an event, a tool input), redacted; the same object when nothing matched. */
export function redactDeep<T>(value: T, secrets: SecretValue[]): T {
  if (!secrets.length) return value;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redactText(item, secrets);
    if (Array.isArray(item)) {
      const next = item.map(walk);
      return next.some((entry, index) => entry !== item[index]) ? next : item;
    }
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(item)) {
        next[key] = walk(inner);
        if (next[key] !== inner) changed = true;
      }
      return changed ? next : item;
    }
    return item;
  };
  return walk(value) as T;
}

/**
 * Redaction for output that arrives in pieces: a secret split across two chunks is still caught.
 * Holds back the end of the output that could be the start of a secret (at most its length - 1
 * characters) until the next chunk, or flush().
 */
export function streamRedactor(secrets: SecretValue[]) {
  const list = ordered(secrets);
  const keep = list.length ? list[0].value.length - 1 : 0;
  let buffer = "";
  return {
    push(chunk: string): string {
      if (!list.length) return chunk;
      buffer += chunk;
      let cut = buffer.length - keep;
      if (cut <= 0) return "";
      // Never cut through a whole occurrence: let it go out together, so it is replaced.
      for (let moved = true; moved; ) {
        moved = false;
        for (const secret of list) {
          for (let at = buffer.indexOf(secret.value); at !== -1 && at < cut; at = buffer.indexOf(secret.value, at + 1)) {
            if (at + secret.value.length > cut) { cut = at + secret.value.length; moved = true; }
          }
        }
      }
      const out = redactText(buffer.slice(0, cut), list);
      buffer = buffer.slice(cut);
      return out;
    },
    flush(): string {
      const out = redactText(buffer, list);
      buffer = "";
      return out;
    },
  };
}
