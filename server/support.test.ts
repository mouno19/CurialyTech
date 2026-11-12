import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The support API on an in-process server, with the database replaced by the rows these routes write.

type Thread = {
  id: string;
  user_id: string;
  subject: string;
  status: "open" | "closed";
  created_at: Date;
  updated_at: Date;
  user_unread: boolean;
  staff_unread: boolean;
  display_name: string;
  login: string | null;
};
type Message = { id: string; thread_id: string; author_id: string; body: string; created_at: Date };

const store = vi.hoisted(() => ({
  threads: [] as Thread[],
  messages: [] as Message[],
  n: 0,
  block: false,
}));

const people: Record<string, { display_name: string; login: string | null }> = {
  admin: { display_name: "Operator", login: "operator" },
  "user-b": { display_name: "Someone Else", login: "someone-else" },
};

vi.mock("./db/pg", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    const id = () => `00000000-0000-4000-8000-${String(++store.n).padStart(12, "0")}`;
    const visible = (thread: Thread, admin: boolean, userId: string) => admin || thread.user_id === userId;
    if (text.includes("-- support.create")) {
      const [userId, subject, body, limit] = values as [string, string, string, number];
      const open = store.threads.filter(thread => thread.user_id === userId && thread.status === "open").length;
      if (open >= Number(limit)) return { rows: [] };
      const now = new Date();
      const threadId = id();
      const person = people[userId];
      store.threads.push({ id: threadId, user_id: userId, subject, status: "open", created_at: now, updated_at: now, user_unread: false, staff_unread: true, display_name: person.display_name, login: person.login });
      store.messages.push({ id: id(), thread_id: threadId, author_id: userId, body, created_at: now });
      return { rows: [{ id: threadId }] };
    }
    if (text.includes("-- support.send")) {
      const [threadId, authorId, body, admin] = values as [string, string, string, boolean];
      const thread = store.threads.find(item => item.id === threadId);
      if (!thread || !visible(thread, admin, authorId)) return { rows: [] };
      const now = new Date();
      const messageId = id();
      store.messages.push({ id: messageId, thread_id: threadId, author_id: authorId, body, created_at: now });
      thread.updated_at = now;
      thread.status = "open";
      thread.user_unread = thread.user_id !== authorId;
      thread.staff_unread = thread.user_id === authorId;
      return { rows: [{ id: messageId }] };
    }
    if (text.includes("-- support.close")) {
      const [threadId, userId, admin] = values as [string, string, boolean];
      const thread = store.threads.find(item => item.id === threadId);
      if (!thread || !visible(thread, admin, userId)) return { rows: [] };
      thread.status = "closed";
      thread.updated_at = new Date();
      return { rows: [{ id: thread.id }] };
    }
    if (text.includes("-- support.get")) {
      const [threadId, admin, userId] = values as [string, boolean, string];
      const thread = store.threads.find(item => item.id === threadId && visible(item, admin, userId));
      return { rows: thread ? [thread] : [] };
    }
    if (text.includes("-- support.messages")) {
      const [threadId] = values as [string];
      const rows = store.messages.filter(message => message.thread_id === threadId).sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
      return { rows };
    }
    if (text.includes("-- support.read")) {
      const [threadId, userId, admin] = values as [string, string, boolean];
      const thread = store.threads.find(item => item.id === threadId && visible(item, admin, userId));
      if (thread) {
        if (thread.user_id === userId) thread.user_unread = false;
        if (admin && thread.user_id !== userId) thread.staff_unread = false;
      }
      return { rows: [] };
    }
    if (text.includes("-- support.list")) {
      const [admin, userId] = values as [boolean, string];
      const rows = store.threads
        .filter(thread => visible(thread, admin, userId))
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
        .map(thread => {
          const last = store.messages.filter(message => message.thread_id === thread.id).sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id))[0];
          return { ...thread, preview: last ? last.body.slice(0, 160) : "" };
        });
      return { rows };
    }
    if (text.includes("-- support.unread")) {
      const [userId, admin] = values as [string, boolean];
      const n = store.threads.filter(thread => (thread.user_id === userId && thread.user_unread) || (admin && thread.user_id !== userId && thread.staff_unread)).length;
      return { rows: [{ n }] };
    }
    throw new Error(`unexpected query: ${text}`);
  }),
}));

vi.mock("./auth", async importOriginal => {
  const actual = await importOriginal<typeof import("./auth")>();
  const who = (req: { headers: Record<string, unknown> }) => (req.headers["x-test-account"] === "other"
    ? { id: "user-b", role: "user" as const, login: "someone-else", displayName: "Someone Else", avatarUrl: null, email: null }
    : { id: "admin", role: "admin" as const, login: "operator", displayName: "Operator", avatarUrl: null, email: null });
  return { ...actual, accountOf: who, requireUser: (_req: unknown, _res: unknown, next: () => void) => next(), rateLimited: () => store.block };
});

const { supportRouter } = await import("./support");

let server: http.Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/support", supportRouter());
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/support`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

beforeEach(() => {
  store.threads.length = 0;
  store.messages.length = 0;
  store.n = 0;
  store.block = false;
});

const as = (account: "admin" | "other" = "admin") => ({ "content-type": "application/json", "x-test-account": account });
const post = (path: string, body: unknown, account: "admin" | "other" = "admin") => fetch(`${base}${path}`, { method: "POST", headers: as(account), body: JSON.stringify(body) });
const get = (path: string, account: "admin" | "other" = "admin") => fetch(`${base}${path}`, { headers: as(account) });

describe("support conversations", () => {
  it("lets an account open an issue and keeps it off other accounts", async () => {
    const created = await post("/threads", { subject: "  Preview   stayed on building  ", body: "It never finished.\u0000" }, "other");
    expect(created.status).toBe(201);
    const body = await created.json() as { thread: { id: string; subject: string; own: boolean; messages: { body: string; mine: boolean; fromStaff: boolean }[] }; unread: number };
    expect(body.thread.subject).toBe("Preview stayed on building");
    expect(body.thread.messages[0]).toMatchObject({ body: "It never finished.", mine: true, fromStaff: false });
    expect(body.thread.own).toBe(true);
    expect(body.unread).toBe(0);

    const operator = await get("/threads");
    const listed = await operator.json() as { threads: { id: string; unread: boolean; own: boolean; account: { name: string } | null }[]; unread: number };
    expect(listed.unread).toBe(1);
    expect(listed.threads[0]).toMatchObject({ id: body.thread.id, unread: true, own: false, account: { name: "Someone Else" } });
    expect((await get(`/threads/${body.thread.id}`)).status).toBe(200);
    expect((await (await get("/unread")).json() as { unread: number }).unread).toBe(0);

    const stranger = await get("/threads", "other");
    const own = await stranger.json() as { threads: { id: string }[] };
    const operatorThread = await post("/threads", { subject: "My own note", body: "Checking the inbox." });
    const operatorBody = await operatorThread.json() as { thread: { id: string } };
    const again = await get("/threads", "other");
    const againBody = await again.json() as { threads: { id: string }[] };
    expect(againBody.threads.map(thread => thread.id)).toEqual(own.threads.map(thread => thread.id));
    expect(againBody.threads.some(thread => thread.id === operatorBody.thread.id)).toBe(false);
    expect((await get(`/threads/${operatorBody.thread.id}`, "other")).status).toBe(404);
    expect((await post(`/threads/${operatorBody.thread.id}/messages`, { body: "hello" }, "other")).status).toBe(404);
  });

  it("shows a reply to the account that wrote in, then closes and reopens", async () => {
    const created = await (await post("/threads", { subject: "Credits", body: "The window looks wrong." }, "other")).json() as { thread: { id: string } };
    const reply = await post(`/threads/${created.thread.id}/messages`, { body: "It refills from the time the boost began." });
    expect(reply.status).toBe(200);
    const waiting = await get("/threads", "other");
    const waitingBody = await waiting.json() as { threads: { unread: boolean; preview: string }[]; unread: number };
    expect(waitingBody.unread).toBe(1);
    expect(waitingBody.threads[0]).toMatchObject({ unread: true, preview: "It refills from the time the boost began." });

    const opened = await get(`/threads/${created.thread.id}`, "other");
    const openedBody = await opened.json() as { thread: { unread: boolean; messages: { mine: boolean; fromStaff: boolean; body: string }[] }; unread: number };
    expect(openedBody.unread).toBe(0);
    expect(openedBody.thread.unread).toBe(false);
    expect(openedBody.thread.messages[1]).toMatchObject({ mine: false, fromStaff: true, body: "It refills from the time the boost began." });
    expect((await (await get("/unread", "other")).json() as { unread: number }).unread).toBe(0);

    const closed = await post(`/threads/${created.thread.id}/close`, {}, "other");
    expect((await closed.json() as { thread: { status: string } }).thread.status).toBe("closed");
    const reopened = await post(`/threads/${created.thread.id}/messages`, { body: "It is still off." }, "other");
    expect((await reopened.json() as { thread: { status: string } }).thread.status).toBe("open");
    expect((await (await get("/unread")).json() as { unread: number }).unread).toBe(1);
  });

  it("stops an account at eight open conversations and accepts another after one is closed", async () => {
    for (let n = 0; n < 8; n++) expect((await post("/threads", { subject: `Issue ${n}`, body: "Details." }, "other")).status).toBe(201);
    const full = await post("/threads", { subject: "One more", body: "Details." }, "other");
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "support_full" });
    const listed = await (await get("/threads", "other")).json() as { threads: { id: string }[] };
    expect((await post(`/threads/${listed.threads[0].id}/close`, {}, "other")).status).toBe(200);
    expect((await post("/threads", { subject: "One more", body: "Details." }, "other")).status).toBe(201);
  });

  it("refuses an empty message and a burst of them", async () => {
    expect((await post("/threads", { subject: "   ", body: "Hello" }, "other")).status).toBe(400);
    expect((await post("/threads", { subject: "Blank", body: "\u0000" }, "other")).status).toBe(400);
    const created = await (await post("/threads", { subject: "Login", body: "The button does nothing." }, "other")).json() as { thread: { id: string } };
    expect((await post(`/threads/${created.thread.id}/messages`, { body: "  " }, "other")).status).toBe(400);
    store.block = true;
    expect((await post(`/threads/${created.thread.id}/messages`, { body: "Still nothing." }, "other")).status).toBe(429);
  });
});
