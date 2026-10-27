import { describe, expect, it } from "vitest";
import { distanceFromBottom, initialStick, STICK_THRESHOLD, stickStep, type StickInput, type StickModel } from "./useStickToBottom";

// A 600px-tall viewport over 3000px of content: the bottom is at scrollTop 2400.
const HEIGHT = 3000;
const CLIENT = 600;
const BOTTOM = HEIGHT - CLIENT;
const scroll = (top: number, programmatic = false, height = HEIGHT): StickInput => ({ type: "scroll", top, height, client: CLIENT, programmatic });

function play(model: StickModel, ...inputs: StickInput[]) {
  let scrolls = 0;
  for (const input of inputs) {
    const step = stickStep(model, input);
    model = step.model;
    if (step.scroll) scrolls++;
  }
  return { model, scrolls };
}

describe("stick to bottom", () => {
  it("follows new content from the start", () => {
    const step = stickStep(initialStick(), { type: "grow", added: 3 });
    expect(step.scroll).toBe(true);
    expect(step.model).toMatchObject({ following: true, unseen: 0 });
  });

  it("stops following as soon as the reader scrolls up, and counts what arrives meanwhile", () => {
    const { model, scrolls } = play(initialStick(), scroll(BOTTOM), scroll(BOTTOM - 300), { type: "grow", added: 2 }, { type: "grow", added: 1 }, { type: "grow", added: 0 });
    expect(scrolls).toBe(0);
    expect(model).toMatchObject({ following: false, unseen: 3 });
  });

  it("stops following on a small upward scroll inside the threshold (trackpads during streaming)", () => {
    const { model } = play(initialStick(), scroll(BOTTOM), scroll(BOTTOM - 20));
    expect(model.following).toBe(false);
  });

  it("ignores its own programmatic scrolls, even when content grew past the threshold meanwhile", () => {
    const { model } = play(initialStick(), scroll(BOTTOM), scroll(BOTTOM, true, HEIGHT + 500));
    expect(model.following).toBe(true);
    expect(model.lastTop).toBe(BOTTOM);
  });

  it("follows again when the reader comes back within the threshold", () => {
    const away = play(initialStick(), scroll(BOTTOM), scroll(1000), { type: "grow", added: 4 }).model;
    expect(away).toMatchObject({ following: false, unseen: 4 });
    const back = stickStep(away, scroll(BOTTOM - STICK_THRESHOLD + 10)).model;
    expect(back).toMatchObject({ following: true, unseen: 0 });
    expect(stickStep(back, { type: "grow", added: 1 }).scroll).toBe(true);
  });

  it("does not follow while scrolling down but still far from the end", () => {
    const { model } = play(initialStick(), scroll(BOTTOM), scroll(500), scroll(900));
    expect(model.following).toBe(false);
  });

  it("keeps following when content shrinks and the browser clamps scrollTop upward", () => {
    // Collapsing a block above: scrollTop drops by 200, but the view is still at the very end.
    const { model } = play(initialStick(), scroll(BOTTOM), scroll(BOTTOM - 200, false, HEIGHT - 200));
    expect(model.following).toBe(true);
  });

  it("resumes following right after the user sends a message, and on Jump to latest", () => {
    const away = play(initialStick(), scroll(BOTTOM), scroll(200), { type: "grow", added: 5 }).model;
    for (const input of [{ type: "sent" }, { type: "jump" }] as StickInput[]) {
      const step = stickStep(away, input);
      expect(step.scroll).toBe(true);
      expect(step.model).toMatchObject({ following: true, unseen: 0 });
    }
  });

  it("respects a custom threshold", () => {
    const away = play(initialStick(), scroll(BOTTOM), scroll(BOTTOM - 400)).model;
    expect(stickStep(away, scroll(BOTTOM - 150), 200).model.following).toBe(true);
    expect(stickStep(away, scroll(BOTTOM - 150), 80).model.following).toBe(false);
  });

  it("measures distance from the bottom, never below zero", () => {
    expect(distanceFromBottom(BOTTOM, HEIGHT, CLIENT)).toBe(0);
    expect(distanceFromBottom(BOTTOM + 30, HEIGHT, CLIENT)).toBe(0);
    expect(distanceFromBottom(1000, HEIGHT, CLIENT)).toBe(1400);
  });

  it("can start without following (and then waits for the reader)", () => {
    expect(stickStep(initialStick(false), { type: "grow", added: 1 })).toMatchObject({ scroll: false, model: { following: false, unseen: 1 } });
  });
});
