import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTxHash } from "@shared/billing";
import { addressFromBoc, addressSliceBoc, friendlyTonAddress, isValidTonAddress, parseTonAddress, rawTonAddress } from "./ton-address";
import { INTERNAL_TRANSFER, setTonSpacingForTests } from "./ton";
import { incomingPayments, resetTonJettonWallets, verifyPayment, walletHoldings, type PaymentToVerify } from "./chains";

// TON payments over stand-ins for the two indexers, answering in their real formats (captured from
// mainnet on 2026-11-13). USDT counts only when Curialy's own USDT jetton wallet accepted it, GRAM
// only when it was credited and not sent back, either only once final; a trace still running is
// never read as "not paid"; and the order keeps the transaction that received the payment.

// A real USDT transfer on mainnet: its recipient stands in for Curialy's wallet.
const WALLET = "UQAqE9qkizLd7c3oXnsyXQklVus6KyAGrMnv7tAfCYydVx-F";
const OWNER = "0:2a13daa48b32ddedcde85e7b325d092556eb3a2b2006acc9efeed01f098c9d57";
/** Its USDT jetton wallet, as the USDT master's get_wallet_address answers on mainnet. */
const USDT_WALLET = "0:41b3ed773a3f2d447eafcb45e6d45f5c86f6361173c8fd96c94d6fbf87fe5063";
const USDC_WALLET = `0:${"5c".repeat(32)}`;
const USDT_MASTER = "0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe";
const USDC_MASTER = "0:7e30fc2b7751ba58a3642f3fd59d5e96a810ddd78d8a310bfe8353bef10500df";
const PAYER = "0:3ac82b1a34b0c129300e05779a4fa7bc3e59fee4505c2ac4b45e6e076c259eaf";
const PAYER_USDT = "0:74d6639109a847cd2e0dab453273df83fee500b74f0e4a8be2c423a614ec20ba";
/** The jetton wallet of a token that calls itself USDT. */
const FAKE_WALLET = `0:${"66".repeat(32)}`;
const ROOT = Buffer.from("nUfUTW4FrweqyHPrAmgHmpW5KZbxJTN5CTcRqhmp/IA=", "base64").toString("hex");
const RECEIVING = "ccc5e9e86a2b976cb1955dd2aeffbccf1ddb2454cf18f038955f37a47e8236af";
const NOW = 1794548008;
const FAILED = "This transaction failed on the network, so nothing was received.";
const hash = (n: number) => n.toString(16).padStart(64, "0");
const raw = (text: string | null) => rawTonAddress(parseTonAddress(text ?? "")!);

type Tx = {
  hash: string; account: string; now?: number;
  /** null: started by an external message. */
  source?: string | null;
  value?: bigint; bounce?: boolean; bounced?: boolean; opcode?: number; jetton?: { amount: bigint; from: string };
  aborted?: boolean; computed?: boolean | "skipped"; credit?: bigint; bouncePhase?: boolean;
  /** Internal messages it sends inside the trace. */
  sends?: number;
  /** false: toncenter shows it pending (emulated); tonapi not at all yet. */
  final?: boolean;
};
const traces: Tx[][] = [];
const balances = new Map<string, bigint>();
const jettonWallets = new Map([[`${USDT_MASTER}|${OWNER}`, USDT_WALLET], [`${USDC_MASTER}|${OWNER}`, USDC_WALLET]]);
const providers = { toncenter: "up" as "up" | "down", tonapi: "up" as "up" | "down" };
const calls: string[] = [];

const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
const upper = (address: string) => `0:${address.slice(2).toUpperCase()}`;
const opcode = (tx: Tx) => (tx.opcode === undefined ? undefined : `0x${tx.opcode.toString(16).padStart(8, "0")}`);
const sentOut = (tx: Tx) => [...Array.from({ length: tx.sends ?? 0 }, () => ({ destination: upper(OWNER), bounced: false })), ...(tx.bouncePhase ? [{ destination: upper(tx.source ?? PAYER), bounced: true }] : [])];

function toncenterJson(tx: Tx) {
  const internal = tx.source !== null;
  return {
    account: upper(tx.account), hash: b64(tx.hash), lt: "1", now: tx.now ?? NOW, mc_block_seqno: 105117166, orig_status: "active", end_status: "active",
    finality: tx.final === false ? "pending" : "finalized", emulated: tx.final === false,
    in_msg: internal ? {
      source: upper(tx.source ?? PAYER), destination: upper(tx.account), value: String(tx.value ?? 0n), bounce: tx.bounce ?? false, bounced: tx.bounced ?? false, opcode: opcode(tx) ?? null,
      message_content: {
        body: "te6cckEBAQEAAgAAAEysuc0=",
        decoded: tx.jetton ? { "@type": "jetton_internal_transfer", query_id: "0", amount: { "@type": "var_uint", len: "3", value: String(tx.jetton.amount) }, from: { "@type": "addr_std", anycast: { "@type": "nothing_from_maybe" }, workchain_id: "0", address: tx.jetton.from.slice(2).toUpperCase() } } : null,
      },
    } : { source: null, destination: upper(tx.account), value: null, opcode: "0x73696e74", message_content: { decoded: null } },
    out_msgs: sentOut(tx),
    description: {
      type: "ord", aborted: tx.aborted ?? false, destroyed: false, credit_first: !(tx.bounce ?? false),
      ...(internal ? { credit_ph: { credit: String(tx.credit ?? tx.value ?? 0n) } } : {}),
      compute_ph: tx.computed === "skipped" ? { skipped: true, reason: "no_state" } : { skipped: false, success: tx.computed ?? true, exit_code: tx.computed === false ? 47 : 0 },
      ...(tx.bouncePhase ? { bounce: { type: "ok" } } : {}),
    },
  };
}

function tonapiJson(tx: Tx) {
  const internal = tx.source !== null;
  return {
    hash: tx.hash, lt: 1, account: { address: tx.account, is_scam: false, is_wallet: false }, utime: tx.now ?? NOW, success: !(tx.aborted ?? false), aborted: tx.aborted ?? false, destroyed: false,
    in_msg: internal ? {
      msg_type: "int_msg", value: Number(tx.value ?? 0n), bounce: tx.bounce ?? false, bounced: tx.bounced ?? false, source: { address: tx.source ?? PAYER }, destination: { address: tx.account }, op_code: opcode(tx),
      ...(tx.jetton ? { decoded_op_name: "jetton_internal_transfer", decoded_body: { query_id: 0, amount: String(tx.jetton.amount), from: tx.jetton.from, response_address: PAYER, forward_ton_amount: "1" } } : {}),
    } : { msg_type: "ext_in_msg", value: 0, destination: { address: tx.account } },
    out_msgs: sentOut(tx).map(out => ({ msg_type: "int_msg", bounced: out.bounced, value: 1 })),
    ...(internal ? { credit_phase: { fees_collected: 0, credit: Number(tx.credit ?? tx.value ?? 0n) } } : {}),
    compute_phase: tx.computed === "skipped" ? { skipped: true, skip_reason: "cskip_no_state" } : { skipped: false, success: tx.computed ?? true, exit_code: tx.computed === false ? 47 : 0 },
    ...(tx.bouncePhase ? { bounce_phase: "TrPhaseBounceOk" } : {}),
  };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const traceOf = (wanted: string) => traces.find(trace => trace.some(tx => tx.hash === wanted.toLowerCase()));

vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
  const url = new URL(String(input));
  const host = url.hostname === "toncenter.com" ? "toncenter" : url.hostname === "tonapi.io" ? "tonapi" : null;
  if (!host) throw new Error(`unexpected host ${url.hostname}`);
  calls.push(`${host} ${url.pathname}`);
  if (providers[host] === "down") return reply(429, { error: "Ratelimit exceed" });
  let match: RegExpExecArray | null;
  if (host === "toncenter") {
    const path = url.pathname.replace(/^\/api\/v3/, "");
    if (path === "/traces") {
      const trace = traceOf(url.searchParams.get("tx_hash")!);
      return reply(200, { traces: trace ? [{ trace_id: b64(trace[0].hash), transactions: Object.fromEntries(trace.map(tx => [b64(tx.hash), toncenterJson(tx)])) }] : [] });
    }
    if (path === "/transactions") {
      const account = raw(url.searchParams.get("account"));
      return reply(200, { transactions: traces.flat().filter(tx => tx.account === account && (tx.now ?? NOW) >= Number(url.searchParams.get("start_utime"))).map(toncenterJson) });
    }
    if (path === "/runGetMethod") {
      const body = JSON.parse(String(init?.body));
      const owner = addressFromBoc(Buffer.from(body.stack[0].value, "base64"))!;
      const wallet = body.method === "get_wallet_address" ? jettonWallets.get(`${raw(body.address)}|${rawTonAddress(owner)}`) : undefined;
      return reply(200, wallet ? { gas_used: 3143, exit_code: 0, stack: [{ type: "cell", value: addressSliceBoc(parseTonAddress(wallet)!) }] } : { exit_code: 11, stack: [] });
    }
    if (path === "/account") return reply(200, { balance: String(balances.get(raw(url.searchParams.get("address"))) ?? 0n), status: "uninit" });
    if (path === "/jetton/wallets") {
      const wallet = raw(url.searchParams.get("address"));
      return reply(200, { jetton_wallets: balances.has(wallet) ? [{ address: upper(wallet), balance: String(balances.get(wallet)) }] : [] });
    }
  } else {
    const path = url.pathname.replace(/^\/v2/, "");
    if ((match = /^\/traces\/([0-9a-f]{64})$/.exec(path))) {
      const trace = traceOf(match[1])?.filter(tx => tx.final !== false);
      if (!trace?.length || !trace.some(tx => tx.hash === match![1])) return reply(404, { error: "entity not found" });
      const [root, ...rest] = trace;
      // As tonapi answers: a trace's transactions come without their messages.
      const node = (tx: Tx) => ({ transaction: { ...tonapiJson(tx), out_msgs: [] }, interfaces: [], emulated: false });
      return reply(200, { ...node(root), children: rest.map(tx => ({ ...node(tx), children: [] })) });
    }
    if ((match = /^\/blockchain\/accounts\/([^/]+)\/transactions$/.exec(path))) {
      const account = raw(match[1]);
      const found = traces.flat().filter(tx => tx.account === account && tx.final !== false);
      return found.length ? reply(200, { transactions: found.map(tonapiJson) }) : reply(404, { error: "account not found" });
    }
    if ((match = /^\/blockchain\/accounts\/([^/]+)\/methods\/get_wallet_address$/.exec(path))) {
      const wallet = jettonWallets.get(`${raw(match[1])}|${raw(url.searchParams.get("args"))}`);
      return reply(200, wallet ? { success: true, exit_code: 0, stack: [{ type: "cell", cell: Buffer.from(addressSliceBoc(parseTonAddress(wallet)!), "base64").toString("hex") }], decoded: { jetton_wallet_address: wallet } } : { success: false, exit_code: 11, stack: [] });
    }
    if ((match = /^\/blockchain\/accounts\/([^/]+)\/methods\/get_wallet_data$/.exec(path))) {
      const wallet = raw(match[1]);
      return balances.has(wallet) ? reply(200, { success: true, exit_code: 0, decoded: { balance: String(balances.get(wallet)) } }) : reply(404, { error: "entity not found" });
    }
    if ((match = /^\/accounts\/([^/]+)$/.exec(path))) return reply(200, { address: raw(match[1]), balance: Number(balances.get(raw(match[1])) ?? 0n), status: "nonexist" });
  }
  throw new Error(`unexpected request ${host} ${url.pathname}`);
}));

const payment = (patch: Partial<PaymentToVerify> = {}): PaymentToVerify => ({
  network: "ton", coin: "USDT", txHash: ROOT, wallet: WALLET, expectedUnits: 1_014_052n,
  notBefore: new Date((NOW - 600) * 1000), notAfter: new Date((NOW + 600) * 1000), ...patch,
});

/** The real USDT transfer's trace: the payer's wallet, its USDT wallet, the receiving jetton wallet, then the notification it sends. */
const usdtTrace = (patch: Partial<Tx> = {}, receiver = USDT_WALLET): Tx[] => [
  { hash: ROOT, account: PAYER, source: null, sends: 1 },
  { hash: hash(2), account: PAYER_USDT, source: PAYER, value: 25_000_001n, opcode: 0x0f8a7ea5, sends: 1 },
  { hash: RECEIVING, account: receiver, source: PAYER_USDT, value: 24_741_199n, bounce: true, opcode: INTERNAL_TRANSFER, jetton: { amount: 1_014_052n, from: PAYER }, sends: 1, ...patch },
  // The notification to the owner runs out of gas, as it often does; the USDT has arrived regardless.
  { hash: hash(4), account: OWNER, source: receiver, value: 1n, opcode: 0x7362d09c, aborted: true, computed: "skipped", final: patch.final },
];
/** GRAM sent straight to the wallet (never deployed: no code runs, so the transaction is "aborted" and the value stays). */
const gramTrace = (patch: Partial<Tx> = {}, extra: Tx[] = []): Tx[] => [
  { hash: ROOT, account: PAYER, source: null, sends: 1 },
  { hash: RECEIVING, account: OWNER, source: PAYER, value: 2_500_000_000n, bounce: false, aborted: true, computed: "skipped", ...patch },
  ...extra,
];

beforeEach(() => {
  traces.length = 0;
  balances.clear();
  calls.length = 0;
  providers.toncenter = "up";
  providers.tonapi = "up";
  resetTonJettonWallets();
  setTonSpacingForTests(0);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("TON addresses and hashes", () => {
  it("reads both forms, checks the checksum, and writes the non-bounceable form wallets should pay", () => {
    const usdt = parseTonAddress("EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs")!;
    expect(rawTonAddress(usdt)).toBe(USDT_MASTER);
    expect(usdt.bounceable).toBe(true);
    expect(parseTonAddress(upper(OWNER))).toMatchObject({ workchain: 0, hash: OWNER.slice(2) });
    expect(friendlyTonAddress(parseTonAddress(OWNER)!, { bounceable: false })).toBe(WALLET);
    expect(friendlyTonAddress(parseTonAddress(USDC_MASTER)!, { bounceable: true })).toBe("EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728");
    expect(parseTonAddress(`${WALLET.slice(0, -1)}G`)).toBeNull();
    expect(parseTonAddress(WALLET.slice(1))).toBeNull();
    expect(isValidTonAddress(WALLET)).toBe(true);
    expect(isValidTonAddress(`-1:${"ab".repeat(32)}`)).toBe(false); // the masterchain: not where wallets receive
    expect(isValidTonAddress("9f".repeat(32))).toBe(false); // a key, not an address
  });

  it("writes and reads the one-cell bags of cells get_wallet_address takes and returns, as both indexers send them", () => {
    expect(addressSliceBoc(parseTonAddress(OWNER)!)).toBe("te6ccgEBAQEAJAAAQ4AFQntUkWZbvbm9C89mS6Ekqt1nRWQA1Zk9/doD4TGTqvA=");
    // Mainnet answers for that owner: toncenter's (base64, with a checksum) and tonapi's (hex).
    expect(rawTonAddress(addressFromBoc(Buffer.from("te6cckEBAQEAJAAAQ4AINn2u50flqI/V+Wi82ovrkN7Gwi55H7LZKa338P/KDHAStcU6", "base64"))!)).toBe(USDT_WALLET);
    expect(rawTonAddress(addressFromBoc(Buffer.from("b5ee9c720101010100240000438008367daee747e5a88fd5f968bcda8beb90dec6c22e791fb2d929adf7f0ffca0c70", "hex"))!)).toBe(USDT_WALLET);
    expect(addressFromBoc(Buffer.from("not a bag of cells"))).toBeNull();
  });

  it("takes a transaction hash in hex or in base64, either alphabet, and keeps it as hex", () => {
    const base64 = b64(RECEIVING);
    expect(normalizeTxHash("ton", RECEIVING.toUpperCase())).toBe(RECEIVING);
    expect(normalizeTxHash("ton", ` ${base64} `)).toBe(RECEIVING);
    expect(normalizeTxHash("ton", base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=$/, ""))).toBe(RECEIVING);
    expect(normalizeTxHash("ton", `0x${RECEIVING}`)).toBeNull();
    expect(normalizeTxHash("ton", WALLET)).toBeNull();
    expect(normalizeTxHash("ton", base64.slice(0, -2))).toBeNull();
  });
});

describe("TON payments", () => {
  it("counts USDT that Curialy's own USDT jetton wallet accepted, from any hash of the transfer, and names the receiving transaction", async () => {
    traces.push(usdtTrace());
    for (const pasted of [ROOT, RECEIVING]) {
      expect(await verifyPayment(payment({ txHash: pasted }))).toMatchObject({ state: "confirmed", confirmations: 1, required: 1, receivedUnits: 1_014_052n, from: PAYER, txHash: RECEIVING });
    }
    expect(calls.every(call => call.startsWith("toncenter"))).toBe(true);
    // The second opinion reads the other indexer, derives the jetton wallet itself, and agrees.
    calls.length = 0;
    expect(await verifyPayment(payment(), { skipProvider: "toncenter.com" })).toMatchObject({ state: "confirmed", receivedUnits: 1_014_052n, txHash: RECEIVING });
    expect(calls).toContain("tonapi /v2/blockchain/accounts/0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe/methods/get_wallet_address");
    expect(calls.some(call => call.startsWith("toncenter"))).toBe(false);
  });

  it("never counts a token that only calls itself USDT, a transfer Curialy's jetton wallet rejected, or the wrong coin", async () => {
    traces.push(usdtTrace({}, FAKE_WALLET));
    expect(await verifyPayment(payment())).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDT on TON to the Curialy wallet." });
    traces.splice(0, 1, usdtTrace({ aborted: true, computed: false }));
    expect(await verifyPayment(payment())).toMatchObject({ state: "mismatch", reason: FAILED });
    traces.splice(0, 1, usdtTrace());
    expect(await verifyPayment(payment({ coin: "USDC" }))).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDC on TON to the Curialy wallet." });
    // tonapi can't tell a finished trace from a running one, so on its own it keeps looking (the payment goes to the operator after 30 minutes).
    expect(await verifyPayment(payment({ coin: "USDC" }), { skipProvider: "toncenter.com" })).toEqual({ state: "seen" });
    // A transfer Curialy's jetton wallet rejected is plain from either.
    traces.splice(0, 1, usdtTrace({ aborted: true, computed: false }));
    expect(await verifyPayment(payment(), { skipProvider: "toncenter.com" })).toMatchObject({ state: "mismatch", reason: FAILED });
    traces.splice(0, 1, usdtTrace());
    // The payer's own USDT wallet sending the transfer: an outgoing transfer, not a failed incoming one.
    jettonWallets.set(`${USDT_MASTER}|${PAYER}`, PAYER_USDT);
    expect(await verifyPayment(payment({ wallet: friendlyTonAddress(parseTonAddress(PAYER)!, { bounceable: false }) }))).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDT on TON to the Curialy wallet." });
    jettonWallets.delete(`${USDT_MASTER}|${PAYER}`);
    // The exact amount, as on every network.
    expect(await verifyPayment(payment({ expectedUnits: 1_014_053n }))).toMatchObject({ state: "mismatch", reason: "This transaction sent 1.014052 USDT to the Curialy wallet; this order expects exactly 1.014053 USDT." });
  });

  it("counts GRAM credited to a wallet that isn't deployed yet, but not a transfer that came back", async () => {
    const gram = payment({ coin: "GRAM", expectedUnits: 2_500_000_000n });
    traces.push(gramTrace());
    expect(await verifyPayment(gram)).toMatchObject({ state: "confirmed", receivedUnits: 2_500_000_000n, from: PAYER, txHash: RECEIVING });
    // Sent bounceable to a wallet with no code: it fails and the value goes back with the bounce.
    const bounceBack: Tx = { hash: hash(9), account: PAYER, source: OWNER, value: 2_499_000_000n, bounced: true };
    traces.splice(0, 1, gramTrace({ bounce: true, sends: 1 }, [bounceBack]));
    expect(await verifyPayment(gram)).toMatchObject({ state: "mismatch", reason: FAILED });
    traces.splice(0, 1, gramTrace({ aborted: false, computed: true, bouncePhase: true }, [bounceBack]));
    expect(await verifyPayment(gram)).toMatchObject({ state: "mismatch", reason: FAILED });
  });

  it("waits for a transfer that hasn't landed, and never reads a trace an indexer hasn't finished as unpaid", async () => {
    traces.push(usdtTrace({ final: false }));
    // toncenter shows the receiving transaction emulated: confirming, not confirmed.
    expect(await verifyPayment(payment())).toMatchObject({ state: "confirming", confirmations: 0, required: 1, txHash: RECEIVING });
    // tonapi doesn't have it yet: the payer's jetton wallet sent a message that hasn't run, so the trace isn't over.
    expect(await verifyPayment(payment(), { skipProvider: "toncenter.com" })).toEqual({ state: "seen" });
    traces.length = 0;
    expect(await verifyPayment(payment())).toEqual({ state: "not_found" });
  });

  it("picks the order's own transfer out of a batch that pays several, by its exact amount", async () => {
    const other = (n: number, value: bigint): Tx => ({ hash: hash(n), account: OWNER, source: PAYER, value, bounce: false, aborted: true, computed: "skipped" });
    traces.push([{ hash: ROOT, account: PAYER, source: null, sends: 3 }, other(11, 1_000_000_000n), other(12, 2_500_000_000n), other(13, 3_000_000_000n)]);
    expect(await verifyPayment(payment({ coin: "GRAM", expectedUnits: 2_500_000_000n }))).toMatchObject({ state: "confirmed", receivedUnits: 2_500_000_000n, txHash: hash(12) });
  });

  it("finds payments into the wallet and its genuine jetton wallets without a hash", async () => {
    const fake = usdtTrace({}, FAKE_WALLET).map(tx => ({ ...tx, hash: `f${tx.hash.slice(1)}` }));
    traces.push(usdtTrace(), gramTrace({}).map(tx => ({ ...tx, hash: `a${tx.hash.slice(1)}` })), fake);
    const found = await incomingPayments("ton", WALLET, new Date((NOW - 60) * 1000), ["USDT", "USDC", "GRAM"]);
    expect(found).toEqual(expect.arrayContaining([
      { txHash: RECEIVING, coin: "USDT", units: 1_014_052n, blockTime: new Date(NOW * 1000) },
      { txHash: `a${RECEIVING.slice(1)}`, coin: "GRAM", units: 2_500_000_000n, blockTime: new Date(NOW * 1000) },
    ]));
    expect(found.some(entry => entry.coin === "USDT" && entry.txHash.startsWith("f"))).toBe(false);
    // Nothing yet in a jetton wallet that has never received anything; and nothing older than asked for.
    expect(await incomingPayments("ton", WALLET, new Date((NOW + 60) * 1000), ["USDT", "USDC", "GRAM"])).toEqual([]);
    // The other indexer finds the same, every transaction of the listing read as final.
    providers.toncenter = "down";
    expect(await incomingPayments("ton", WALLET, new Date((NOW - 60) * 1000), ["USDT", "USDC", "GRAM"])).toEqual(expect.arrayContaining(found));
  });

  it("reads what the wallet holds, a jetton wallet never used as zero", async () => {
    balances.set(OWNER, 12_408_731_542n);
    balances.set(USDT_WALLET, 49_801_200n);
    expect(await walletHoldings("ton", WALLET)).toEqual({ coins: [{ coin: "USDT", units: 49_801_200n }, { coin: "USDC", units: 0n }, { coin: "GRAM", units: 12_408_731_542n }], unavailable: false });
  });

  it("moves to the other indexer when one fails, and never names either in the log", async () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    traces.push(usdtTrace());
    providers.toncenter = "down";
    expect(await verifyPayment(payment())).toMatchObject({ state: "confirmed", txHash: RECEIVING });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/TON endpoint 1 of 2 failed \(traces: HTTP 429\)/);
    providers.tonapi = "down";
    expect(await verifyPayment(payment())).toEqual({ state: "unavailable" });
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/toncenter|tonapi|https?:/);
  });
});
