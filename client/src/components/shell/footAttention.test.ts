import { describe, expect, it } from "vitest";
import { footAttention } from "./footAttention";

// The closed sidebar footer's dot: anything behind it that needs the user, and nothing otherwise.

const fine = { health: "success" as const, credits: { available: 120, unlimited: false }, githubMissingScopes: false, vercelReconnect: false, canvaReconnect: false };

describe("footAttention", () => {
  it("flags nothing when everything behind the footer is fine, or not known yet", () => {
    expect(footAttention(fine)).toBeNull();
    expect(footAttention({ ...fine, health: "neutral", credits: null })).toBeNull();
    // The operator isn't charged: no credits warning however few are shown.
    expect(footAttention({ ...fine, credits: { available: 0, unlimited: true } })).toBeNull();
  });

  it("says what needs the user, as a warning, or as danger when a critical system is down", () => {
    expect(footAttention({ ...fine, credits: { available: 4.5, unlimited: false } })).toEqual({ tone: "warning", reasons: ["credits are low"] });
    expect(footAttention({ ...fine, health: "warning", vercelReconnect: true, canvaReconnect: true })).toEqual({ tone: "warning", reasons: ["system status", "reconnect Vercel", "reconnect Canva"] });
    expect(footAttention({ ...fine, health: "danger", githubMissingScopes: true })).toEqual({ tone: "danger", reasons: ["system status", "GitHub needs more access"] });
  });
});
