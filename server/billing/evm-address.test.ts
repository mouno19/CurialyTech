import { describe, expect, it } from "vitest";
import { base58Decode, isOnEd25519Curve, isValidEvmAddress, isValidSolanaAddress, keccak256, toChecksumAddress } from "./evm-address";

// Receiving wallets: keccak-256 against known digests (block boundaries included), EIP-55 checksums,
// and Solana keys, with the live addresses, one-character typos and an address nobody holds a key to.

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const text = (value: string) => new TextEncoder().encode(value);

const EVM = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const SOLANA = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";

describe("keccak-256", () => {
  it("matches the known digests", () => {
    expect(hex(keccak256(new Uint8Array()))).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(hex(keccak256(text("abc")))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    // The ERC-20 Transfer event's topic.
    expect(hex(keccak256(text("Transfer(address,address,uint256)")))).toBe("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  });

  it("pads at the block boundaries (135, 136, 137 and 272 bytes) like an independent implementation", () => {
    // Digests of the same inputs from a separate Python implementation (curialy-tools/payments).
    const input = (length: number) => new Uint8Array(length).map((_, index) => index % 251);
    expect([135, 136, 137, 272].map(length => hex(keccak256(input(length))))).toEqual([
      "cbdfd9dee5faad3818d6b06f95a219fd290b0e1706f6a82e5a595b9ce9faca62",
      "7ce759f1ab7f9ce437719970c26b0a66ff11fe3e38e17df89cf5d29c7d7f807e",
      "ac73d4fae68b8453f764007c1a20ce95994187861f0c3227a3a8e99a73a3b1db",
      "8e2476e65823b24d96ebe239f2c1534cdf763e689e2410c3b1cb0c74e6177bfc",
    ]);
  });
});

describe("EVM addresses", () => {
  it("accepts the live wallet and gives its checksummed form from any case", () => {
    expect(isValidEvmAddress(EVM)).toBe(true);
    expect(toChecksumAddress(EVM.toLowerCase())).toBe(EVM);
    expect(toChecksumAddress(`0x${EVM.slice(2).toUpperCase()}`)).toBe(EVM);
    // All one case carries no checksum, and is accepted as it is.
    expect(isValidEvmAddress(EVM.toLowerCase())).toBe(true);
    expect(isValidEvmAddress(`0x${EVM.slice(2).toUpperCase()}`)).toBe(true);
  });

  it("refuses one changed character, a wrong checksum, and anything that isn't 0x and 40 hex", () => {
    expect(isValidEvmAddress(EVM.replace("6FD853", "6FD854"))).toBe(false);
    // The same address with one letter's case flipped: the checksum catches it.
    expect(isValidEvmAddress(EVM.replace("b20E", "b20e"))).toBe(false);
    for (const bad of ["", "0x", EVM.slice(0, 41), `${EVM}0`, EVM.replace("0x", "0X"), EVM.replace("b", "g"), `0x${"ab".repeat(32)}`]) expect(isValidEvmAddress(bad), bad).toBe(false);
  });
});

describe("Solana addresses", () => {
  it("accepts the live wallet (32 bytes, on the curve)", () => {
    expect(base58Decode(SOLANA)?.length).toBe(32);
    expect(isValidSolanaAddress(SOLANA)).toBe(true);
  });

  it("refuses a changed character, the wrong length and characters base58 doesn't have", () => {
    // A typo that still decodes to 32 bytes, but off the curve.
    expect(base58Decode("9cXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i")?.length).toBe(32);
    expect(isValidSolanaAddress("9cXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i")).toBe(false);
    expect(isValidSolanaAddress(`${SOLANA}1`)).toBe(false);
    // Too short to be 32 bytes (one character less can still be 32 bytes, and then on the curve or not by chance).
    expect(base58Decode(SOLANA.slice(3))!.length).toBeLessThan(32);
    expect(isValidSolanaAddress(SOLANA.slice(3))).toBe(false);
    for (const bad of ["", SOLANA.replace("9", "0"), SOLANA.replace("b", "l"), SOLANA.replace("K", "I"), `0x${"ab".repeat(20)}`]) expect(isValidSolanaAddress(bad), bad).toBe(false);
  });

  it("refuses a program-derived address: a real token account, which no key controls", () => {
    // An associated token account seen on mainnet (2026-11-09): 32 bytes, off the curve.
    const tokenAccount = "4i6g6pTxVJZcSixvKMemmDWsPv9aRSH3m3b6WduXJrhK";
    expect(base58Decode(tokenAccount)?.length).toBe(32);
    expect(isValidSolanaAddress(tokenAccount)).toBe(false);
  });

  it("follows RFC 8032 decoding at the edges", () => {
    // y = 1 is the identity point (x = 0): on the curve, but not with the sign bit set.
    const identity = new Uint8Array(32);
    identity[0] = 1;
    expect(isOnEd25519Curve(identity)).toBe(true);
    identity[31] = 0x80;
    expect(isOnEd25519Curve(identity)).toBe(false);
    // y must be below p = 2^255 - 19.
    const tooBig = new Uint8Array(32).fill(0xff);
    tooBig[31] = 0x7f;
    expect(isOnEd25519Curve(tooBig)).toBe(false);
    expect(isOnEd25519Curve(new Uint8Array(31))).toBe(false);
  });
});
