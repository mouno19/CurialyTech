import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM with TOKEN_ENCRYPTION_KEY (32 random bytes, base64): stored Vercel refresh tokens,
// the secrets an account saves for its tasks, and the short-lived sign-in cookie.

/** TOKEN_ENCRYPTION_KEY: 32 random bytes, base64 (null when missing or the wrong size). */
export function encryptionKey() {
  const key = Buffer.from((process.env.TOKEN_ENCRYPTION_KEY ?? "").trim(), "base64");
  return key.length === 32 ? key : null;
}

export class SealError extends Error {}

export type Sealed = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

export function seal(text: string): Sealed {
  const key = encryptionKey();
  if (!key) throw new SealError("TOKEN_ENCRYPTION_KEY isn't set up on this server.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

/** Throws on a wrong key or tampered data (the tag doesn't verify). */
export function unseal(parts: Sealed): string {
  const key = encryptionKey();
  if (!key) throw new SealError("TOKEN_ENCRYPTION_KEY isn't set up on this server.");
  const decipher = createDecipheriv("aes-256-gcm", key, parts.iv);
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]).toString("utf8");
}

/** A small value sealed into one string: iv, tag and ciphertext, base64url. */
export function sealString(text: string) {
  const { ciphertext, iv, tag } = seal(text);
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function unsealString(value: string): string | null {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length < 29) return null;
    return unseal({ iv: bytes.subarray(0, 12), tag: bytes.subarray(12, 28), ciphertext: bytes.subarray(28) });
  } catch {
    return null;
  }
}
