import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { accountOf, rateLimited, requireUser } from "./auth";
import { query } from "./db/pg";
import { encryptionKey, seal, unseal } from "./services/sealed";

// Secrets an account saves for its tasks (the Secrets page): API keys and the like, AES-256-GCM
// encrypted with TOKEN_ENCRYPTION_KEY. Names come back to the browser, values never do; a task
// gets a value only as an environment variable of its commands, and never in the model's view.

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MIN_SECRET_CHARS = 6;
export const MAX_SECRET_CHARS = 16_384;
export const MAX_SECRETS = 50;

/** Variables a command depends on: a secret can't replace them. */
const RESERVED = new Set(["PATH", "HOME", "SHELL", "USER", "LANG", "TERM", "PWD", "TMPDIR", "CI", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH", "BASH_ENV", "ENV", "IFS", "PS4"]);

export const secretName = z.string().trim().toUpperCase().regex(SECRET_NAME, "Use capital letters, digits and _, starting with a letter (like STRIPE_API_KEY).").refine(name => !RESERVED.has(name) && !name.startsWith("GIT_") && !name.startsWith("CURIALY_"), "That name is reserved for the system.");
export const secretValue = z.string().min(MIN_SECRET_CHARS, `A secret has at least ${MIN_SECRET_CHARS} characters.`).max(MAX_SECRET_CHARS, "That secret is too long.").refine(value => !value.includes("\u0000"), "That secret has an invalid character.");

export class SecretError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const secretsConfigured = () => encryptionKey() !== null;

export type SecretInfo = { name: string; note: string | null; createdAt: string; updatedAt: string; lastUsedAt: string | null };

type Row = { name: string; note: string | null; ciphertext: Buffer; iv: Buffer; tag: Buffer; created_at: Date; updated_at: Date; last_used_at: Date | null };

const info = (row: Row): SecretInfo => ({ name: row.name, note: row.note, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null });

export async function listSecrets(userId: string): Promise<SecretInfo[]> {
  const { rows } = await query<Row>("SELECT name, note, created_at, updated_at, last_used_at FROM curialy.user_secrets WHERE user_id = $1 ORDER BY name", [userId]);
  return rows.map(info);
}

export async function savedSecretNames(userId: string): Promise<string[]> {
  const { rows } = await query<{ name: string }>("SELECT name FROM curialy.user_secrets WHERE user_id = $1 ORDER BY name", [userId]);
  return rows.map(row => row.name);
}

/** Add or replace one (at most MAX_SECRETS per account). */
export async function saveSecret(userId: string, name: string, value: string, note: string | null = null) {
  if (!secretsConfigured()) throw new SecretError("Secrets aren't set up on this server.", 503);
  const sealed = seal(value);
  const { rows } = await query<{ name: string }>(
    `INSERT INTO curialy.user_secrets (user_id, name, note, ciphertext, iv, tag)
     SELECT $1, $2, $3, $4, $5, $6 WHERE (SELECT count(*) FROM curialy.user_secrets WHERE user_id = $1 AND name <> $2) < $7
     ON CONFLICT (user_id, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, tag = EXCLUDED.tag,
       note = COALESCE(EXCLUDED.note, curialy.user_secrets.note), updated_at = now()
     RETURNING name`,
    [userId, name, note, sealed.ciphertext, sealed.iv, sealed.tag, MAX_SECRETS],
  );
  if (!rows.length) throw new SecretError(`An account can save at most ${MAX_SECRETS} secrets. Delete one first.`, 409);
}

export async function deleteSecret(userId: string, name: string) {
  const { rowCount } = await query("DELETE FROM curialy.user_secrets WHERE user_id = $1 AND name = $2", [userId, name]);
  return (rowCount ?? 0) > 0;
}

/** A saved value for a task of this account (null: none by that name, or it no longer decrypts). */
export async function loadSecret(userId: string, name: string): Promise<string | null> {
  const { rows: [row] } = await query<Row>("UPDATE curialy.user_secrets SET last_used_at = now() WHERE user_id = $1 AND name = $2 RETURNING *", [userId, name]);
  if (!row) return null;
  try {
    return unseal({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag });
  } catch {
    console.error(`[secrets] a saved secret no longer decrypts (key changed?): ${name}`);
    return null;
  }
}

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  fn(req, res).catch(error => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
    if (error instanceof SecretError) return res.status(error.status).json({ error: error.message });
    // Never the request body: it holds the value.
    console.error("[secrets]", error instanceof Error ? error.name : "error");
    res.status(500).json({ error: "Something went wrong. Try again." });
  });
};

export function secretsRouter() {
  const router = Router();
  router.use(requireUser);

  router.get("/", handle(async (req, res) => {
    res.json({ configured: secretsConfigured(), secrets: await listSecrets(accountOf(req).id), limits: { max: MAX_SECRETS, minChars: MIN_SECRET_CHARS } });
  }));

  router.put("/:name", handle(async (req, res) => {
    const user = accountOf(req);
    if (rateLimited(`secrets:${user.id}`, 60)) return res.status(429).json({ error: "Too many changes in a row. Wait a few minutes, then try again." });
    const name = secretName.parse(req.params.name);
    const body = z.object({ value: secretValue, note: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    await saveSecret(user.id, name, body.value, body.note || null);
    res.json({ saved: true, name });
  }));

  router.delete("/:name", handle(async (req, res) => {
    const name = secretName.parse(req.params.name);
    res.json({ deleted: await deleteSecret(accountOf(req).id, name) });
  }));

  return router;
}
