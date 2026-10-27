// Postgres jsonb rejects U+0000 ("unsupported Unicode escape sequence") and lone UTF-16 surrogates,
// and command output, fetched pages and model text can contain both. Everything that is stored as
// jsonb or text goes through these helpers so one bad byte cannot drop a batch of events or a
// conversation write.

const NUL = /\u0000/g;

export function cleanText(value: string) {
  return (value.includes("\u0000") ? value.replace(NUL, "") : value).toWellFormed();
}

/** JSON for a jsonb column: strings cleaned at every depth. */
export function toJsonb(value: unknown) {
  return JSON.stringify(value, (_key, item) => (typeof item === "string" ? cleanText(item) : item));
}

/** SQLSTATEs that will fail the same way on every retry (bad text or JSON), as opposed to transient errors. */
export function isDeterministicDataError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "22P05" || code === "22021" || code === "22P02" || code === "22023";
}
