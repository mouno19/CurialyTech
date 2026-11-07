import { createHmac, hkdfSync } from "node:crypto";
import { isIP } from "node:net";

// Server only: never import this from shared/ or client code (both are public bundles).
//
// Free credits go to the first accounts created from a network; later ones start without the free
// allowance (the operator can give it back). A network is the visitor's IPv4 address or IPv6 /64,
// and only a keyed hash of it is stored, never the address: with the key the hash can be matched,
// without it IPv4's small address space can't be enumerated back.

export const FREE_ACCOUNTS_PER_NETWORK = 3;

/** The network an address belongs to, or null when it is not a public address (local, private, unparseable). */
export function signupNetwork(address: string | undefined | null): string | null {
  if (!address) return null;
  let value = address.trim().toLowerCase();
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) value = mapped[1];
  const family = isIP(value);
  if (family === 4) {
    const [a, b] = value.split(".").map(Number);
    // "This network", private, loopback, link-local, multicast and reserved: not a visitor's address.
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return null;
    return `v4:${value}`;
  }
  if (family === 6) {
    const groups = expandIPv6(value);
    if (!groups) return null;
    const first = groups[0];
    // Loopback and unspecified (all zero but the last group), link-local fe80::/10, unique-local fc00::/7, multicast ff00::/8.
    if (groups.slice(0, 7).every(group => group === 0) || (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00 || (first & 0xff00) === 0xff00) return null;
    return `v6:${groups.slice(0, 4).map(group => group.toString(16)).join(":")}::/64`;
  }
  return null;
}

/** The eight 16-bit groups of an IPv6 address (with "::" expanded), or null. */
function expandIPv6(value: string): number[] | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4 forms other than the mapped one handled above).
  const last = (tail.length ? tail : head).at(-1);
  if (last && last.includes(".")) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(group => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
}

let key: Buffer | null = null;
/** The hash key, derived from the session secret (no new setting; rotating that secret starts the count afresh). */
function networkKey() {
  if (key) return key;
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters).");
  key = Buffer.from(hkdfSync("sha256", secret, "curialy", "signup-network-v1", 32));
  return key;
}

/** The stored form of a network: an HMAC-SHA256, 16 bytes. */
export function networkHash(network: string) {
  return createHmac("sha256", networkKey()).update(network).digest().subarray(0, 16);
}

/** Tests: forget the derived key (after changing SESSION_SECRET). */
export function resetNetworkKey() {
  key = null;
}
