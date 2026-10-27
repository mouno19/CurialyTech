/** Join class names, skipping falsy parts. (lib/utils' cn runs tailwind-merge, which can drop plain app classes.) */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
