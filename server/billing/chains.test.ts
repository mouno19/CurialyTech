import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coinOn } from "@shared/billing";
import { rpcEndpoints, TRANSFER_TOPIC, verifyPayment, type PaymentToVerify } from "./chains";

// The on-chain check, over JSON-RPC fixtures shaped like real node answers: only the coin's own
// token contracts count, only transfers to the wallet, only the exact amount, only a successful
// transaction deep enough in the chain and inside the order's window. One endpoint answers a whole
// check; a failing one hands over to the next, and no endpoint is ever named in a log.

const WALLET = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const SOL_WALLET = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";
const PAYER = "0x6e6fe982d6a63a702916c2d611c61fb2a59eb56e";
const OTHER = "0x2252f216f4a494a87025123425181ca1bb754fb8";
const SIGNATURE = "2bTkYQWRZwN2SDg3a22gen7N9TDSHLzUugwovDe1jUaZrY8yQekxXLLLA676WzM4ED7LZxf36hcGW597ZH6Td6Nv";
const HASH = "0xe21079237a30b16fd1be1d214728944a33185b5567566795b39d77471764a45c";
const BLOCK = 47_400_000;
const BLOCK_TIME = Date.parse("2026-11-09T14:03:32Z");

const hex = (value: number | bigint) => `0x${value.toString(16)}`;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const token = (network: "bnb" | "ethereum" | "polygon", coin: "USDT" | "USDC") => coinOn(network, coin)!.tokens[0];

type Log = { address: string; to: string; amount: bigint; from?: string };
type EvmCase = { to: string; value?: bigint; logs?: Log[]; status?: string; mined?: boolean; latest?: number; blockHash?: string; time?: number };

/** A node's view of one transaction (null: it doesn't know the hash). */
function evmNode(fixture: EvmCase | null) {
  const blockHash = "0x4f1c3cbbb2d5f0d6d03d0e27f8c5b1b50cfa5fa5a2a1cf4cdbf9d5e4f71b2a10";
  return (method: string, params: any[]) => {
    if (method === "eth_blockNumber") return hex(fixture?.latest ?? BLOCK + 40);
    if (!fixture) return null;
    const mined = fixture.mined !== false;
    if (method === "eth_getTransactionByHash") {
      return {
        blockHash: mined ? blockHash : null, blockNumber: mined ? hex(BLOCK) : null, from: PAYER, gas: "0x186a0", gasPrice: "0x3b9aca00", hash: params[0],
        input: fixture.logs?.length ? "0xa9059cbb" : "0x", nonce: "0x1b", to: fixture.to, transactionIndex: mined ? "0x4" : null, value: hex(fixture.value ?? 0n), type: "0x0", chainId: "0x38",
      };
    }
    if (method === "eth_getTransactionReceipt") {
      if (!mined) return null;
      return {
        blockHash, blockNumber: hex(BLOCK), contractAddress: null, cumulativeGasUsed: "0x1a2b3c", effectiveGasPrice: "0x3b9aca00", from: PAYER, gasUsed: "0xd0b4",
        logs: (fixture.logs ?? []).map((log, index) => ({
          address: log.address, topics: [TRANSFER_TOPIC, topic(log.from ?? PAYER), topic(log.to)], data: word(log.amount), blockNumber: hex(BLOCK),
          transactionHash: params[0], transactionIndex: "0x4", blockHash, logIndex: hex(index), removed: false,
        })),
        logsBloom: `0x${"0".repeat(512)}`, status: fixture.status ?? "0x1", to: fixture.to, transactionHash: params[0], transactionIndex: "0x4", type: "0x0",
      };
    }
    if (method === "eth_getBlockByNumber") {
      expect(params).toEqual([hex(BLOCK), false]);
      return { hash: fixture.blockHash ?? blockHash, number: hex(BLOCK), timestamp: hex(Math.floor((fixture.time ?? BLOCK_TIME) / 1000)), transactions: [] };
    }
    throw new Error(`unexpected method ${method}`);
  };
}

type Handler = (method: string, params: any[]) => unknown;
const nodes = new Map<string, Handler | "down" | "rpc-error">();
let fallback: Handler = () => null;
const calls: { url: string; method: string }[] = [];

beforeEach(() => {
  nodes.clear();
  calls.length = 0;
  fallback = () => null;
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const { method, params, jsonrpc } = JSON.parse(String(init.body));
    expect(jsonrpc).toBe("2.0");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    calls.push({ url, method });
    const node = nodes.get(url) ?? fallback;
    if (node === "down") throw new TypeError("fetch failed");
    if (node === "rpc-error") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: `limit exceeded at ${url}` } }), { status: 200 });
    try {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: node(method, params) }), { status: 200, headers: { "content-type": "application/json" } });
    } catch (error) {
      if (error instanceof RpcFailure) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: error.code, message: error.message } }), { status: 200 });
      throw error;
    }
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

class RpcFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const evm = (network: "bnb" | "ethereum" | "polygon", coin: PaymentToVerify["coin"], expectedUnits: bigint, patch: Partial<PaymentToVerify> = {}): PaymentToVerify => ({
  network, coin, txHash: HASH, wallet: WALLET, expectedUnits, notBefore: new Date(BLOCK_TIME - 600_000), notAfter: new Date(BLOCK_TIME + 1_800_000), ...patch,
});

describe("EVM token payments", () => {
  it("counts exact USDT on BNB Chain (18 decimals) and on Ethereum (6), with the payer and the block's time", async () => {
    const bnb = 2_003_700_000_000_000_000n;
    fallback = evmNode({ to: token("bnb", "USDT"), logs: [{ address: token("bnb", "USDT"), to: WALLET, amount: bnb }] });
    expect(await verifyPayment(evm("bnb", "USDT", bnb))).toEqual({ state: "confirmed", confirmations: 41, required: 20, from: PAYER, receivedUnits: bnb, blockTime: new Date(BLOCK_TIME) });
    expect(calls.map(call => call.method).sort()).toEqual(["eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);

    // The token contract's address in any case, the wallet lowercased in the topic.
    fallback = evmNode({ to: token("ethereum", "USDT"), logs: [{ address: token("ethereum", "USDT").toLowerCase(), to: WALLET, amount: 2_003_700n }] });
    expect(await verifyPayment(evm("ethereum", "USDT", 2_003_700n))).toMatchObject({ state: "confirmed", required: 12, receivedUnits: 2_003_700n });
  });

  it("never counts a look-alike token: any contract can emit Transfer to the wallet", async () => {
    const fakeToken = "0x55d398326f99059ff775485246999027b3197956";
    fallback = evmNode({ to: fakeToken, logs: [{ address: fakeToken, to: WALLET, amount: 2_003_700_000_000_000_000n }] });
    expect(await verifyPayment(evm("bnb", "USDT", 2_003_700_000_000_000_000n))).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDT on BNB Chain to the Curialy wallet.", receivedUnits: 0n });
    // USDC's contract doesn't pay a USDT order either.
    fallback = evmNode({ to: token("bnb", "USDC"), logs: [{ address: token("bnb", "USDC"), to: WALLET, amount: 2_003_700_000_000_000_000n }] });
    expect((await verifyPayment(evm("bnb", "USDT", 2_003_700_000_000_000_000n))).state).toBe("mismatch");
  });

  it("only counts transfers to the wallet, and adds up several", async () => {
    const usdt = token("polygon", "USDT");
    fallback = evmNode({ to: usdt, logs: [{ address: usdt, to: OTHER, amount: 2_003_700n }] });
    expect(await verifyPayment(evm("polygon", "USDT", 2_003_700n))).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDT on Polygon to the Curialy wallet." });
    // A batch: two transfers to the wallet (and one elsewhere) make the amount together; the sender is the token holder.
    fallback = evmNode({ to: "0x1111111254eeb25477b68fb85ed929f73a960582", logs: [
      { address: usdt, to: WALLET, amount: 2_000_000n, from: OTHER }, { address: usdt, to: OTHER, amount: 9_999n }, { address: usdt, to: WALLET, amount: 3_700n },
    ] });
    expect(await verifyPayment(evm("polygon", "USDT", 2_003_700n))).toMatchObject({ state: "confirmed", receivedUnits: 2_003_700n, from: OTHER, required: 32 });
  });

  it("says what a wrong amount sent and what the order expects, in the coin", async () => {
    fallback = evmNode({ to: token("bnb", "USDT"), logs: [{ address: token("bnb", "USDT"), to: WALLET, amount: 1_500_000_000_000_000_000n }] });
    expect(await verifyPayment(evm("bnb", "USDT", 2_003_700_000_000_000_000n))).toEqual({
      state: "mismatch", reason: "This transaction sent 1.5 USDT to the Curialy wallet; this order expects exactly 2.0037 USDT.", from: PAYER, receivedUnits: 1_500_000_000_000_000_000n, blockTime: new Date(BLOCK_TIME),
    });
    // One unit more is a mismatch too.
    fallback = evmNode({ to: token("ethereum", "USDC"), logs: [{ address: token("ethereum", "USDC"), to: WALLET, amount: 2_003_701n }] });
    expect(await verifyPayment(evm("ethereum", "USDC", 2_003_700n))).toMatchObject({ state: "mismatch", reason: "This transaction sent 2.003701 USDC to the Curialy wallet; this order expects exactly 2.0037 USDC." });
  });

  it("refuses a failed transaction even when its logs look right", async () => {
    fallback = evmNode({ to: token("bnb", "USDT"), status: "0x0", logs: [{ address: token("bnb", "USDT"), to: WALLET, amount: 2n }] });
    expect(await verifyPayment(evm("bnb", "USDT", 2n))).toMatchObject({ state: "mismatch", reason: "This transaction failed on the network, so nothing was received." });
  });

  it("tells an unknown hash from one still waiting in the mempool", async () => {
    fallback = evmNode(null);
    expect(await verifyPayment(evm("bnb", "USDT", 2n))).toEqual({ state: "not_found" });
    fallback = evmNode({ to: token("bnb", "USDT"), mined: false });
    expect(await verifyPayment(evm("bnb", "USDT", 2n))).toEqual({ state: "seen" });
  });

  it("waits for enough confirmations, and treats a block that was replaced as not in one yet", async () => {
    const usdt = token("ethereum", "USDT");
    fallback = evmNode({ to: usdt, latest: BLOCK + 6, logs: [{ address: usdt, to: WALLET, amount: 2_003_700n }] });
    expect(await verifyPayment(evm("ethereum", "USDT", 2_003_700n))).toMatchObject({ state: "confirming", confirmations: 7, required: 12 });
    fallback = evmNode({ to: usdt, latest: BLOCK + 11, logs: [{ address: usdt, to: WALLET, amount: 2_003_700n }] });
    expect(await verifyPayment(evm("ethereum", "USDT", 2_003_700n))).toMatchObject({ state: "confirmed", confirmations: 12 });
    // The block at that height has another hash now: a reorganisation.
    fallback = evmNode({ to: usdt, blockHash: "0x9999999999999999999999999999999999999999999999999999999999999999", logs: [{ address: usdt, to: WALLET, amount: 2_003_700n }] });
    expect(await verifyPayment(evm("ethereum", "USDT", 2_003_700n))).toEqual({ state: "seen" });
  });

  it("only counts a payment made inside the order's window", async () => {
    const usdt = token("bnb", "USDT");
    fallback = evmNode({ to: usdt, logs: [{ address: usdt, to: WALLET, amount: 2n }] });
    expect(await verifyPayment(evm("bnb", "USDT", 2n, { notBefore: new Date(BLOCK_TIME + 1000) }))).toMatchObject({
      state: "mismatch", reason: "This transaction was made before this order's payment details were issued.", receivedUnits: 2n,
    });
    expect(await verifyPayment(evm("bnb", "USDT", 2n, { notAfter: new Date(BLOCK_TIME - 1000) }))).toMatchObject({ state: "mismatch", reason: "This transaction arrived after the payment window closed." });
  });
});

describe("EVM native payments", () => {
  it("counts the exact value sent straight to the wallet, and leaves one made through a contract to the operator", async () => {
    const value = 5_714_300_000_000_000n;
    fallback = evmNode({ to: WALLET.toLowerCase(), value });
    expect(await verifyPayment(evm("bnb", "BNB", value))).toMatchObject({ state: "confirmed", receivedUnits: value, from: PAYER });
    fallback = evmNode({ to: WALLET, value: value - 1n });
    expect((await verifyPayment(evm("bnb", "BNB", value))).state).toBe("mismatch");
    // A smart wallet or an exchange sends it from a contract: the value moves internally.
    fallback = evmNode({ to: "0x00000000219ab540356cbb839cbe05303d7705fa", value: 0n });
    expect(await verifyPayment(evm("ethereum", "ETH", value))).toMatchObject({
      state: "mismatch", reason: "This transaction didn't send ETH to the Curialy wallet directly. Payments made through a contract (smart wallets, exchange withdrawals) are checked by hand.",
    });
  });
});

// ---- Solana ----

const USDC_MINT = coinOn("solana", "USDC")!.tokens[0];
const SOL_PAYER = "Bvg6QYGoRFihvntWNwhgcK9vYq7jPNwekBDVU97f9tU3";
type Balance = { index: number; mint: string; owner: string; amount: string };
type SolanaCase = { keys: string[]; pre?: number[]; post?: number[]; preTokens?: Balance[]; postTokens?: Balance[]; err?: unknown; version?: number | "legacy" };

function solanaTx(fixture: SolanaCase) {
  const tokens = (list: Balance[] = []) => list.map(entry => ({
    accountIndex: entry.index, mint: entry.mint, owner: entry.owner, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    uiTokenAmount: { amount: entry.amount, decimals: 6, uiAmount: Number(entry.amount) / 1e6, uiAmountString: String(Number(entry.amount) / 1e6) },
  }));
  return {
    blockTime: Math.floor(BLOCK_TIME / 1000), slot: 381_220_114, version: fixture.version ?? 0,
    meta: {
      err: fixture.err ?? null, fee: 5000, computeUnitsConsumed: 6200, innerInstructions: [], logMessages: [], rewards: [], status: fixture.err ? { Err: fixture.err } : { Ok: null },
      preBalances: fixture.pre ?? fixture.keys.map(() => 2_039_280), postBalances: fixture.post ?? fixture.keys.map(() => 2_039_280),
      preTokenBalances: tokens(fixture.preTokens), postTokenBalances: tokens(fixture.postTokens),
    },
    transaction: {
      message: { accountKeys: fixture.keys.map((pubkey, index) => ({ pubkey, signer: index === 0, source: "transaction", writable: index < 3 })), instructions: [], recentBlockhash: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" },
      signatures: [SIGNATURE],
    },
  };
}

/** A node that has the transaction at `finalized` (or only at `confirmed`). */
const solanaNode = (tx: object | null, finalized = true): Handler => (method, params) => {
  if (method === "getTransaction") {
    expect(params[0]).toBe(SIGNATURE);
    expect(params[1]).toMatchObject({ encoding: "jsonParsed", maxSupportedTransactionVersion: 1 });
    return params[1].commitment === "finalized" ? (finalized ? tx : null) : tx;
  }
  throw new Error(`unexpected method ${method}`);
};

const solana = (coin: PaymentToVerify["coin"], expectedUnits: bigint): PaymentToVerify => ({
  network: "solana", coin, txHash: SIGNATURE, wallet: SOL_WALLET, expectedUnits, notBefore: new Date(BLOCK_TIME - 600_000), notAfter: new Date(BLOCK_TIME + 1_800_000),
});

describe("Solana payments", () => {
  const keys = [SOL_PAYER, "4i6g6pTxVJZcSixvKMemmDWsPv9aRSH3m3b6WduXJrhK", "7zKpN8yzs1Qe5ihVxDK4gMS6sRTtDJ6eTpL4smWnDqqf", USDC_MINT, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"];

  it("counts USDC into the wallet's token account, whether it existed before or the payment opened it", async () => {
    fallback = solanaNode(solanaTx({
      keys,
      preTokens: [{ index: 1, mint: USDC_MINT, owner: SOL_PAYER, amount: "10000000" }, { index: 2, mint: USDC_MINT, owner: SOL_WALLET, amount: "500000" }],
      postTokens: [{ index: 1, mint: USDC_MINT, owner: SOL_PAYER, amount: "7996300" }, { index: 2, mint: USDC_MINT, owner: SOL_WALLET, amount: "2503700" }],
    }));
    expect(await verifyPayment(solana("USDC", 2_003_700n))).toEqual({ state: "confirmed", confirmations: 1, required: 1, from: SOL_PAYER, receivedUnits: 2_003_700n, blockTime: new Date(BLOCK_TIME) });
    // A new token account: no balance before it.
    fallback = solanaNode(solanaTx({
      keys, version: 1,
      preTokens: [{ index: 1, mint: USDC_MINT, owner: SOL_PAYER, amount: "10000000" }],
      postTokens: [{ index: 1, mint: USDC_MINT, owner: SOL_PAYER, amount: "7996300" }, { index: 2, mint: USDC_MINT, owner: SOL_WALLET, amount: "2003700" }],
    }));
    expect(await verifyPayment(solana("USDC", 2_003_700n))).toMatchObject({ state: "confirmed", receivedUnits: 2_003_700n });
  });

  it("counts only the coin's mint, and only token accounts the wallet owns", async () => {
    fallback = solanaNode(solanaTx({ keys, postTokens: [{ index: 2, mint: "FakeUSDCmint1111111111111111111111111111111", owner: SOL_WALLET, amount: "2003700" }, { index: 1, mint: USDC_MINT, owner: SOL_PAYER, amount: "2003700" }] }));
    expect(await verifyPayment(solana("USDC", 2_003_700n))).toMatchObject({ state: "mismatch", reason: "This transaction didn't send USDC on Solana to the Curialy wallet." });
  });

  it("counts SOL by the wallet's balance change", async () => {
    fallback = solanaNode(solanaTx({ keys: [SOL_PAYER, SOL_WALLET, "11111111111111111111111111111111"], pre: [1_000_000_000, 0, 1], post: [986_661_000, 13_334_000, 1] }));
    expect(await verifyPayment(solana("SOL", 13_334_000n))).toMatchObject({ state: "confirmed", receivedUnits: 13_334_000n, from: SOL_PAYER });
    expect(await verifyPayment(solana("SOL", 13_334_001n))).toMatchObject({ state: "mismatch", reason: "This transaction sent 0.013334 SOL to the Curialy wallet; this order expects exactly 0.013334001 SOL." });
  });

  it("is confirming until finalized, refuses a failed transaction, and doesn't know an unknown signature", async () => {
    const paid = solanaTx({ keys: [SOL_PAYER, SOL_WALLET], pre: [1_000_000_000, 0], post: [986_661_000, 13_334_000] });
    fallback = solanaNode(paid, false);
    expect(await verifyPayment(solana("SOL", 13_334_000n))).toMatchObject({ state: "confirming", confirmations: 0, required: 1 });
    fallback = solanaNode(solanaTx({ keys: [SOL_PAYER, SOL_WALLET], pre: [1_000_000_000, 0], post: [999_995_000, 0], err: { InstructionError: [0, { Custom: 1 }] } }));
    expect(await verifyPayment(solana("SOL", 13_334_000n))).toMatchObject({ state: "mismatch", reason: "This transaction failed on the network, so nothing was received." });
    fallback = solanaNode(null);
    expect(await verifyPayment(solana("SOL", 13_334_000n))).toEqual({ state: "not_found" });
  });

  it("leaves a transaction in a format the node can't give to the operator, instead of calling it an outage", async () => {
    fallback = method => {
      if (method === "getTransaction") throw new RpcFailure(-32015, "Transaction version (2) is not supported by the requesting client.");
      return null;
    };
    expect(await verifyPayment(solana("USDC", 2_003_700n))).toMatchObject({ state: "mismatch" });
    expect(calls).toHaveLength(1);
  });
});

describe("endpoints", () => {
  it("tries the operator's endpoints first, https only, and never logs them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("PAY_RPC_BNB", " https://bsc.private.example/v1/sk_live_123 , http://plain.example, not a url,https://bsc-rpc.publicnode.com");
    expect(rpcEndpoints("bnb")).toEqual(["https://bsc.private.example/v1/sk_live_123", "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://1rpc.io/bnb"]);
    expect(JSON.stringify(warn.mock.calls)).toContain("PAY_RPC_BNB: 2 of its entries skipped");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/example|sk_live/);
    expect(rpcEndpoints("solana")).toEqual(["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"]);
  });

  it("treats an impossible block time as that endpoint failing, and asks the next", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const usdt = token("bnb", "USDT");
    const fixture = { to: usdt, latest: BLOCK + 25, logs: [{ address: usdt, to: WALLET, amount: 2n }] };
    nodes.set("https://bsc-rpc.publicnode.com", (method, params) => (method === "eth_getBlockByNumber" ? { hash: undefined, number: hex(BLOCK), timestamp: "0xffffffffffffffffffff", transactions: [] } : evmNode(fixture)(method, params)));
    nodes.set("https://bsc-dataseed.bnbchain.org", evmNode(fixture));
    expect(await verifyPayment(evm("bnb", "USDT", 2n))).toMatchObject({ state: "confirmed", confirmations: 26 });
  });

  it("moves to the next endpoint when one fails, and checks with that one alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const usdt = token("bnb", "USDT");
    const good = evmNode({ to: usdt, latest: BLOCK + 25, logs: [{ address: usdt, to: WALLET, amount: 2n }] });
    // The first knows the transaction but fails halfway (its height would differ anyway).
    nodes.set("https://bsc-rpc.publicnode.com", (method, params) => {
      if (method === "eth_blockNumber") throw new RpcFailure(-32603, "header not found");
      return evmNode({ to: usdt, latest: BLOCK + 2, logs: [{ address: usdt, to: WALLET, amount: 2n }] })(method, params);
    });
    nodes.set("https://bsc-dataseed.bnbchain.org", good);
    expect(await verifyPayment(evm("bnb", "USDT", 2n))).toMatchObject({ state: "confirmed", confirmations: 26 });
    expect(calls.filter(call => call.url === "https://bsc-dataseed.bnbchain.org").map(call => call.method).sort()).toEqual(["eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt"]);
    expect(calls.some(call => call.url === "https://bsc-dataseed1.defibit.io")).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).toContain("BNB Chain endpoint 1 of 4 failed");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/publicnode|bnbchain|https?:/);
  });

  it("is unavailable when every endpoint fails, whatever the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Unreachable, a JSON-RPC error, and an HTML error page.
    nodes.set("https://ethereum-rpc.publicnode.com", "down");
    nodes.set("https://eth.drpc.org", "rpc-error");
    nodes.set("https://eth.merkle.io", () => {
      throw new Error("bad gateway");
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
      if (String(input) === "https://eth.merkle.io") {
        calls.push({ url: String(input), method: JSON.parse(String(init.body)).method });
        return new Response("<html>502 Bad Gateway</html>", { status: 502 });
      }
      return realFetch(input, init);
    });
    expect(await verifyPayment(evm("ethereum", "USDT", 2n))).toEqual({ state: "unavailable" });
    expect(new Set(calls.map(call => call.url)).size).toBe(3);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/publicnode|drpc|merkle|https?:/);
  });
});
