import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { SUPPORT_LIMITS, type SupportMessage, type SupportStatus, type SupportThreadDetail, type SupportThreadSummary } from "@shared/support";
import { accountOf, rateLimited, requireUser, type AppUser } from "./auth";
import { query } from "./db/pg";

// Conversations on /support. An account writes about one issue at a time; the operator replies
// from the same page and sees every conversation. A thread is removed only when the account is.

const SUBJECT = SUPPORT_LIMITS.subject;
const BODY = SUPPORT_LIMITS.body;
const OPEN_LIMIT = SUPPORT_LIMITS.openPerAccount;

export class SupportError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
    this.name = "SupportError";
  }
}

const subjectField = z.string().trim().min(1, "Give the issue a short subject.").max(SUBJECT, `Keep the subject under ${SUBJECT} characters.`).transform(value => value.replace(/\s+/g, " "));
const bodyField = z.string().trim().min(1, "Write a message.").max(BODY, `Keep a message under ${BODY} characters.`).transform(value => value.replace(/\u0000/g, "")).refine(value => value.length > 0, "Write a message.");
const threadId = z.string().uuid("That conversation isn't here.");

type ThreadRow = {
  id: string;
  subject: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  user_id: string;
  user_unread: boolean;
  staff_unread: boolean;
  display_name: string;
  login: string | null;
  preview?: string | null;
};

type MessageRow = { id: string; body: string; created_at: Date; author_id: string };

const isAdmin = (user: AppUser) => user.role === "admin";

function summary(row: ThreadRow, viewer: AppUser): SupportThreadSummary {
  const own = row.user_id === viewer.id;
  const status: SupportStatus = row.status === "closed" ? "closed" : "open";
  return {
    id: row.id,
    subject: row.subject,
    status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    preview: (row.preview ?? "").trim(),
    unread: own ? row.user_unread : row.staff_unread,
    own,
    account: viewer.role === "admin" && !own ? { name: row.display_name, login: row.login } : null,
  };
}

function messageOf(row: MessageRow, threadUserId: string, viewerId: string): SupportMessage {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    mine: row.author_id === viewerId,
    fromStaff: row.author_id !== threadUserId,
  };
}

async function unreadCount(viewer: AppUser) {
  const { rows } = await query<{ n: number }>(
    `-- support.unread
     SELECT count(*)::int AS n FROM curialy.support_threads
     WHERE (user_id = $1 AND user_unread) OR ($2::boolean AND user_id <> $1 AND staff_unread)`,
    [viewer.id, isAdmin(viewer)],
  );
  return Number(rows[0]?.n ?? 0);
}

async function listThreads(viewer: AppUser) {
  const { rows } = await query<ThreadRow>(
    `-- support.list
     SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, t.user_id, t.user_unread, t.staff_unread,
            u.display_name, u.login, left(m.body, 160) AS preview
     FROM curialy.support_threads t
     JOIN curialy.users u ON u.id = t.user_id
     LEFT JOIN LATERAL (
       SELECT body FROM curialy.support_messages WHERE thread_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
     ) m ON true
     WHERE $1::boolean OR t.user_id = $2
     ORDER BY t.updated_at DESC
     LIMIT 80`,
    [isAdmin(viewer), viewer.id],
  );
  return rows.map(row => summary(row, viewer));
}

async function loadThread(id: string, viewer: AppUser): Promise<{ thread: SupportThreadDetail; unread: number }> {
  const { rows } = await query<ThreadRow>(
    `-- support.get
     SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, t.user_id, t.user_unread, t.staff_unread,
            u.display_name, u.login
     FROM curialy.support_threads t
     JOIN curialy.users u ON u.id = t.user_id
     WHERE t.id = $1 AND ($2::boolean OR t.user_id = $3)`,
    [id, isAdmin(viewer), viewer.id],
  );
  const row = rows[0];
  if (!row) throw new SupportError("That conversation isn't here.", 404);
  const messages = await query<MessageRow>(
    `-- support.messages
     SELECT id, body, created_at, author_id FROM curialy.support_messages
     WHERE thread_id = $1 ORDER BY created_at ASC, id ASC LIMIT 500`,
    [id],
  );
  await query(
    `-- support.read
     UPDATE curialy.support_threads
     SET user_unread = CASE WHEN user_id = $2 THEN false ELSE user_unread END,
         staff_unread = CASE WHEN $3::boolean AND user_id <> $2 THEN false ELSE staff_unread END
     WHERE id = $1 AND ($3::boolean OR user_id = $2)`,
    [id, viewer.id, isAdmin(viewer)],
  );
  const read: ThreadRow = { ...row, user_unread: row.user_id === viewer.id ? false : row.user_unread, staff_unread: isAdmin(viewer) && row.user_id !== viewer.id ? false : row.staff_unread };
  return {
    thread: { ...summary(read, viewer), messages: messages.rows.map(item => messageOf(item, row.user_id, viewer.id)) },
    unread: await unreadCount(viewer),
  };
}

async function startThread(viewer: AppUser, subject: string, body: string) {
  const { rows } = await query<{ id: string }>(
    `-- support.create
     WITH room AS (
       SELECT count(*)::int AS n FROM curialy.support_threads WHERE user_id = $1 AND status = 'open'
     ), inserted AS (
       INSERT INTO curialy.support_threads (user_id, subject, staff_unread)
       SELECT $1, $2, true FROM room WHERE n < $4
       RETURNING id
     )
     INSERT INTO curialy.support_messages (thread_id, author_id, body)
     SELECT id, $1, $3 FROM inserted
     RETURNING thread_id AS id`,
    [viewer.id, subject, body, OPEN_LIMIT],
  );
  if (!rows[0]) throw new SupportError(`You already have ${OPEN_LIMIT} open conversations. Close one before starting another.`, 409, "support_full");
  return loadThread(rows[0].id, viewer);
}

async function sendMessage(viewer: AppUser, id: string, body: string) {
  const { rows } = await query<{ id: string }>(
    `-- support.send
     WITH allowed AS (
       SELECT id, user_id FROM curialy.support_threads WHERE id = $1 AND ($4::boolean OR user_id = $2)
     ), inserted AS (
       INSERT INTO curialy.support_messages (thread_id, author_id, body)
       SELECT id, $2, $3 FROM allowed
       RETURNING id, thread_id
     )
     UPDATE curialy.support_threads t
     SET updated_at = now(), status = 'open',
         user_unread = (t.user_id <> $2::uuid),
         staff_unread = (t.user_id = $2::uuid)
     FROM inserted
     WHERE t.id = inserted.thread_id
     RETURNING inserted.id`,
    [id, viewer.id, body, isAdmin(viewer)],
  );
  if (!rows[0]?.id) throw new SupportError("That conversation isn't here.", 404);
  return loadThread(id, viewer);
}

async function closeThread(viewer: AppUser, id: string) {
  const { rows } = await query<{ id: string }>(
    `-- support.close
     UPDATE curialy.support_threads SET status = 'closed', updated_at = now()
     WHERE id = $1 AND ($3::boolean OR user_id = $2)
     RETURNING id`,
    [id, viewer.id, isAdmin(viewer)],
  );
  if (!rows[0]) throw new SupportError("That conversation isn't here.", 404);
  return loadThread(id, viewer);
}

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) => {
  fn(req, res).catch(error => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => issue.message).join("; ") });
    if (error instanceof SupportError) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    console.error("[support]", error instanceof Error ? error.message : error);
    res.status(500).json({ error: "Something went wrong. Try again." });
  });
};

const busy = (res: Response) => res.status(429).json({ error: "Too many messages in a row. Wait a few minutes, then try again.", code: "busy" });

export function supportRouter() {
  const router = Router();
  router.use(requireUser);

  router.get("/unread", handle(async (req, res) => {
    res.json({ unread: await unreadCount(accountOf(req)) });
  }));

  router.get("/threads", handle(async (req, res) => {
    const viewer = accountOf(req);
    const [threads, unread] = await Promise.all([listThreads(viewer), unreadCount(viewer)]);
    res.json({ threads, unread });
  }));

  router.post("/threads", handle(async (req, res) => {
    const viewer = accountOf(req);
    if (rateLimited(`support:${viewer.id}`, 20)) return busy(res);
    const input = z.object({ subject: subjectField, body: bodyField }).parse(req.body ?? {});
    res.status(201).json(await startThread(viewer, input.subject, input.body));
  }));

  router.get("/threads/:id", handle(async (req, res) => {
    res.json(await loadThread(threadId.parse(req.params.id), accountOf(req)));
  }));

  router.post("/threads/:id/messages", handle(async (req, res) => {
    const viewer = accountOf(req);
    if (rateLimited(`support:${viewer.id}`, 20)) return busy(res);
    const { body } = z.object({ body: bodyField }).parse(req.body ?? {});
    res.json(await sendMessage(viewer, threadId.parse(req.params.id), body));
  }));

  router.post("/threads/:id/close", handle(async (req, res) => {
    res.json(await closeThread(accountOf(req), threadId.parse(req.params.id)));
  }));

  return router;
}
