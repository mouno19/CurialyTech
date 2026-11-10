// Receiving-wallet checks with no dependency: keccak-256 (Ethereum's hash, the original Keccak
// padding; Node only ships NIST SHA3-256, which pads differently), EIP-55 checksums, and Solana
// public keys (base58, 32 bytes, a point on the ed25519 curve). Public addresses only: nothing here
// ever sees a private key.

// ---- keccak-256 ----

const MASK64 = (1n << 64n) - 1n;
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/** Rotation of lane (x, y), at index x + 5y. */
const ROTATIONS = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
/** Bytes absorbed per permutation for a 256-bit output. */
const RATE = 136;

const rotl = (value: bigint, bits: number) => (bits === 0 ? value : ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK64);

function permute(state: bigint[]) {
  const column = new Array<bigint>(5);
  const moved = new Array<bigint>(25);
  for (const constant of ROUND_CONSTANTS) {
    for (let x = 0; x < 5; x++) column[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) {
      const mix = column[(x + 4) % 5] ^ rotl(column[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[x + y] ^= mix;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROTATIONS[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) state[x + y] = moved[x + y] ^ (~moved[((x + 1) % 5) + y] & moved[((x + 2) % 5) + y]);
    state[0] ^= constant;
  }
}

export function keccak256(bytes: Uint8Array): Uint8Array {
  // Keccak padding: 0x01 after the message, 0x80 on the last byte of the block.
  const padded = new Uint8Array(Math.floor(bytes.length / RATE + 1) * RATE);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const state = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte--) value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]);
      state[lane] ^= value;
    }
    permute(state);
  }
  const out = new Uint8Array(32);
  for (let index = 0; index < 32; index++) out[index] = Number((state[index >> 3] >> BigInt((index & 7) * 8)) & 0xffn);
  return out;
}

// ---- EVM addresses ----

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The EIP-55 form of an address (its letters capitalised by the hash of the lowercase form). */
export function toChecksumAddress(address: string) {
  if (!EVM_ADDRESS.test(address)) throw new Error("Not an EVM address.");
  const hex = address.slice(2).toLowerCase();
  const hash = keccak256(new TextEncoder().encode(hex));
  let out = "0x";
  for (let index = 0; index < 40; index++) {
    const nibble = (hash[index >> 1] >> (index % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? hex[index].toUpperCase() : hex[index];
  }
  return out;
}

/** 0x and 40 hex characters; a mixed-case address must carry the right checksum (a typo then shows). */
export function isValidEvmAddress(address: string) {
  if (typeof address !== "string" || !EVM_ADDRESS.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}

// ---- Solana addresses ----

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet) to bytes, or null when a character is not in the alphabet. */
export function base58Decode(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  // Each leading "1" is a leading zero byte.
  let zeros = 0;
  while (text[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

const P = 2n ** 255n - 19n;
const mod = (value: bigint) => ((value % P) + P) % P;
function power(base: bigint, exponent: bigint) {
  let result = 1n;
  for (let b = mod(base), e = exponent; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) result = (result * b) % P;
  return result;
}
const D = mod(-121665n * power(121666n, P - 2n));
const SQRT_MINUS_ONE = power(2n, (P - 1n) / 4n);

/**
 * Whether 32 bytes are a point on the ed25519 curve (RFC 8032 decoding: y below p, and x from
 * x² = (y² − 1) / (d·y² + 1) exists). Wallet keys are; program-derived addresses never are, and
 * nobody holds a key for them, so a payment sent to one could never be spent.
 */
export function isOnEd25519Curve(bytes: Uint8Array) {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let index = 31; index >= 0; index--) y = (y << 8n) | BigInt(bytes[index]);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // A square root of u/v without a division: x = u·v³·(u·v⁷)^((p − 5) / 8), then fix up by √−1.
  const v3 = (((v * v) % P) * v) % P;
  const v7 = (((v3 * v3) % P) * v) % P;
  let x = (((u * v3) % P) * power((u * v7) % P, (P - 5n) / 8n)) % P;
  const check = (((v * x) % P) * x) % P;
  if (check !== u) {
    if (check !== mod(-u)) return false;
    x = (x * SQRT_MINUS_ONE) % P;
  }
  return !(x === 0n && sign === 1n);
}

/** Base58 that decodes to exactly 32 bytes on the ed25519 curve (a wallet someone holds the key to). */
export function isValidSolanaAddress(address: string) {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) return false;
  const bytes = base58Decode(address);
  return bytes !== null && bytes.length === 32 && isOnEd25519Curve(bytes);
}
