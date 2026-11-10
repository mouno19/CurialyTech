import { coinOn, networkInfo, type CoinId, type CoinOnNetwork, type NetworkId, type NetworkInfo } from "@shared/billing";

// On-chain checks of a payment, with public addresses only (no key is ever involved). A transaction
// pays an order when it sent the exact amount of the right coin to the order's wallet, succeeded,
// is deep enough in the chain, and was made inside the order's window. JSON-RPC over fetch: the
// operator's endpoints (PAY_RPC_*) first, then public ones. One check uses one endpoint for all its
// calls (heights differ between providers) and moves to the next when one fails.

export type ChainCheck =
  | { state: "not_found" }
  /** In the mempool, not in a block yet. */
  | { state: "seen" }
  /** secondCheck: one provider shows it confirmed, and a second one has yet to (orders.ts asks one before anything is credited). */
  | { state: "confirming" | "confirmed"; confirmations: number; required: number; from: string | null; receivedUnits: bigint; blockTime: Date; secondCheck?: boolean }
  /** reason: safe to show the payer. */
  | { state: "mismatch"; reason: string; from?: string | null; receivedUnits?: bigint; blockTime?: Date }
  /** Every endpoint failed. */
  | { state: "unavailable" };

export type PaymentToVerify = {
  network: NetworkId;
  coin: CoinId;
  txHash: string;
  wallet: string;
  expectedUnits: bigint;
  /** The transaction's block must not be older than this (when the details were issued, less a margin)... */
  notBefore: Date;
  /** ...nor newer than this (the end of the window, plus a margin). */
  notAfter: Date;
};

const BUILT_IN_RPC: Record<NetworkId, string[]> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://eth.merkle.io"],
  bnb: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://1rpc.io/bnb"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://1rpc.io/matic"],
  solana: ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"],
};
const RPC_ENV: Record<NetworkId, string> = { ethereum: "PAY_RPC_ETHEREUM", bnb: "PAY_RPC_BNB", polygon: "PAY_RPC_POLYGON", solana: "PAY_RPC_SOLANA" };
const RPC_TIMEOUT_MS = 8_000;

/** keccak-256 of Transfer(address,address,uint256): the ERC-20 transfer event. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const warned = new Set<string>();

/** The endpoints a check tries, in order. Operator URLs may carry an API key: they are never logged. */
export function rpcEndpoints(network: NetworkId): string[] {
  const name = RPC_ENV[network];
  const listed = (process.env[name] ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
  const own = listed.filter(isHttps);
  if (own.length < listed.length && !warned.has(name)) {
    warned.add(name);
    console.warn(`[Curialy Billing] ${name}: ${listed.length - own.length} of its entries skipped (only https URLs are used).`);
  }
  return [...new Set([...own, ...BUILT_IN_RPC[network]])];
}

class RpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new RpcError(`${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { code?: number } };
  if (body.error) throw new RpcError(`${method}: error ${body.error.code ?? "?"}`, body.error.code);
  if (!("result" in body)) throw new RpcError(`${method}: no result`);
  return body.result as T;
}

/** Why an endpoint failed, in words that name neither the endpoint nor its URL. */
const describe = (error: unknown) =>
  error instanceof RpcError ? error.message : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timed out" : error instanceof Error ? error.name : "failed";

/** "2.0037" from 2003700 at 6 decimals (no trailing zeros). */
export function formatUnits(units: bigint, decimals: number) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const fraction = decimals ? (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${abs / base}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Who runs an endpoint: its host's last two labels (eth.drpc.org and polygon.drpc.org are one
 * provider). Never shown to anyone: it only keeps a second check off the provider of the first.
 */
export function providerOf(url: string) {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return url;
  }
}

/**
 * skipProvider: leave out that provider's endpoints (a second opinion); onAnswer: told which
 * provider answered.
 */
export async function verifyPayment(input: PaymentToVerify, opts: { skipProvider?: string; onAnswer?: (provider: string) => void } = {}): Promise<ChainCheck> {
  const info = networkInfo(input.network);
  const coin = coinOn(input.network, input.coin);
  if (!info || !coin) return { state: "mismatch", reason: "This order's network or coin is no longer offered." };
  const endpoints = rpcEndpoints(input.network).filter(url => providerOf(url) !== opts.skipProvider);
  for (const [index, url] of endpoints.entries()) {
    try {
      const check = info.family === "evm" ? await checkEvm(url, input, info, coin) : await checkSolana(url, input, info, coin);
      opts.onAnswer?.(providerOf(url));
      return check;
    } catch (error) {
      console.warn(`[Curialy Billing] ${info.label} endpoint ${index + 1} of ${endpoints.length} failed (${describe(error)}).`);
    }
  }
  return { state: "unavailable" };
}

// ---- What the wallets hold (the operator's view) ----

/** balanceOf(address): the ERC-20 balance call. */
const BALANCE_OF = "0x70a08231";

/**
 * What a wallet holds of each of the network's coins, in base units (null for a coin that couldn't
 * be read), from the first endpoint that answers. Read by address only, like every check here.
 */
export async function walletHoldings(network: NetworkId, wallet: string): Promise<{ coins: { coin: CoinId; units: bigint | null }[]; unavailable: boolean }> {
  const info = networkInfo(network);
  if (!info) return { coins: [], unavailable: true };
  for (const url of rpcEndpoints(network)) {
    try {
      const coins = await Promise.all(info.coins.map(async coin => ({ coin: coin.coin, units: await holding(url, info, coin, wallet) })));
      return { coins, unavailable: false };
    } catch (error) {
      console.warn(`[Curialy Billing] ${info.label} balance read failed (${describe(error)}).`);
    }
  }
  return { coins: info.coins.map(coin => ({ coin: coin.coin, units: null })), unavailable: true };
}

async function holding(url: string, info: NetworkInfo, coin: CoinOnNetwork, wallet: string): Promise<bigint> {
  if (info.family === "evm") {
    if (coin.kind === "native") return BigInt(await rpc<string>(url, "eth_getBalance", [wallet, "latest"]));
    const data = `${BALANCE_OF}${wallet.toLowerCase().slice(2).padStart(64, "0")}`;
    const each = await Promise.all(coin.tokens.map(token => rpc<string>(url, "eth_call", [{ to: token, data }, "latest"])));
    return each.reduce((sum, value) => sum + BigInt(value && value !== "0x" ? value : 0), 0n);
  }
  if (coin.kind === "native") return BigInt((await rpc<{ value: number }>(url, "getBalance", [wallet, { commitment: "confirmed" }])).value);
  let total = 0n;
  for (const mint of coin.tokens) {
    const { value } = await rpc<{ value: { account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[] }>(
      url, "getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
    );
    for (const entry of value) total += BigInt(entry.account.data.parsed?.info?.tokenAmount?.amount ?? "0");
  }
  return total;
}

type Found = { received: bigint; from: string | null; blockTime: Date; confirmations: number; required: number };

/** What a transaction that made it into a block means for the order. */
function judge(input: PaymentToVerify, info: NetworkInfo, coin: CoinOnNetwork, found: Found): ChainCheck {
  const { received, from, blockTime } = found;
  const mismatch = (reason: string): ChainCheck => ({ state: "mismatch", reason, from, receivedUnits: received > 0n ? received : 0n, blockTime });
  if (received <= 0n) return mismatch(`This transaction didn't send ${coin.coin} on ${info.label} to the Curialy wallet.`);
  // Written to fail closed: a time that isn't one is outside the window.
  if (!(blockTime.getTime() >= input.notBefore.getTime())) return mismatch("This transaction was made before this order's payment details were issued.");
  if (!(blockTime.getTime() <= input.notAfter.getTime())) return mismatch("This transaction arrived after the payment window closed.");
  if (received !== input.expectedUnits) {
    return mismatch(`This transaction sent ${formatUnits(received, coin.decimals)} ${coin.coin} to the Curialy wallet; this order expects exactly ${formatUnits(input.expectedUnits, coin.decimals)} ${coin.coin}.`);
  }
  return { state: found.confirmations >= found.required ? "confirmed" : "confirming", confirmations: found.confirmations, required: found.required, from, receivedUnits: received, blockTime };
}

const FAILED = "This transaction failed on the network, so nothing was received.";

// ---- EVM (Ethereum, BNB Chain, Polygon) ----

type EvmTx = { from: string; to: string | null; value: string; blockNumber: string | null };
type EvmLog = { address: string; topics: string[]; data: string; removed?: boolean };
type EvmReceipt = { status?: string; blockNumber: string | null; blockHash?: string | null; logs?: EvmLog[] };
type EvmBlock = { hash?: string; timestamp: string };

async function checkEvm(url: string, input: PaymentToVerify, info: NetworkInfo, coin: CoinOnNetwork): Promise<ChainCheck> {
  const [tx, receipt] = await Promise.all([
    rpc<EvmTx | null>(url, "eth_getTransactionByHash", [input.txHash]),
    rpc<EvmReceipt | null>(url, "eth_getTransactionReceipt", [input.txHash]),
  ]);
  if (!tx) return { state: "not_found" };
  if (!receipt?.blockNumber) return { state: "seen" };
  const [latest, block] = await Promise.all([
    rpc<string>(url, "eth_blockNumber", []),
    rpc<EvmBlock | null>(url, "eth_getBlockByNumber", [receipt.blockNumber, false]),
  ]);
  // The block at that height is no longer the transaction's (a reorg under way): it counts again once re-included.
  if (!block || (block.hash && receipt.blockHash && block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())) return { state: "seen" };
  const blockTime = new Date(Number(BigInt(block.timestamp)) * 1000);
  const confirmations = Math.max(0, Number(BigInt(latest) - BigInt(receipt.blockNumber) + 1n));
  // Numbers no real chain gives (a broken or hostile endpoint): this endpoint failed, ask the next one.
  if (!Number.isFinite(blockTime.getTime()) || !Number.isSafeInteger(confirmations)) throw new RpcError("eth_getBlockByNumber: impossible block");
  if (receipt.status !== "0x1") return { state: "mismatch", reason: FAILED, from: tx.from ?? null, blockTime };
  const wallet = input.wallet.toLowerCase();
  let received = 0n;
  let from: string | null = tx.from ?? null;
  if (coin.kind === "native") {
    // Only a direct transfer shows its value on the transaction; one made by a contract is internal.
    if ((tx.to ?? "").toLowerCase() !== wallet) {
      return { state: "mismatch", reason: `This transaction didn't send ${coin.coin} to the Curialy wallet directly. Payments made through a contract (smart wallets, exchange withdrawals) are checked by hand.`, from, blockTime };
    }
    received = BigInt(tx.value);
  } else {
    // Any contract can emit a Transfer event: only the coin's own token contracts count.
    const contracts = new Set(coin.tokens.map(token => token.toLowerCase()));
    const to = `0x${wallet.slice(2).padStart(64, "0")}`;
    let first = true;
    for (const log of receipt.logs ?? []) {
      if (log.removed || !contracts.has(String(log.address).toLowerCase())) continue;
      const topics = (log.topics ?? []).map(topic => String(topic).toLowerCase());
      if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC || topics[2] !== to) continue;
      received += BigInt(log.data && log.data !== "0x" ? log.data : 0);
      if (first) from = `0x${topics[1].slice(-40)}`;
      first = false;
    }
  }
  return judge(input, info, coin, { received, from, blockTime, confirmations, required: info.confirmations });
}

// ---- Solana ----

type SolanaKey = string | { pubkey: string; signer?: boolean };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };
type SolanaTx = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: SolanaKey[] } };
};

/** Solana's newest transaction format (half of the USDC transfers on 2026-11-09 were version 1, which a lower maximum refuses). */
const SOLANA_TX_VERSION = 1;
/** The node's answer for a transaction in a format newer than the one asked for. */
const UNSUPPORTED_VERSION = -32015;

async function checkSolana(url: string, input: PaymentToVerify, info: NetworkInfo, coin: CoinOnNetwork): Promise<ChainCheck> {
  const get = async (commitment: "finalized" | "confirmed") => {
    try {
      return await rpc<SolanaTx | null>(url, "getTransaction", [input.txHash, { encoding: "jsonParsed", commitment, maxSupportedTransactionVersion: SOLANA_TX_VERSION }]);
    } catch (error) {
      // Every endpoint would say the same: not an outage, a payment for the operator to check.
      if (error instanceof RpcError && error.code === UNSUPPORTED_VERSION) return "unsupported" as const;
      throw error;
    }
  };
  let tx = await get("finalized");
  const finalized = Boolean(tx);
  // Not finalized yet: a confirmed transaction is confirming.
  if (!tx) tx = await get("confirmed");
  if (tx === "unsupported") return { state: "mismatch", reason: "This transaction uses a format that can't be checked automatically yet, so it is checked by hand." };
  if (!tx) return { state: "not_found" };
  if (!tx.meta) throw new RpcError("getTransaction: no meta");
  const seconds = tx.blockTime ?? (await rpc<number | null>(url, "getBlockTime", [tx.slot]));
  if (!seconds) throw new RpcError("getBlockTime: none");
  const blockTime = new Date(seconds * 1000);
  if (!Number.isFinite(blockTime.getTime())) throw new RpcError("getTransaction: impossible block time");
  const keys = tx.transaction.message.accountKeys.map(key => (typeof key === "string" ? { pubkey: key, signer: false } : key));
  const from = keys.find(key => key.signer)?.pubkey ?? keys[0]?.pubkey ?? null;
  if (tx.meta.err !== null && tx.meta.err !== undefined) return { state: "mismatch", reason: FAILED, from, blockTime };
  let received = 0n;
  if (coin.kind === "native") {
    const index = keys.findIndex(key => key.pubkey === input.wallet);
    if (index >= 0) received = BigInt(tx.meta.postBalances[index] ?? 0) - BigInt(tx.meta.preBalances[index] ?? 0);
  } else {
    // The wallet's token accounts for the coin's mints: what each holds after, less what it held before
    // (nothing, when the transaction opened the account).
    const mints = new Set(coin.tokens);
    for (const post of tx.meta.postTokenBalances ?? []) {
      if (post.owner !== input.wallet || !mints.has(post.mint)) continue;
      const pre = (tx.meta.preTokenBalances ?? []).find(entry => entry.accountIndex === post.accountIndex);
      received += BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0");
    }
  }
  return judge(input, info, coin, { received, from, blockTime, confirmations: finalized ? 1 : 0, required: info.confirmations });
}
