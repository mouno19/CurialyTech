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
  const received = solanaReceived(tx, input.wallet, coin);
  return judge(input, info, coin, { received, from, blockTime, confirmations: finalized ? 1 : 0, required: info.confirmations });
}

// ---- Incoming payments (no hash from the payer) ----

/** A transfer into the receiving wallet, read from the chain without anyone pasting a hash. */
export type InboundPayment = { txHash: string; coin: CoinId; units: bigint; blockTime: Date };

/** Rough seconds per block, only to choose how far back a scan looks. */
const BLOCK_SECONDS: Record<NetworkId, number> = { ethereum: 12, bnb: 3, polygon: 2, solana: 1 };
/** How many blocks one scan reads (a few hours on the faster chains; older payments still match when the payer pastes the hash). */
const MAX_LOG_BLOCKS = 6_000;
const LOG_CHUNK = 2_000;
/** Native-coin blocks read per scan, so a tick stays short while a restart catches up over later scans. */
const NATIVE_BLOCKS = 25;

const hexBlock = (height: number) => `0x${height.toString(16)}`;
const padAddress = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

type EvmIncomingLog = { address?: string; topics?: string[]; data?: string; transactionHash?: string; blockNumber?: string; removed?: boolean };
type EvmIncomingBlock = { timestamp?: string; transactions?: { hash?: string; to?: string | null; value?: string }[] };

/** Where the next native-coin scan starts, per network and wallet. A restart scans the open orders' window again. */
const nativeCursor = new Map<string, number>();

/** Tests start from a chain the process has never scanned. */
export function resetIncomingCursors() {
  nativeCursor.clear();
}

/**
 * Transfers of the named coins into `wallet` since `since`, from the first endpoint that answers
 * (null when every endpoint failed). Token transfers come from their logs; a network's own coin
 * comes from recent blocks, a few at a time; Solana comes from the wallet's signatures. The same
 * rules as a pasted hash decide what counts: the coin's own contract, a direct native transfer,
 * and a successful transaction.
 */
export async function incomingPayments(network: NetworkId, wallet: string, since: Date, coins: CoinId[]): Promise<InboundPayment[] | null> {
  const info = networkInfo(network);
  if (!info || !coins.length) return [];
  const endpoints = rpcEndpoints(network);
  for (const [index, url] of endpoints.entries()) {
    try {
      return info.family === "evm" ? await incomingEvm(url, info, wallet, since, coins) : await incomingSolana(url, info, wallet, since, coins);
    } catch (error) {
      console.warn(`[Curialy Billing] ${info.label} incoming read, endpoint ${index + 1} of ${endpoints.length}, failed (${describe(error)}).`);
    }
  }
  return null;
}

async function incomingEvm(url: string, info: NetworkInfo, wallet: string, since: Date, coins: CoinId[]): Promise<InboundPayment[]> {
  const latest = Number(BigInt(await rpc<string>(url, "eth_blockNumber", [])));
  if (!Number.isSafeInteger(latest)) throw new RpcError("eth_blockNumber: impossible height");
  const seconds = Math.max(0, Date.now() - since.getTime()) / 1000;
  const span = Math.min(MAX_LOG_BLOCKS, Math.ceil(seconds / BLOCK_SECONDS[info.id]) + 40);
  const fromBlock = Math.max(0, latest - span);
  const wanted = new Set(coins);
  const found: InboundPayment[] = [];
  const stables = info.coins.filter(coin => coin.kind === "stablecoin" && wanted.has(coin.coin) && coin.tokens.length);
  if (stables.length) {
    const byToken = new Map(stables.flatMap(coin => coin.tokens.map(token => [token.toLowerCase(), coin.coin] as const)));
    const logs: EvmIncomingLog[] = [];
    for (let start = fromBlock; start <= latest; start += LOG_CHUNK) {
      const end = Math.min(latest, start + LOG_CHUNK - 1);
      const batch = await rpc<EvmIncomingLog[] | null>(url, "eth_getLogs", [{
        fromBlock: hexBlock(start), toBlock: hexBlock(end), address: stables.flatMap(coin => coin.tokens),
        topics: [TRANSFER_TOPIC, null, padAddress(wallet)],
      }]);
      logs.push(...(batch ?? []));
    }
    const grouped = new Map<string, { coin: CoinId; units: bigint; block: number }>();
    for (const log of logs) {
      if (log.removed || !log.transactionHash || !log.blockNumber) continue;
      const coin = byToken.get(String(log.address ?? "").toLowerCase());
      const topics = (log.topics ?? []).map(topic => String(topic).toLowerCase());
      if (!coin || topics.length !== 3 || topics[0] !== TRANSFER_TOPIC || topics[2] !== padAddress(wallet)) continue;
      const key = `${log.transactionHash.toLowerCase()}:${coin}`;
      const units = BigInt(log.data && log.data !== "0x" ? log.data : 0);
      const block = Number(BigInt(log.blockNumber));
      const current = grouped.get(key);
      if (current) current.units += units;
      else grouped.set(key, { coin, units, block });
    }
    const times = new Map<number, Date>();
    await Promise.all([...new Set([...grouped.values()].map(entry => entry.block))].map(async block => {
      const body = await rpc<EvmIncomingBlock | null>(url, "eth_getBlockByNumber", [hexBlock(block), false]);
      if (!body?.timestamp) throw new RpcError("eth_getBlockByNumber: no timestamp");
      const time = new Date(Number(BigInt(body.timestamp)) * 1000);
      if (!Number.isFinite(time.getTime())) throw new RpcError("eth_getBlockByNumber: impossible block");
      times.set(block, time);
    }));
    for (const [key, entry] of grouped) {
      const blockTime = times.get(entry.block);
      if (!blockTime || entry.units <= 0n) continue;
      found.push({ txHash: key.slice(0, key.lastIndexOf(":")), coin: entry.coin, units: entry.units, blockTime });
    }
  }
  const native = info.coins.find(coin => coin.kind === "native" && wanted.has(coin.coin));
  if (native) {
    const cursorKey = `${info.id}:${wallet.toLowerCase()}`;
    let next = nativeCursor.get(cursorKey) ?? fromBlock;
    if (next < fromBlock || next > latest + 1) next = fromBlock;
    // Already caught up: wait for later blocks. Scanning backwards again would re-read the window every tick.
    if (next <= latest) {
      const end = Math.min(latest, next + NATIVE_BLOCKS - 1);
      const to = wallet.toLowerCase();
      const heights = Array.from({ length: end - next + 1 }, (_, index) => next + index);
      const blocks = await Promise.all(heights.map(height => rpc<EvmIncomingBlock | null>(url, "eth_getBlockByNumber", [hexBlock(height), true])));
      for (const block of blocks) {
        if (!block?.timestamp) continue;
        const blockTime = new Date(Number(BigInt(block.timestamp)) * 1000);
        if (!Number.isFinite(blockTime.getTime())) continue;
        for (const tx of block.transactions ?? []) {
          if (!tx.hash || (tx.to ?? "").toLowerCase() !== to) continue;
          const units = BigInt(tx.value && tx.value !== "0x" ? tx.value : 0);
          if (units > 0n) found.push({ txHash: tx.hash.toLowerCase(), coin: native.coin, units, blockTime });
        }
      }
      nativeCursor.set(cursorKey, end + 1);
    }
  }
  return found;
}

async function incomingSolana(url: string, info: NetworkInfo, wallet: string, since: Date, coins: CoinId[]): Promise<InboundPayment[]> {
  const signatures = await rpc<{ signature: string; blockTime: number | null; err: unknown }[] | null>(url, "getSignaturesForAddress", [wallet, { limit: 40, commitment: "confirmed" }]);
  const sinceSeconds = Math.floor(since.getTime() / 1000);
  const offered = info.coins.filter(coin => coins.includes(coin.coin));
  const found: InboundPayment[] = [];
  for (const entry of signatures ?? []) {
    if (entry.err || entry.blockTime === null || entry.blockTime < sinceSeconds) continue;
    let tx: SolanaTx | null | "unsupported";
    try {
      tx = await rpc<SolanaTx | null>(url, "getTransaction", [entry.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: SOLANA_TX_VERSION }]);
    } catch (error) {
      if (error instanceof RpcError && error.code === UNSUPPORTED_VERSION) continue;
      throw error;
    }
    if (!tx?.meta || (tx.meta.err !== null && tx.meta.err !== undefined)) continue;
    const blockTime = new Date((tx.blockTime ?? entry.blockTime) * 1000);
    if (!Number.isFinite(blockTime.getTime())) continue;
    for (const coin of offered) {
      const units = solanaReceived(tx, wallet, coin);
      if (units > 0n) found.push({ txHash: entry.signature, coin: coin.coin, units, blockTime });
    }
  }
  return found;
}

/** What one Solana transaction added to the wallet, in the coin's base units (negative when it left). */
function solanaReceived(tx: SolanaTx, wallet: string, coin: CoinOnNetwork): bigint {
  if (!tx.meta) return 0n;
  if (coin.kind === "native") {
    const keys = tx.transaction.message.accountKeys.map(key => (typeof key === "string" ? key : key.pubkey));
    const index = keys.indexOf(wallet);
    if (index < 0) return 0n;
    return BigInt(tx.meta.postBalances[index] ?? 0) - BigInt(tx.meta.preBalances[index] ?? 0);
  }
  // The wallet's token accounts for the coin's mints: what each holds after, less what it held before
  // (nothing, when the transaction opened the account).
  const mints = new Set(coin.tokens);
  let received = 0n;
  for (const post of tx.meta.postTokenBalances ?? []) {
    if (post.owner !== wallet || !mints.has(post.mint)) continue;
    const pre = (tx.meta.preTokenBalances ?? []).find(entry => entry.accountIndex === post.accountIndex);
    received += BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0");
  }
  return received;
}
