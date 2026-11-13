import { addressFromBoc, addressSliceBoc, parseTonAddress, rawTonAddress, type TonAddress } from "./ton-address";

// The TON indexers payments are checked with, behind one shape: toncenter's v3 API and tonapi's v2,
// two operators, so a second opinion is independent. Read-only, by address and hash: nothing here
// signs or sends. Keyless use allows about one request a second per host, so requests are spaced.
// Every reading fails closed: a field that is missing or unreadable never counts as a payment.

export class TonError extends Error {}

/** A jetton wallet accepts internal_transfer only from another wallet of the same jetton (or its master). */
export const INTERNAL_TRANSFER = 0x178d4519;

export type TonInbound = {
  /** Raw, lowercased. */
  source: string;
  value: bigint;
  /** It was sent bounceable (it comes back when the transaction fails). */
  bounceable: boolean;
  /** It is itself a bounce of a message the account sent. */
  bounced: boolean;
  opcode: number | null;
  /** The jetton transfer it carries, as the indexer decoded it (internal_transfer only). */
  jetton: { amount: bigint; from: string | null } | null;
};

/** A transaction reduced to what a payment check reads. */
export type TonTx = {
  /** 64 lowercase hex digits. */
  hash: string;
  /** Raw, lowercased. */
  account: string;
  /** Unix seconds. */
  now: number;
  /** In a finalized block, never an emulation. */
  final: boolean;
  /** The internal message that started it (null: an external one, which carries no value). */
  inbound: TonInbound | null;
  aborted: boolean;
  /** The compute phase ran and succeeded. */
  computed: boolean;
  /** What the credit phase added to the account. */
  credit: bigint;
  /** It sent its inbound value back (a bounce phase, or a bounced message out). */
  returned: boolean;
  /** Internal messages it sent: a trace is complete once each has its own transaction (null: the indexer doesn't say). */
  sent: number | null;
};

export type TonApi = {
  /** Every transaction of the trace that contains this one (null: no such transaction). */
  trace: (hash: string) => Promise<TonTx[] | null>;
  /** The account's transactions since then, newest first (at most 100). */
  transactions: (account: string, sinceUnix: number) => Promise<TonTx[]>;
  /** The jetton wallet the master assigns to the owner (raw), from its get_wallet_address. */
  jettonWallet: (master: TonAddress, owner: TonAddress) => Promise<string>;
  balance: (account: string) => Promise<bigint>;
  jettonBalance: (wallet: string) => Promise<bigint>;
};

const TIMEOUT_MS = 8_000;
/** Keyless, toncenter answers 429 to requests about a second apart: half a second more keeps clear of it. */
let spacingMs = 1_500;
const nextAt = new Map<string, number>();

/** Tests: no spacing between requests. */
export function setTonSpacingForTests(ms: number) {
  spacingMs = ms;
  nextAt.clear();
}

/** A URL under the endpoint's base, keeping the base's own query (an operator's API key travels there). */
function endpoint(base: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

/** One request, spaced from the last to the same host. Errors name what was asked, never the URL. */
async function request<T>(url: URL, what: string, init: { body?: unknown } = {}, onNotFound?: T): Promise<T> {
  const now = Date.now();
  const at = Math.max(now, nextAt.get(url.host) ?? 0);
  nextAt.set(url.host, at + spacingMs);
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
  const response = await fetch(url, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404 && onNotFound !== undefined) return onNotFound;
  if (!response.ok) throw new TonError(`${what}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** An integer amount from a decimal string or a safe integer (anything else is unreadable). */
function units(value: unknown, what: string): bigint {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TonError(`${what}: unreadable amount`);
}
const optionalUnits = (value: unknown, what: string) => (value === undefined || value === null ? 0n : units(value, what));
const raw = (value: unknown) => {
  const address = typeof value === "string" ? parseTonAddress(value) : null;
  return address ? rawTonAddress(address) : null;
};
const opcodeOf = (value: unknown) => {
  const code = typeof value === "string" ? Number.parseInt(value, 16) : typeof value === "number" ? value : NaN;
  return Number.isSafeInteger(code) ? code : null;
};

// ---- toncenter v3 ----

function toncenterTx(tx: any): TonTx {
  const hash = typeof tx?.hash === "string" ? Buffer.from(tx.hash, "base64") : null;
  const account = raw(tx?.account);
  if (!hash || hash.length !== 32 || !account || !Number.isSafeInteger(tx.now)) throw new TonError("transaction: unreadable");
  const description = tx.description ?? {};
  const message = tx.in_msg;
  const source = message ? raw(message.source) : null;
  const opcode = opcodeOf(message?.opcode);
  const decoded = message?.message_content?.decoded;
  const from = decoded?.from?.["@type"] === "addr_std" ? raw(`${decoded.from.workchain_id}:${decoded.from.address}`) : null;
  const jetton = opcode === INTERNAL_TRANSFER && decoded?.["@type"] === "jetton_internal_transfer" ? { amount: units(decoded.amount?.value, "jetton transfer"), from } : null;
  const out: any[] = Array.isArray(tx.out_msgs) ? tx.out_msgs : [];
  const aborted = description.aborted !== false;
  return {
    hash: hash.toString("hex"),
    account,
    now: tx.now,
    final: tx.finality === "finalized" && tx.emulated === false,
    inbound: message && source ? { source, value: optionalUnits(message.value, "message"), bounceable: message.bounce !== false, bounced: message.bounced === true, opcode, jetton } : null,
    aborted,
    computed: description.compute_ph?.skipped === false && description.compute_ph?.success === true,
    credit: optionalUnits(description.credit_ph?.credit, "credit"),
    returned: Boolean(description.bounce) || out.some(sent => sent?.bounced === true) || (aborted && message?.bounce !== false),
    // An external message out (a log) has no destination and starts nothing.
    sent: out.filter(sent => sent?.destination).length,
  };
}

function toncenter(base: string): TonApi {
  return {
    trace: async hash => {
      const body = await request<{ traces?: { transactions?: Record<string, unknown> }[] }>(endpoint(base, "/traces", { tx_hash: hash, include_actions: "false" }), "traces");
      const trace = body.traces?.[0];
      return trace ? Object.values(trace.transactions ?? {}).map(toncenterTx) : null;
    },
    transactions: async (account, sinceUnix) => {
      const body = await request<{ transactions?: unknown[] }>(endpoint(base, "/transactions", { account, start_utime: sinceUnix, limit: 100, sort: "desc" }), "transactions");
      return (body.transactions ?? []).map(toncenterTx);
    },
    jettonWallet: async (master, owner) => {
      const body = await request<{ exit_code?: number; stack?: { value?: string }[] }>(endpoint(base, "/runGetMethod"), "get_wallet_address", {
        body: { address: rawTonAddress(master), method: "get_wallet_address", stack: [{ type: "slice", value: addressSliceBoc(owner) }] },
      });
      const wallet = body.exit_code === 0 && typeof body.stack?.[0]?.value === "string" ? addressFromBoc(Buffer.from(body.stack[0].value, "base64")) : null;
      if (!wallet) throw new TonError("get_wallet_address: unreadable answer");
      return rawTonAddress(wallet);
    },
    balance: async account => units((await request<{ balance?: unknown }>(endpoint(base, "/account", { address: account }), "account", {}, { balance: "0" })).balance, "balance"),
    jettonBalance: async wallet => {
      const body = await request<{ jetton_wallets?: { balance?: unknown }[] }>(endpoint(base, "/jetton/wallets", { address: wallet, limit: 1 }), "jetton wallets");
      // A jetton wallet that has never received anything doesn't exist yet: it holds nothing.
      return body.jetton_wallets?.length ? units(body.jetton_wallets[0].balance, "jetton balance") : 0n;
    },
  };
}

// ---- tonapi v2 ----

/**
 * emulated: a trace node tonapi shows before the transaction is in a block. tonapi leaves the
 * messages out of a trace's transactions, so how many each sent is unknown there.
 */
function tonapiTx(tx: any, trace: { emulated: boolean } | null = null): TonTx {
  const account = raw(tx?.account?.address);
  if (typeof tx?.hash !== "string" || !/^[0-9a-f]{64}$/.test(tx.hash) || !account || !Number.isSafeInteger(tx.utime)) throw new TonError("transaction: unreadable");
  const message = tx.in_msg;
  const source = message?.msg_type === "int_msg" ? raw(message.source?.address) : null;
  const opcode = opcodeOf(message?.op_code);
  const decoded = message?.decoded_body;
  const jetton = opcode === INTERNAL_TRANSFER && message?.decoded_op_name === "jetton_internal_transfer" && decoded ? { amount: units(decoded.amount, "jetton transfer"), from: raw(decoded.from) } : null;
  const out: any[] = Array.isArray(tx.out_msgs) ? tx.out_msgs : [];
  const aborted = tx.aborted !== false;
  return {
    hash: tx.hash,
    account,
    now: tx.utime,
    // Transactions are read from committed blocks; only a trace can show one still emulated.
    final: !trace?.emulated,
    inbound: source ? { source, value: optionalUnits(message.value, "message"), bounceable: message.bounce !== false, bounced: message.bounced === true, opcode, jetton } : null,
    aborted,
    computed: tx.compute_phase?.skipped === false && tx.compute_phase?.success === true,
    credit: optionalUnits(tx.credit_phase?.credit, "credit"),
    returned: Boolean(tx.bounce_phase) || out.some(sent => sent?.bounced === true) || (aborted && message?.bounce !== false),
    sent: trace ? null : out.filter(sent => sent?.msg_type === "int_msg").length,
  };
}

function tonapi(base: string): TonApi {
  return {
    trace: async hash => {
      const root = await request<any>(endpoint(base, `/traces/${hash}`), "trace", {}, null);
      if (!root) return null;
      const found: TonTx[] = [];
      const pending = [root];
      while (pending.length) {
        const node = pending.pop();
        found.push(tonapiTx(node?.transaction, { emulated: node?.emulated === true }));
        for (const child of node?.children ?? []) pending.push(child);
      }
      return found;
    },
    transactions: async (account, sinceUnix) => {
      // An account that has never received anything doesn't exist yet: it has no transactions.
      const body = await request<{ transactions?: unknown[] }>(endpoint(base, `/blockchain/accounts/${account}/transactions`, { limit: 100, sort_order: "desc" }), "transactions", {}, { transactions: [] });
      return (body.transactions ?? []).map(tx => tonapiTx(tx)).filter(tx => tx.now >= sinceUnix);
    },
    jettonWallet: async (master, owner) => {
      const body = await request<{ success?: boolean; exit_code?: number; stack?: { cell?: string; slice?: string }[] }>(
        endpoint(base, `/blockchain/accounts/${rawTonAddress(master)}/methods/get_wallet_address`, { args: rawTonAddress(owner) }), "get_wallet_address",
      );
      const cell = body.stack?.[0]?.cell ?? body.stack?.[0]?.slice;
      const wallet = body.success === true && body.exit_code === 0 && typeof cell === "string" ? addressFromBoc(Buffer.from(cell, "hex")) : null;
      if (!wallet) throw new TonError("get_wallet_address: unreadable answer");
      return rawTonAddress(wallet);
    },
    balance: async account => units((await request<{ balance?: unknown }>(endpoint(base, `/accounts/${account}`), "account", {}, { balance: 0 })).balance, "balance"),
    jettonBalance: async wallet => {
      const body = await request<{ success?: boolean; decoded?: { balance?: unknown } } | null>(endpoint(base, `/blockchain/accounts/${wallet}/methods/get_wallet_data`), "get_wallet_data", {}, null);
      return body?.success === true ? units(body.decoded?.balance, "jetton balance") : 0n;
    },
  };
}

/** The indexer behind an endpoint: tonapi by its host, anything else speaks toncenter's v3 API (an operator's own indexer, say). */
export const tonApi = (url: string): TonApi => (new URL(url).hostname.endsWith("tonapi.io") ? tonapi(url) : toncenter(url));
