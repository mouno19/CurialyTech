// File storage failures, classified once and handled the same way everywhere: neutral public text
// (no vendor, database or stage names), a circuit breaker so an outage costs one probe instead of a
// warehouse query per thumbnail, and log lines without tokens or signed URLs.

export type StorageFailure = "not_configured" | "unauthorized" | "stage_missing" | "unreachable" | "object_missing" | "rejected";

const PUBLIC_MESSAGE: Record<StorageFailure, string> = {
  not_configured: "File storage is not configured on this server.",
  unauthorized: "File storage is not available: this server's access to it was refused. An operator needs to fix the storage setup.",
  stage_missing: "File storage is not set up yet: the storage location is missing or this server may not use it. An operator needs to run the storage setup.",
  unreachable: "File storage is temporarily unreachable.",
  object_missing: "This file is no longer available.",
  rejected: "File storage could not process this file.",
};

export class StorageError extends Error {
  constructor(readonly kind: StorageFailure, readonly retryAfterSec = 0, readonly internal?: string) {
    super(PUBLIC_MESSAGE[kind]);
    this.name = "StorageError";
  }
  /** Outages (as opposed to a missing object or a bad file). */
  get unavailable() {
    return this.kind === "not_configured" || this.kind === "unauthorized" || this.kind === "stage_missing" || this.kind === "unreachable";
  }
}

export const publicStorageMessage = (kind: StorageFailure) => PUBLIC_MESSAGE[kind];

type SdkLike = { code?: string | number; sqlState?: string; name?: string; message?: string; status?: number; cause?: unknown };

/** Map a driver, network or HTTP error to a failure kind (SDK codes first, then message patterns). */
export function classifyStorageError(error: unknown): StorageFailure {
  if (error instanceof StorageError) return error.kind;
  const e = (error ?? {}) as SdkLike;
  const code = String(e.code ?? "");
  const message = String(e.message ?? error ?? "");
  if (e.name === "AbortError" || e.name === "TimeoutError" || /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|UND_ERR)/.test(code)) return "unreachable";
  if (code === "002003" || code === "003001" || code === "391707" || e.sqlState === "02000" || /does not exist or (is )?not authorized|insufficient privileges/i.test(message)) return "stage_missing";
  if (/^390\d{3}$/.test(code) || /incorrect username or password|invalid (oauth|programmatic access) token|token (is )?(invalid|expired)|authentication failed|role .* (does not exist|is not granted)/i.test(message)) return "unauthorized";
  if (/^40100[1-4]$/.test(code) || /network error|could not reach|socket hang up|fetch failed|timed? ?out|temporarily unavailable|service unavailable|\b50[234]\b/i.test(message)) return "unreachable";
  if (/not configured/i.test(message)) return "not_configured";
  return "rejected";
}

/** First line of an error, without URLs or credentials, for the server log. */
export function redact(text: string) {
  return text.split("\n")[0]
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b(token|signature|sig|password|X-Amz-[A-Za-z-]+|t)=[^&\s"']+/gi, "$1=<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*/g, "<jwt>")
    .slice(0, 240);
}

/** Never log a raw driver error object: they can carry request bodies with the access token. */
export function logStorageError(op: string, error: unknown) {
  const e = (error ?? {}) as SdkLike;
  console.error(`[vault] ${op} failed: kind=${classifyStorageError(error)}${e.code ? ` code=${e.code}` : ""}${e.sqlState ? ` sqlState=${e.sqlState}` : ""} ${redact(String(e.message ?? error))}`);
}

// ---- Circuit breaker ----

const CONFIG_FAILURES = new Set<StorageFailure>(["not_configured", "unauthorized", "stage_missing"]);

export type BreakerSnapshot = { state: "ok" | "open"; kind: StorageFailure | null; retryAfterSec: number; since: number | null };

/**
 * Configuration failures open the breaker at once (60 s, doubling to 5 min); network failures open
 * it after two within 30 s (10 s, doubling to 2 min). A missing object never trips it. When the
 * window ends, exactly one caller probes; everyone else fails fast until the probe succeeds.
 */
export class StorageBreaker {
  private openUntil = 0;
  private kind: StorageFailure | null = null;
  private since: number | null = null;
  private windowMs = 0;
  private recentNetwork: number[] = [];
  private probing: Promise<boolean> | null = null;

  constructor(private now: () => number = Date.now) {}

  snapshot(): BreakerSnapshot {
    const open = this.kind !== null;
    return { state: open ? "open" : "ok", kind: this.kind, retryAfterSec: open ? Math.max(1, Math.ceil((this.openUntil - this.now()) / 1000)) : 0, since: this.since };
  }

  /** True when calls may go to storage now (closed, or the window has passed and this caller probes). */
  get isOpen() {
    return this.kind !== null;
  }

  windowPassed() {
    return this.kind !== null && this.now() >= this.openUntil;
  }

  succeeded() {
    this.kind = null;
    this.since = null;
    this.windowMs = 0;
    this.openUntil = 0;
    this.recentNetwork = [];
  }

  failed(kind: StorageFailure) {
    if (kind === "object_missing" || kind === "rejected") return;
    const now = this.now();
    if (!CONFIG_FAILURES.has(kind)) {
      this.recentNetwork = [...this.recentNetwork.filter(at => now - at < 30_000), now];
      if (this.kind === null && this.recentNetwork.length < 2) return;
    }
    const base = CONFIG_FAILURES.has(kind) ? 60_000 : 10_000;
    const cap = CONFIG_FAILURES.has(kind) ? 300_000 : 120_000;
    this.windowMs = this.kind === null ? base : Math.min(cap, Math.max(base, this.windowMs * 2));
    this.kind = kind;
    this.since ??= now;
    this.openUntil = now + this.windowMs;
  }

  /** Fail fast while open; after the window, let one probe through (single-flight). */
  async guard(probe: () => Promise<void>) {
    if (this.kind === null) return;
    if (!this.windowPassed()) throw new StorageError(this.kind, this.snapshot().retryAfterSec);
    this.probing ??= probe().then(() => { this.succeeded(); return true; }, error => { this.failed(classifyStorageError(error)); return false; }).finally(() => { this.probing = null; });
    const ok = await this.probing;
    if (!ok && this.kind) throw new StorageError(this.kind, this.snapshot().retryAfterSec);
  }
}
