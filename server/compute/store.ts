import { createHash, randomBytes } from "node:crypto";
import {
  COMPUTE_KIND_LABELS,
  isComputeKind,
  MAX_ENVIRONMENTS_PER_USER,
  type ComputeEnvironment,
  type ComputeKind,
  type ComputeSpecs,
  type CreateComputeEnvironmentRequest,
} from "@shared/compute";
import { toJsonb } from "../db/json";
import { db, query } from "../db/pg";

export class ComputeConfigError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type StoredEnvironmentRow = {
  id: string;
  user_id: string;
  name: string;
  kind: ComputeKind;
  work_dir: string | null;
  specs: ComputeSpecs | null;
  is_default: boolean;
  last_seen_at: Date | null;
  created_at: Date;
};

export function hashEnvironmentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateEnvironmentToken(): { token: string; tokenHash: string } {
  const token = `cur_env_${randomBytes(24).toString("base64url")}`;
  return { token, tokenHash: hashEnvironmentToken(token) };
}

export function normalizeWorkDir(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 240 || /[\0\r\n]/.test(trimmed)) {
    throw new ComputeConfigError("Working directory must be a valid Linux path.");
  }
  if (!trimmed.startsWith("/") && !trimmed.startsWith("~/")) {
    throw new ComputeConfigError("Working directory must start with / or ~/.");
  }
  const segments = trimmed.split("/");
  if (segments.some(seg => seg === "..")) {
    throw new ComputeConfigError("Working directory cannot contain '..' segments.");
  }
  return trimmed.replace(/\/+$/, "") || "/";
}

export function sanitizeSpecs(raw: unknown): ComputeSpecs | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const clampNum = (v: unknown, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : 0;
  };
  const cleanStr = (v: unknown, max: number, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
  return {
    os: cleanStr(obj.os, 120, "Linux"),
    arch: cleanStr(obj.arch, 32, "x64"),
    cpus: Math.max(1, Math.round(clampNum(obj.cpus, 512) || 1)),
    ramMb: Math.round(clampNum(obj.ramMb, 4_194_304)),
    ramAvailMb: Math.round(clampNum(obj.ramAvailMb, 4_194_304)),
    diskFreeGb: Math.round(clampNum(obj.diskFreeGb, 1_000_000) * 10) / 10,
    gpu: typeof obj.gpu === "string" && obj.gpu.trim() ? obj.gpu.trim().slice(0, 120) : null,
    hostname: cleanStr(obj.hostname, 120, "remote-host"),
    sudo: Boolean(obj.sudo),
    workBase: cleanStr(obj.workBase, 240, "/tmp/curialy-workspaces"),
  };
}

export function toEnvironmentSummary(
  row: StoredEnvironmentRow,
  live: { online: boolean; activeTasks: number; specs: ComputeSpecs | null },
): ComputeEnvironment {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    online: live.online,
    activeTasks: live.activeTasks,
    specs: live.specs ?? row.specs ?? null,
    workDir: row.work_dir,
    isDefault: row.is_default,
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLS = "id, user_id, name, kind, work_dir, specs, is_default, last_seen_at, created_at";

export async function listEnvironmentRows(userId: string): Promise<StoredEnvironmentRow[]> {
  const { rows } = await query<StoredEnvironmentRow>(
    `SELECT ${SELECT_COLS} FROM curialy.compute_environments WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
    [userId],
  );
  return rows;
}

export async function getEnvironmentRow(id: string, userId?: string): Promise<StoredEnvironmentRow | null> {
  const { rows } = userId
    ? await query<StoredEnvironmentRow>(`SELECT ${SELECT_COLS} FROM curialy.compute_environments WHERE id = $1 AND user_id = $2`, [id, userId])
    : await query<StoredEnvironmentRow>(`SELECT ${SELECT_COLS} FROM curialy.compute_environments WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getDefaultEnvironmentRow(userId: string): Promise<StoredEnvironmentRow | null> {
  const { rows } = await query<StoredEnvironmentRow>(
    `SELECT ${SELECT_COLS} FROM curialy.compute_environments WHERE user_id = $1 AND is_default = true LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function createEnvironmentRow(
  userId: string,
  input: CreateComputeEnvironmentRequest,
): Promise<{ row: StoredEnvironmentRow; token: string }> {
  if (!isComputeKind(input.kind)) throw new ComputeConfigError("Choose Google Colab or Personal VPS.");
  const workDir = normalizeWorkDir(input.workDir);
  const defaultLabel = COMPUTE_KIND_LABELS[input.kind];
  const rawName = (input.name ?? "").trim();
  const name = (rawName || defaultLabel).slice(0, 80);
  const makeDefault = input.isDefault ?? true;
  const { token, tokenHash } = generateEnvironmentToken();

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows: countRows } = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM curialy.compute_environments WHERE user_id = $1",
      [userId],
    );
    if (Number(countRows[0]?.count ?? 0) >= MAX_ENVIRONMENTS_PER_USER) {
      throw new ComputeConfigError(`You can save up to ${MAX_ENVIRONMENTS_PER_USER} compute environments. Remove an unused one first.`);
    }
    if (makeDefault) {
      await client.query("UPDATE curialy.compute_environments SET is_default = false, updated_at = now() WHERE user_id = $1 AND is_default = true", [userId]);
    }
    const { rows } = await client.query<StoredEnvironmentRow>(
      `INSERT INTO curialy.compute_environments (user_id, name, kind, token_hash, work_dir, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT_COLS}`,
      [userId, name, input.kind, tokenHash, workDir, makeDefault],
    );
    await client.query("COMMIT");
    return { row: rows[0], token };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateEnvironmentRow(
  userId: string,
  id: string,
  patch: { name?: string; workDir?: string | null; isDefault?: boolean },
): Promise<StoredEnvironmentRow | null> {
  const existing = await getEnvironmentRow(id, userId);
  if (!existing) return null;
  const nextName = patch.name !== undefined ? patch.name.trim().slice(0, 80) : existing.name;
  if (!nextName) throw new ComputeConfigError("Environment name cannot be empty.");
  const nextWorkDir = patch.workDir !== undefined ? normalizeWorkDir(patch.workDir) : existing.work_dir;
  const nextDefault = patch.isDefault !== undefined ? Boolean(patch.isDefault) : existing.is_default;

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    if (nextDefault && !existing.is_default) {
      await client.query("UPDATE curialy.compute_environments SET is_default = false, updated_at = now() WHERE user_id = $1 AND is_default = true", [userId]);
    }
    const { rows } = await client.query<StoredEnvironmentRow>(
      `UPDATE curialy.compute_environments
       SET name = $3, work_dir = $4, is_default = $5, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_COLS}`,
      [id, userId, nextName, nextWorkDir, nextDefault],
    );
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateEnvironmentTokenRow(userId: string, id: string): Promise<{ row: StoredEnvironmentRow; token: string } | null> {
  const { token, tokenHash } = generateEnvironmentToken();
  const { rows } = await query<StoredEnvironmentRow>(
    `UPDATE curialy.compute_environments SET token_hash = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${SELECT_COLS}`,
    [id, userId, tokenHash],
  );
  if (!rows[0]) return null;
  return { row: rows[0], token };
}

export async function deleteEnvironmentRow(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query("DELETE FROM curialy.compute_environments WHERE id = $1 AND user_id = $2", [id, userId]);
  return (rowCount ?? 0) > 0;
}

export async function authenticateEnvironmentToken(rawToken: string): Promise<StoredEnvironmentRow | null> {
  if (typeof rawToken !== "string" || !rawToken.startsWith("cur_env_") || rawToken.length < 20 || rawToken.length > 120) {
    return null;
  }
  const tokenHash = hashEnvironmentToken(rawToken);
  const { rows } = await query<StoredEnvironmentRow>(
    `UPDATE curialy.compute_environments SET last_seen_at = now() WHERE token_hash = $1 RETURNING ${SELECT_COLS}`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function recordEnvironmentSpecs(id: string, specs: ComputeSpecs): Promise<void> {
  await query(
    "UPDATE curialy.compute_environments SET specs = $2, last_seen_at = now(), updated_at = now() WHERE id = $1",
    [id, toJsonb(specs)],
  ).catch(error => console.error("[compute] failed to persist specs:", error instanceof Error ? error.message : error));
}
