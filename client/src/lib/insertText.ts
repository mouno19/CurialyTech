/**
 * `text` put into `value` in place of the selection (or at the end when there is none), with a
 * space on either side where it would otherwise run into a word. Used for dictated text.
 */
export function insertAtCursor(value: string, text: string, selection: { start: number; end: number } | null) {
  const start = Math.min(selection?.start ?? value.length, value.length);
  const end = Math.min(selection?.end ?? value.length, value.length);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const glue = before && !/\s$/.test(before) ? " " : "";
  return `${before}${glue}${text}${after && !/^\s/.test(after) ? " " : ""}${after}`;
}
