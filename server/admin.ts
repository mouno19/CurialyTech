import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ACTIVE_STATUSES } from "@shared/taskStatus";
import { accountOf, forgetUser, rateLimited, requireAdmin, requireUser } from "./auth";
import {
  balanceOf, createPromoCode, creditHistory, CreditError, disablePromoCode, getBalance, getSettings, grant, listPromoCodes, redeemPromoCode,
  saveSettings, setAllowance, type UserCredits,
} from "./credits";
import { query } from "./db/pg";
import { requestCancel } from "./agent/runner";
import { getConnection, oauthConfigured } from "./services/github";
import { voiceConfigured } from "./voice/engines";

// /api/account: the signed-in account (credits, promo codes). /api/admin: the operator's dashboard
// (accounts, credits, promo codes, settings). Every admin route requires the operator role.

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
    if (error instanceof CreditError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error("[account]", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Something went wrong. Try again." });
  });
};

export function accountRouter() {
  const router = Router();
  router.use(requireUser);

  router.get("/", handle(async (req, res) => {
    const user = accountOf(req);
    const [credits, connection] = await Promise.all([getBalance(user.id), getConnection(user.id).catch(() => null)]);
    res.json({ user, credits, github: { configured: oauthConfigured(), connected: Boolean(connection), login: connection?.login ?? null }, voice: { available: voiceConfigured() } });
  }));

  router.get("/credits", handle(async (req, res) => {
    const user = accountOf(req);
    res.json({ credits: await getBalance(user.id), history: await creditHistory(user.id, 30) });
  }));

  router.post("/redeem", handle(async (req, res) => {
    const user = accountOf(req);
    // Codes are not guessable, but guessing is still capped.
    if (rateLimited(`redeem:${user.id}`, 10)) return res.status(429).json({ error: "Too many tries. Wait a few minutes before trying another code.", code: "busy" });
    const { code } = z.object({ code: z.string().trim().min(1, "Enter a code.").max(64) }).parse(req.body ?? {});
    res.json(await redeemPromoCode(user.id, code));
  }));

  return router;
}

type AccountRow = UserCredits & {
  login: string | null; display_name: string; avatar_url: string | null; email: string | null; created_at: Date; last_seen_at: Date | null;
  banned_at: Date | null; tasks: string; active: string; used_total: string | null;
};

const uuid = z.string().uuid("Unknown account.");

export function adminRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get("/overview", handle(async (_req, res) => {
    const { rows: [row] } = await query<{ users: string; new_day: string; active_day: string; runs: string; used_day: string | null; promos: string }>(
      `SELECT (SELECT count(*) FROM curialy.users) AS users,
              (SELECT count(*) FROM curialy.users WHERE created_at > now() - interval '1 day') AS new_day,
              (SELECT count(*) FROM curialy.users WHERE last_seen_at > now() - interval '1 day') AS active_day,
              (SELECT count(*) FROM curialy.chat_sessions WHERE status = ANY($1::text[])) AS runs,
              (SELECT -sum(amount) FROM curialy.credit_events WHERE kind = 'usage' AND created_at > now() - interval '1 day') AS used_day,
              (SELECT count(*) FROM curialy.promo_codes WHERE disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (max_redemptions IS NULL OR redemptions < max_redemptions)) AS promos`,
      [ACTIVE_STATUSES],
    );
    res.json({
      users: Number(row.users), newToday: Number(row.new_day), activeToday: Number(row.active_day), activeRuns: Number(row.runs),
      creditsUsedToday: Math.round(Number(row.used_day ?? 0) * 100) / 100, activePromoCodes: Number(row.promos), settings: await getSettings(),
    });
  }));

  router.get("/users", handle(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const like = `%${q.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const [{ rows }, settings] = await Promise.all([
      query<AccountRow>(
        `SELECT u.id, u.role, u.credit_allowance, u.bonus_credits, u.window_started_at, u.window_used, u.login, u.display_name, u.avatar_url, u.email,
                u.created_at, u.last_seen_at, u.banned_at,
                (SELECT count(*) FROM curialy.chat_sessions s WHERE s.user_id = u.id) AS tasks,
                (SELECT count(*) FROM curialy.chat_sessions s WHERE s.user_id = u.id AND s.status = ANY($4::text[])) AS active,
                (SELECT -sum(amount) FROM curialy.credit_events e WHERE e.user_id = u.id AND e.kind = 'usage') AS used_total
         FROM curialy.users u
         WHERE $1 = '' OR u.login ILIKE $2 OR u.display_name ILIKE $2 OR u.email ILIKE $2
         ORDER BY u.last_seen_at DESC NULLS LAST, u.created_at DESC LIMIT $3 OFFSET $5`,
        [q, like, limit + 1, ACTIVE_STATUSES, offset],
      ),
      getSettings(),
    ]);
    res.json({
      users: rows.slice(0, limit).map(row => ({
        id: row.id, role: row.role, login: row.login, name: row.display_name, avatarUrl: row.avatar_url, email: row.email,
        createdAt: row.created_at.toISOString(), lastSeenAt: row.last_seen_at?.toISOString() ?? null, banned: Boolean(row.banned_at),
        tasks: Number(row.tasks), activeRuns: Number(row.active), creditsUsedTotal: Math.round(Number(row.used_total ?? 0) * 100) / 100,
        customAllowance: row.credit_allowance, credits: balanceOf(row, settings),
      })),
      more: rows.length > limit,
    });
  }));

  router.get("/users/:id/credits", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.json({ credits: await getBalance(id), history: await creditHistory(id, 100) });
  }));

  router.post("/users/:id/credits", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = z.object({ amount: z.number(), note: z.string().trim().max(200).default("") }).parse(req.body ?? {});
    res.json({ credits: await grant(id, input.amount, accountOf(req).id, input.note) });
  }));

  router.put("/users/:id/allowance", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { allowance } = z.object({ allowance: z.number().int().nullable() }).parse(req.body ?? {});
    res.json({ credits: await setAllowance(id, allowance, accountOf(req).id) });
  }));

  // A ban signs the account out everywhere (its sessions are revoked) and stops new sign-ins.
  router.post("/users/:id/ban", handle(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { banned } = z.object({ banned: z.boolean() }).parse(req.body ?? {});
    const { rows: [target] } = await query<{ role: string }>("SELECT role FROM curialy.users WHERE id = $1", [id]);
    if (!target) return res.status(404).json({ error: "Account not found." });
    if (target.role === "admin") return res.status(409).json({ error: "The operator account can't be banned." });
    await query(`UPDATE curialy.users SET banned_at = ${banned ? "coalesce(banned_at, now())" : "NULL"}, session_version = session_version + ${banned ? 1 : 0} WHERE id = $1`, [id]);
    forgetUser(id);
    // A ban also stops what the account has running (a cancel never publishes or deploys on the way out).
    let stopped = 0;
    if (banned) {
      const { rows } = await query<{ id: string }>("SELECT id FROM curialy.chat_sessions WHERE user_id = $1 AND status = ANY($2::text[])", [id, ACTIVE_STATUSES]);
      for (const task of rows) await requestCancel(task.id).then(() => { stopped++; }, error => console.error(`[admin] stop ${task.id}:`, error instanceof Error ? error.message : error));
    }
    res.json({ banned, stopped });
  }));

  router.get("/promo-codes", handle(async (_req, res) => res.json({ codes: await listPromoCodes() })));

  router.post("/promo-codes", handle(async (req, res) => {
    const input = z.object({
      code: z.string().trim().max(32).optional(),
      credits: z.number().int(),
      forUserId: z.string().uuid().nullish(),
      maxRedemptions: z.number().int().nullish(),
      expiresAt: z.string().datetime({ offset: true }).nullish(),
      note: z.string().trim().max(200).optional(),
    }).parse(req.body ?? {});
    const created = await createPromoCode({ ...input, code: input.code || undefined, maxRedemptions: input.maxRedemptions === undefined ? undefined : input.maxRedemptions }, accountOf(req).id);
    res.status(201).json({ code: created });
  }));

  router.post("/promo-codes/:id/disable", handle(async (req, res) => {
    await disablePromoCode(uuid.parse(req.params.id));
    res.json({ codes: await listPromoCodes() });
  }));

  router.get("/settings", handle(async (_req, res) => res.json({ settings: await getSettings() })));

  router.put("/settings", handle(async (req, res) => {
    const patch = z.object({
      creditsPerWindow: z.number().int().optional(),
      windowHours: z.number().optional(),
      signupsOpen: z.boolean().optional(),
    }).parse(req.body ?? {});
    res.json({ settings: await saveSettings(patch, accountOf(req).id) });
  }));

  return router;
}
