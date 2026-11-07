import { beforeAll, describe, expect, it, vi } from "vitest";

// Sign-up networks: which addresses count as one network, and that only a keyed hash is kept.

beforeAll(() => vi.stubEnv("SESSION_SECRET", "test-only-session-secret-0123456789abcdef"));

const { networkHash, resetNetworkKey, signupNetwork } = await import("./signup-network");

describe("signupNetwork", () => {
  it("takes the whole IPv4 address, the same whether or not it arrives IPv4-mapped", () => {
    expect(signupNetwork("203.0.113.7")).toBe("v4:203.0.113.7");
    expect(signupNetwork("::ffff:203.0.113.7")).toBe("v4:203.0.113.7");
    expect(signupNetwork("203.0.113.8")).not.toBe(signupNetwork("203.0.113.7"));
  });

  it("groups IPv6 by /64, in any spelling", () => {
    expect(signupNetwork("2001:db8:1:2:aaaa::1")).toBe("v6:2001:db8:1:2::/64");
    expect(signupNetwork("2001:0db8:0001:0002:bbbb:cccc:dddd:eeee")).toBe("v6:2001:db8:1:2::/64");
    expect(signupNetwork("2001:db8:1:3::1")).toBe("v6:2001:db8:1:3::/64");
  });

  it("counts no local, private or malformed address", () => {
    for (const address of ["127.0.0.1", "::1", "10.1.2.3", "172.20.0.5", "192.168.1.9", "169.254.3.4", "0.0.0.0", "fe80::1%eth0", "fd00::1", "ff02::1", "::", "unknown", "", undefined, null, "1.2.3", "2001:db8::1::2"]) {
      expect(signupNetwork(address)).toBeNull();
    }
  });
});

describe("networkHash", () => {
  it("is 16 bytes, the same for the same network, and depends on the server's secret", () => {
    const one = networkHash("v4:203.0.113.7");
    expect(one).toHaveLength(16);
    expect(networkHash("v4:203.0.113.7").equals(one)).toBe(true);
    expect(networkHash("v4:203.0.113.8").equals(one)).toBe(false);
    // No part of the address is in it.
    expect(one.includes(Buffer.from("203.0.113.7"))).toBe(false);
    vi.stubEnv("SESSION_SECRET", "another-test-only-secret-0123456789abcdef");
    resetNetworkKey();
    try {
      expect(networkHash("v4:203.0.113.7").equals(one)).toBe(false);
    } finally {
      vi.stubEnv("SESSION_SECRET", "test-only-session-secret-0123456789abcdef");
      resetNetworkKey();
    }
  });
});
