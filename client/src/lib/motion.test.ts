import { describe, expect, it } from "vitest";
import { easeOutCubic, scrollProgress, typewriterStep, type TypewriterState } from "./motion";

describe("scrollProgress (the How it works spine)", () => {
  const vh = 1000;
  it("is 0 until the target's top reaches 75% of the viewport and 1 once its bottom passes 60%", () => {
    expect(scrollProgress(900, 1200, vh)).toBe(0);
    expect(scrollProgress(750, 1200, vh)).toBe(0);
    // Bottom at 60%: top = 600 - 1200.
    expect(scrollProgress(-600, 1200, vh)).toBe(1);
    expect(scrollProgress(-2000, 1200, vh)).toBe(1);
  });
  it("moves linearly in between", () => {
    const span = vh * 0.15 + 1200;
    expect(scrollProgress(750 - span / 2, 1200, vh)).toBeCloseTo(0.5, 5);
  });
  it("never divides by zero for an empty target", () => {
    expect(scrollProgress(100, 0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("typewriterStep (typing examples in the composers)", () => {
  const lines = ["abc", "de"];
  const run = (steps: number) => {
    let state: TypewriterState = { line: 0, chars: 0, deleting: false };
    const seen: string[] = [];
    for (let i = 0; i < steps; i++) {
      state = typewriterStep(state, lines, 0).state;
      seen.push(lines[state.line].slice(0, state.chars));
    }
    return seen;
  };
  it("types a line one character at a time, holds it, deletes it, then moves to the next", () => {
    expect(run(6)).toEqual(["a", "ab", "abc", "", "d", "de"]);
  });
  it("waits longest on a finished line and briefly between lines", () => {
    expect(typewriterStep({ line: 0, chars: 2, deleting: false }, lines, 0).wait).toBe(2200);
    expect(typewriterStep({ line: 0, chars: 1, deleting: true }, lines, 0)).toEqual({ state: { line: 1, chars: 0, deleting: false }, wait: 380 });
  });
  it("wraps around to the first line", () => {
    expect(typewriterStep({ line: 1, chars: 2, deleting: true }, lines, 0).state.line).toBe(0);
  });
});

describe("easeOutCubic (counters)", () => {
  it("starts at 0, ends at 1, clamps outside, and front-loads progress", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
