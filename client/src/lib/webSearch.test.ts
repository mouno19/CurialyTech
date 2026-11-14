import { describe, expect, it } from "vitest";
import { FINDING_AFTER_MS, monogram, SEARCH_LABELS, searchActive, searchAnnouncement, searchDuration, searchPhase, sourceDate } from "./webSearch";

describe("what the chat says about a search", () => {
  it("searching, then finding once it takes more than a moment; the stream's states otherwise", () => {
    expect(searchPhase("searching", 0)).toBe("searching");
    expect(searchPhase("searching", FINDING_AFTER_MS - 1)).toBe("searching");
    expect(searchPhase("searching", FINDING_AFTER_MS)).toBe("finding");
    for (const state of ["reviewing", "found", "empty", "unavailable", "stopped"] as const) expect(searchPhase(state, 60_000)).toBe(state);
    expect([SEARCH_LABELS.searching, SEARCH_LABELS.finding, SEARCH_LABELS.reviewing, SEARCH_LABELS.found, SEARCH_LABELS.unavailable])
      .toEqual(["Searching the web…", "Finding relevant sources…", "Reviewing sources…", "Sources found", "Web search unavailable"]);
    expect(["searching", "finding", "reviewing"].every(phase => searchActive(phase as never))).toBe(true);
    expect(["found", "empty", "unavailable", "stopped"].some(phase => searchActive(phase as never))).toBe(false);
  });

  it("announces counts and reasons", () => {
    expect(searchAnnouncement("reviewing", 6)).toBe("Reviewing 6 sources.");
    expect(searchAnnouncement("found", 1)).toBe("Sources found: 1 source.");
    expect(searchAnnouncement("unavailable", 0, "The search timed out")).toBe("Web search unavailable: The search timed out.");
    expect(searchAnnouncement("searching", 0)).toBe("Searching the web…");
  });

  it("site letters, dates and durations", () => {
    expect(monogram("nodejs.org")).toBe("N");
    expect(monogram("en.wikipedia.org")).toBe("W");
    expect(monogram("docs.github.com")).toBe("G");
    expect(monogram("github.com")).toBe("G");
    expect(monogram("")).toBe("•");
    expect(sourceDate("2026-11-12")).toMatch(/2026/);
    expect(sourceDate("not a date")).toBe("not a date");
    expect(searchDuration(840)).toBe("0.8 s");
    expect(searchDuration(15_000)).toBe("15 s");
    expect(searchDuration(64_000)).toBe("1 min 4 s");
  });
});
