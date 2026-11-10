import { formatUsd, networkInfo, PAYMENT_STATUS, type AdminPaymentOrder } from "@shared/billing";

// Operator alerts on Telegram, send-only (no webhook, no commands): a payment that needs review, and
// one that completed, each with a button to the order on the Admin page. Optional: without
// TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID nothing is sent. An alert never throws or holds up
// what triggered it, and the token never reaches a log.

export const alertsConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_ADMIN_CHAT_ID?.trim());

/** Telegram's HTML mode: everything that isn't markup is escaped (quotes too, for the link). */
const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function alertText(order: AdminPaymentOrder, why: "review" | "completed") {
  const network = networkInfo(order.network);
  const price = order.discountPercent ? `${formatUsd(order.priceUsd)} (list ${formatUsd(order.listUsd)}, ${order.discountPercent}% off)` : formatUsd(order.priceUsd);
  const lines = [
    why === "review" ? "<b>Payment needs review</b>" : "<b>Payment completed</b>",
    "",
    `<b>Order</b> <code>${escape(order.code)}</code>`,
    `<b>Account</b> ${escape(order.user.login ? `@${order.user.login}` : order.user.name || order.user.id)}`,
    `<b>Item</b> ${escape(order.title)}`,
    `<b>Price</b> ${escape(price)}`,
  ];
  if (order.network && order.coin) lines.push(`<b>Amount</b> ${escape(`${order.expectedAmount ?? "?"} ${order.coin} on ${network?.label ?? order.network}`)}`);
  if (order.receivedAmount !== null && order.receivedAmount !== order.expectedAmount) lines.push(`<b>Received</b> ${escape(`${order.receivedAmount} ${order.coin}`)}`);
  lines.push(`<b>Status</b> ${escape(PAYMENT_STATUS[order.status].label)}${order.statusDetail ? ` · ${escape(order.statusDetail)}` : ""}`);
  if (order.txHash) {
    const hash = escape(order.txHash);
    lines.push(`<b>Transaction</b> ${order.explorerUrl ? `<a href="${escape(order.explorerUrl)}">${hash}</a>` : `<code>${hash}</code>`}`);
  }
  return lines.join("\n");
}

/** One alert per order and reason in this long: a payer resubmitting hashes can't flood the chat. */
const QUIET_MS = 10 * 60_000;
const sent = new Map<string, number>();

export async function notifyOrder(order: AdminPaymentOrder, why: "review" | "completed"): Promise<void> {
  if (!alertsConfigured()) return;
  const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
  const key = `${order.code}:${why}`;
  const now = Date.now();
  if ((sent.get(key) ?? 0) > now - QUIET_MS) return;
  sent.set(key, now);
  if (sent.size > 2000) sent.clear();
  const base = (process.env.PUBLIC_BASE_URL?.trim() || "https://curialy.tech").replace(/\/+$/, "");
  const button = { text: "Open in Admin", url: `${base}/admin?tab=payments&order=${encodeURIComponent(order.code)}` };
  const hide = (text: string) => text.split(token).join("<token>");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID!.trim(), text: alertText(order, why), parse_mode: "HTML",
        link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[button]] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { description?: string } | null;
      console.warn(`[Curialy Billing] Alert for ${order.code} not sent: HTTP ${response.status}${body?.description ? ` ${hide(String(body.description)).slice(0, 200)}` : ""}.`);
      // Not sent: the next change may try again.
      sent.delete(key);
    }
  } catch (error) {
    sent.delete(key);
    const reason = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timed out" : "unreachable";
    console.warn(`[Curialy Billing] Alert for ${order.code} not sent: ${reason}.`);
  }
}

/** Tests: forget which alerts went out. */
export const resetAlerts = () => sent.clear();
