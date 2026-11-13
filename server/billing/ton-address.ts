// TON addresses without a TON library: the user-friendly form wallets show (base64 of a flags byte,
// the workchain, the 32-byte account id and a CRC16 of those) and the raw form the indexers use
// (workchain:hex). Also the one-cell bag of cells a get-method takes or returns an address in.

export type TonAddress = { workchain: number; hash: string };

/** CRC16-XMODEM, the checksum at the end of a user-friendly address. */
function crc16(bytes: Uint8Array) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const BOUNCEABLE = 0x11;
const NON_BOUNCEABLE = 0x51;
const TESTNET = 0x80;

/**
 * An address in either form (null when it is neither, or its checksum is wrong). testnet: a
 * user-friendly address marked for the test network.
 */
export function parseTonAddress(text: string): (TonAddress & { bounceable?: boolean; testnet?: boolean }) | null {
  const value = text.trim();
  const raw = /^(-?\d{1,3}):([0-9a-fA-F]{64})$/.exec(value);
  if (raw) {
    const workchain = Number(raw[1]);
    return workchain >= -128 && workchain <= 127 ? { workchain, hash: raw[2].toLowerCase() } : null;
  }
  if (!/^[A-Za-z0-9+/_-]{48}$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (bytes.length !== 36 || crc16(bytes.subarray(0, 34)) !== bytes.readUInt16BE(34)) return null;
  const tag = bytes[0] & ~TESTNET;
  if (tag !== BOUNCEABLE && tag !== NON_BOUNCEABLE) return null;
  return { workchain: bytes.readInt8(1), hash: bytes.subarray(2, 34).toString("hex"), bounceable: tag === BOUNCEABLE, testnet: Boolean(bytes[0] & TESTNET) };
}

/** "0:f16f…09b": the form the indexers answer with, lowercased. */
export const rawTonAddress = (address: TonAddress) => `${address.workchain}:${address.hash}`;

/** The user-friendly mainnet form. Non-bounceable (UQ…) is the safe one to pay to a wallet that may not be deployed yet. */
export function friendlyTonAddress(address: TonAddress, opts: { bounceable: boolean }) {
  const bytes = Buffer.alloc(36);
  bytes[0] = opts.bounceable ? BOUNCEABLE : NON_BOUNCEABLE;
  bytes.writeInt8(address.workchain, 1);
  Buffer.from(address.hash, "hex").copy(bytes, 2);
  bytes.writeUInt16BE(crc16(bytes.subarray(0, 34)), 34);
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

/** A mainnet wallet address on the basechain, in either form: what can receive payments here. */
export const isValidTonAddress = (text: string) => {
  const address = parseTonAddress(text);
  return Boolean(address && address.workchain === 0 && !address.testnet);
};

// ---- One-cell bags of cells ----

/** A cell's bits, packed with the completion tag (a 1, then 0s) when they don't fill the last byte. */
function packBits(bits: string) {
  const padded = bits.length % 8 ? `${bits}1${"0".repeat(7 - (bits.length % 8))}` : bits;
  return Buffer.from(padded.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
}

/** A bag of cells holding one cell, the address as addr_std: the slice a get-method such as get_wallet_address takes. */
export function addressSliceBoc(address: TonAddress) {
  // addr_std$10 anycast:nothing$0 workchain_id:int8 address:bits256 (267 bits).
  const workchain = (address.workchain & 0xff).toString(2).padStart(8, "0");
  const bits = `100${workchain}${BigInt(`0x${address.hash}`).toString(2).padStart(256, "0")}`;
  const data = packBits(bits);
  const cell = Buffer.concat([Buffer.from([0, Math.floor(bits.length / 8) + Math.ceil(bits.length / 8)]), data]);
  // Magic, no index or checksum, 1-byte references and offsets, 1 cell, 1 root, 0 absent, the size, root 0.
  return Buffer.concat([Buffer.from("b5ee9c72", "hex"), Buffer.from([0x01, 0x01, 1, 1, 0, cell.length, 0]), cell]).toString("base64");
}

/** The address in a get-method's answer: the root cell of a bag of cells, read as addr_std (null for anything else). */
export function addressFromBoc(boc: Buffer): TonAddress | null {
  if (boc.length < 10 || boc.readUInt32BE(0) !== 0xb5ee9c72) return null;
  const flags = boc[4];
  const size = flags & 0x07;
  const offsets = boc[5];
  if (!size || !offsets) return null;
  let at = 6;
  const read = (bytes: number) => {
    let value = 0;
    for (let index = 0; index < bytes; index++) value = value * 256 + (boc[at++] ?? 0);
    return value;
  };
  const cells = read(size);
  const roots = read(size);
  read(size); // absent cells
  read(offsets); // total size of the cells
  if (!cells || roots < 1) return null;
  const root = read(size);
  at += (roots - 1) * size;
  if (flags & 0x80) at += cells * offsets; // the index
  // Walk the cells in order up to the root (it is almost always the first).
  for (let index = 0; index < cells && at < boc.length; index++) {
    const d1 = boc[at];
    const d2 = boc[at + 1];
    at += 2;
    if (d1 & 0x10) at += ((d1 >> 5) + 1) * 34; // stored hashes and depths
    const data = boc.subarray(at, at + Math.ceil(d2 / 2));
    at += data.length + (d1 & 0x07) * size;
    if (index !== root) continue;
    if (d1 & 0x08) return null; // exotic
    let bits = Array.from(data, byte => byte.toString(2).padStart(8, "0")).join("");
    if (d2 % 2) bits = bits.slice(0, bits.lastIndexOf("1"));
    else bits = bits.slice(0, (d2 / 2) * 8);
    // addr_std$10 with no anycast, then an 8-bit workchain and the 256-bit account id.
    if (bits.length < 267 || !bits.startsWith("100")) return null;
    const workchain = parseInt(bits.slice(3, 11), 2);
    return { workchain: workchain > 127 ? workchain - 256 : workchain, hash: BigInt(`0b${bits.slice(11, 267)}`).toString(16).padStart(64, "0") };
  }
  return null;
}
