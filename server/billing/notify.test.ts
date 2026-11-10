import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPaymentOrder } from "@shared/billing";
import { alertsConfigured, alertText, notifyOrder, resetAlerts } from "./notify";

// Operator alerts: nothing without both settings; with them, one HTML message to the operator's chat
// (everything escaped) with a button to the order on the Admin page. An alert never throws, never
// floods, and the bot token never reaches a log.

const TOKEN = "7712345678:AAFakeTokenForTests_abcdefghijklmnop";
const sent: { url: string; body: any; signal: unknown }[] = [];
let answer: () => Response | Promise<Response> = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });

const order = (patch: Partial<AdminPaymentOrder> = {}): AdminPaymentOrder => ({
  code: "CUR-7K3M2QX9", kind: "plan", planId: "pro", title: "Pro · 30 days", listUsd: 20, discountPercent: 90, priceUsd: 2, creditUsd: null,
  network: "bnb", coin: "USDT", payAddress: "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b", expectedAmount: "2.0037", quoteUsdPrice: null,
  txHash: `0x${"ab".repeat(32)}`, status: "review", statusDetail: "This transaction sent 1.5 USDT to the Curialy wallet; this order expects exactly 2.0037 USDT.",
  confirmations: 25, requiredConfirmations: 20, createdAt: "2026-11-09T12:00:00.000Z", quotedAt: "2026-11-09T12:00:00.000Z", expiresAt: "2026-11-09T12:30:00.000Z",
  submitUntil: null, submittedAt: "2026-11-09T12:05:00.000Z", completedAt: null, applied: null, explorerUrl: `https://bscscan.com/tx/0x${"ab".repeat(32)}`, events: [],
  user: { id: "u1", login: "ada", name: "Ada" }, adminNote: null, txFrom: "0xpayer", receivedAmount: "1.5", txBlockTime: null, checkCount: 3, lastCheckedAt: null,
  ...patch,
});

beforeEach(() => {
  resetAlerts();
  sent.length = 0;
  answer = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1001234567890");
  vi.stubEnv("PUBLIC_BASE_URL", "https://curialy.tech/");
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    sent.push({ url: String(input), body: JSON.parse(String(init.body)), signal: init.signal });
    return answer();
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alerts", () => {
  it("try again after a failed send instead of staying quiet for ten minutes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    answer = () => new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), { status: 502 });
    await notifyOrder(order(), "review");
    answer = () => new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 });
    await notifyOrder(order(), "review");
    expect(sent).toHaveLength(2);
    // Once one went out, the same alert stays quiet.
    await notifyOrder(order(), "review");
    expect(sent).toHaveLength(2);
  });

  it("do nothing unless both the token and the chat are set", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
    expect(alertsConfigured()).toBe(false);
    await notifyOrder(order(), "review");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1001234567890");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", " ");
    await notifyOrder(order(), "review");
    expect(sent).toEqual([]);
  });

  it("send the order, account, item, price, amount, status and transaction, with a button to the order", async () => {
    await notifyOrder(order(), "review");
    expect(sent).toHaveLength(1);
    const [{ url, body, signal }] = sent;
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(body).toMatchObject({ chat_id: "-1001234567890", parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Open in Admin", url: "https://curialy.tech/admin?tab=payments&order=CUR-7K3M2QX9" }]] });
    expect(body.text.split("\n")).toEqual([
      "<b>Payment needs review</b>",
      "",
      "<b>Order</b> <code>CUR-7K3M2QX9</code>",
      "<b>Account</b> @ada",
      "<b>Item</b> Pro · 30 days",
      "<b>Price</b> $2.00 (list $20.00, 90% off)",
      "<b>Amount</b> 2.0037 USDT on BNB Chain",
      "<b>Received</b> 1.5 USDT",
      "<b>Status</b> In review · This transaction sent 1.5 USDT to the Curialy wallet; this order expects exactly 2.0037 USDT.",
      `<b>Transaction</b> <a href="https://bscscan.com/tx/0x${"ab".repeat(32)}">0x${"ab".repeat(32)}</a>`,
    ]);
    expect(alertText(order({ status: "completed", statusDetail: null, receivedAmount: "2.0037" }), "completed")).toMatch(/^<b>Payment completed<\/b>[\s\S]*<b>Status<\/b> Completed\n/);
  });

  it("escape everything that came from an account or the chain", () => {
    const text = alertText(order({ user: { id: "u1", login: null, name: "<script>alert(1)</script> & Co" }, statusDetail: 'Sent "1" <b>USDT</b>', explorerUrl: 'https://bscscan.com/tx/x"><a href="evil' }), "review");
    expect(text).toContain("<b>Account</b> &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co");
    expect(text).toContain("In review · Sent &quot;1&quot; &lt;b&gt;USDT&lt;/b&gt;");
    expect(text).toContain('<a href="https://bscscan.com/tx/x&quot;&gt;&lt;a href=&quot;evil">');
    expect(text).not.toContain("<script>");
  });

  it("never throw, and never log the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    answer = () => new Response(JSON.stringify({ ok: false, error_code: 400, description: `Bad Request: chat not found (bot${TOKEN})` }), { status: 400 });
    await expect(notifyOrder(order(), "review")).resolves.toBeUndefined();
    answer = () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    };
    await expect(notifyOrder(order({ code: "CUR-AAAAAAAA" }), "review")).resolves.toBeUndefined();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("Alert for CUR-7K3M2QX9 not sent: HTTP 400 Bad Request: chat not found");
    expect(logged).toContain("Alert for CUR-AAAAAAAA not sent: unreachable");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("AAFakeToken");
  });

  it("go out once per order and reason in ten minutes", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    try {
      await notifyOrder(order(), "review");
      await notifyOrder(order(), "review");
      await notifyOrder(order(), "completed");
      expect(sent).toHaveLength(2);
      vi.advanceTimersByTime(11 * 60_000);
      await notifyOrder(order(), "review");
      expect(sent).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
