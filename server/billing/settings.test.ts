import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BILLING_SETTINGS } from "@shared/billing";
import { fake, resetFake } from "./fake-db";

// Billing settings: the defaults under whatever the operator saved (plans and the offer merged
// field by field), a short cache, every limit checked before anything is written; and the receiving
// wallets, checked once, off when missing or invalid, never logged.

vi.mock("../db/pg", async () => (await import("./fake-db")).pgModule());
const settings = await import("./settings");

const EVM = "0x6FD853FE610A76b20E1B02751bc5eD3716D3894b";
const SOLANA = "9bXLFJhkKcnsvaoV1aEfjNjUf7wh61o3VdUFcUfU5K7i";

beforeEach(() => {
  resetFake();
  settings.resetBillingSettings();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("billing settings", () => {
  it("are the defaults until the operator saves some, merged field by field", async () => {
    expect(await settings.getBillingSettings()).toEqual(DEFAULT_BILLING_SETTINGS);
    settings.resetBillingSettings();
    fake.settings.set("billing", { plans: { pro: { priceUsd: 25 } }, discount: { percent: 50 }, autoVerify: false, stray: true });
    expect(await settings.getBillingSettings()).toEqual({
      plans: { pro: { name: "Pro", priceUsd: 25, creditsPerWindow: 6000, days: 30 }, max: DEFAULT_BILLING_SETTINGS.plans.max },
      discount: { percent: 50, plans: true, api: true, endsAt: null }, paymentsOpen: true, autoVerify: false,
    });
  });

  it("are cached for 30 seconds", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    await settings.getBillingSettings();
    fake.settings.set("billing", { paymentsOpen: false });
    vi.advanceTimersByTime(29_000);
    expect((await settings.getBillingSettings()).paymentsOpen).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect((await settings.getBillingSettings()).paymentsOpen).toBe(false);
  });

  it("save over what is there, and are read back at once", async () => {
    await settings.saveBillingSettings({ plans: { max: { name: " Ultra ", priceUsd: 99.5 } } }, "admin");
    const saved = await settings.saveBillingSettings({ discount: { percent: 80, endsAt: "2099-01-01T00:00:00+02:00" }, paymentsOpen: false }, "admin");
    expect(saved.plans.max).toEqual({ name: "Ultra", priceUsd: 99.5, creditsPerWindow: 30000, days: 30 });
    expect(saved.discount).toEqual({ percent: 80, plans: true, api: true, endsAt: "2098-12-31T22:00:00.000Z" });
    expect(fake.settings.get("billing")).toEqual(saved);
    expect(await settings.getBillingSettings()).toEqual(saved);
    expect(settings.knownPlans().max.name).toBe("Ultra");
  });

  it("refuse values outside their limits, writing nothing", async () => {
    const bad = [
      { plans: { pro: { priceUsd: 0.5 } } }, { plans: { pro: { priceUsd: 10_001 } } }, { plans: { pro: { priceUsd: 19.999 } } },
      { plans: { max: { creditsPerWindow: -1 } } }, { plans: { max: { creditsPerWindow: 1.5 } } }, { plans: { max: { creditsPerWindow: 1_000_001 } } },
      { plans: { pro: { days: 0 } } }, { plans: { pro: { days: 367 } } }, { plans: { pro: { days: 7.5 } } },
      { plans: { pro: { name: "  " } } }, { plans: { pro: { name: "x".repeat(25) } } },
      { discount: { percent: 96 } }, { discount: { percent: -1 } }, { discount: { percent: 12.5 } },
      { discount: { endsAt: "2001-01-01T00:00:00Z" } }, { discount: { endsAt: "soon" } },
      { paymentsOpen: "yes" as unknown as boolean }, { discount: { api: 1 as unknown as boolean } },
    ];
    for (const patch of bad) await expect(settings.saveBillingSettings(patch, "admin"), JSON.stringify(patch)).rejects.toMatchObject({ status: 400, code: "invalid_settings" });
    expect(fake.settings.has("billing")).toBe(false);
  });

  it("keep an offer that has ended when the settings are saved again, and can end it", async () => {
    const ended = { percent: 90, plans: true, api: true, endsAt: "2026-01-01T00:00:00.000Z" };
    fake.settings.set("billing", { discount: ended });
    expect((await settings.saveBillingSettings({ autoVerify: false }, "admin")).discount.endsAt).toBe("2026-01-01T00:00:00.000Z");
    // A form sends everything back, the old end time included (in any offset).
    expect((await settings.saveBillingSettings({ discount: { ...ended, endsAt: "2026-01-01T01:00:00+01:00" }, paymentsOpen: false }, "admin")).paymentsOpen).toBe(false);
    // Another time in the past is a new one, and refused.
    await expect(settings.saveBillingSettings({ discount: { endsAt: "2026-02-01T00:00:00.000Z" } }, "admin")).rejects.toMatchObject({ code: "invalid_settings" });
    expect((await settings.saveBillingSettings({ discount: { endsAt: null } }, "admin")).discount.endsAt).toBeNull();
  });
});

describe("receiving wallets", () => {
  it("are the configured addresses, the EVM one in its checksummed form, and every network is offered", () => {
    vi.stubEnv("PAY_EVM_ADDRESS", ` ${EVM.toLowerCase()} `);
    vi.stubEnv("PAY_SOLANA_ADDRESS", SOLANA);
    expect(settings.walletConfig()).toEqual({ evm: EVM, solana: SOLANA });
    expect(settings.offeredNetworks().map(network => network.id)).toEqual(["ethereum", "bnb", "polygon", "solana"]);
  });

  it("are off when missing or invalid, said once, without the value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A private key pasted by mistake must never reach the log.
    const pasted = `0x${"4c0883a69102937d6231471b5dbb6204fe512961708279f0a4b0e3bb7d6cc5e1"}`;
    vi.stubEnv("PAY_EVM_ADDRESS", pasted);
    vi.stubEnv("PAY_SOLANA_ADDRESS", "");
    expect(settings.walletConfig()).toEqual({ evm: null, solana: null });
    expect(settings.offeredNetworks()).toEqual([]);
    settings.walletConfig();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([error.mock.calls, warn.mock.calls])).not.toContain("4c0883a6");
    // A bad checksum, and a Solana address off the curve.
    settings.resetBillingSettings();
    vi.stubEnv("PAY_EVM_ADDRESS", EVM.replace("b20E", "b20e"));
    vi.stubEnv("PAY_SOLANA_ADDRESS", "4i6g6pTxVJZcSixvKMemmDWsPv9aRSH3m3b6WduXJrhK");
    expect(settings.walletConfig()).toEqual({ evm: null, solana: null });
    settings.resetBillingSettings();
    vi.stubEnv("PAY_EVM_ADDRESS", EVM);
    expect(settings.offeredNetworks().map(network => network.id)).toEqual(["ethereum", "bnb", "polygon"]);
  });
});
