import { describe, expect, it } from "vitest";
import { insertAtCursor } from "./insertText";

describe("insertAtCursor", () => {
  it("adds dictated text at the end, or in place of the selection, with spaces between words", () => {
    expect(insertAtCursor("", "Hello", null)).toBe("Hello");
    expect(insertAtCursor("Fix the", "header", null)).toBe("Fix the header");
    expect(insertAtCursor("Fix the ", "header", null)).toBe("Fix the header");
    expect(insertAtCursor("Fix footer", "the", { start: 4, end: 4 })).toBe("Fix the footer");
    expect(insertAtCursor("Fix the old footer", "new", { start: 8, end: 11 })).toBe("Fix the new footer");
    // A selection past the end (the text changed since) counts as the end.
    expect(insertAtCursor("Short", "text", { start: 40, end: 40 })).toBe("Short text");
  });
});
