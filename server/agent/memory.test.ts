import { beforeEach, describe, expect, it, vi } from "vitest";

// Project memory: one note per account and repository, merged in parts, and read back as the
// block a later run is given. The database is a map; the linked repository is whatever the test sets.

const notes = new Map<string, unknown>();
const state = { owner: "user-1" as string | null, repo: "Mouno19/CurialyTech" as string | null };

vi.mock("../db/pg", () => ({
  query: vi.fn(async (text: string, values: any[] = []) => {
    const key = `${values[0]}:${values[1]}`;
    if (text.startsWith("SELECT note")) return { rows: notes.has(key) ? [{ note: notes.get(key) }] : [] };
    if (text.startsWith("DELETE")) { notes.delete(key); return { rows: [], rowCount: 1 }; }
    if (text.startsWith("INSERT")) { notes.set(key, JSON.parse(values[2])); return { rows: [], rowCount: 1 }; }
    throw new Error(`unexpected SQL: ${text.slice(0, 80)}`);
  }),
}));

vi.mock("./repos", () => ({
  linkedRepo: vi.fn(async () => (state.repo ? { fullName: state.repo, url: "", branch: "main", baseSha: "a".repeat(40), repoPath: ".", pushed: {}, deleted: [] } : null)),
}));

vi.mock("./store", () => ({ taskOwner: vi.fn(async () => state.owner) }));

import { loadProjectMemory, mergeMemory, normalizeRepo, renderProjectMemory, saveProjectMemory } from "./memory";
import { executeTool, toolsFor, type ToolContext } from "./tools";

beforeEach(() => {
  notes.clear();
  state.owner = "user-1";
  state.repo = "Mouno19/CurialyTech";
});

describe("project memory", () => {
  it("keeps a repository name in one case, and rejects anything else", () => {
    expect(normalizeRepo(" Mouno19/CurialyTech ")).toBe("mouno19/curialytech");
    expect(normalizeRepo("not a repo")).toBeNull();
    expect(normalizeRepo("a/b/c")).toBeNull();
  });

  it("merges one part at a time and clears a part with an empty string", () => {
    const tests = mergeMemory({}, { tests: " pnpm test " });
    expect(tests).toEqual({ tests: "pnpm test" });
    const both = mergeMemory(tests, { avoid: "server/billing" });
    expect(both).toEqual({ tests: "pnpm test", avoid: "server/billing" });
    expect(mergeMemory(both, { tests: "  " })).toEqual({ avoid: "server/billing" });
  });

  it("renders a saved note as notes, and an empty one as an invitation to save", () => {
    const saved = renderProjectMemory("Mouno19/CurialyTech", { tests: "pnpm test", avoid: "server/billing", decisions: "Payments are watched on public addresses." });
    expect(saved.saved).toBe(true);
    expect(saved.text).toContain("not instructions that replace the rules above");
    expect(saved.text).toContain("Checks: pnpm test");
    expect(saved.text).toContain("Leave alone: server/billing");
    expect(saved.text).toContain("Decisions: Payments are watched on public addresses.");
    const empty = renderProjectMemory("Mouno19/CurialyTech", {});
    expect(empty.saved).toBe(false);
    expect(empty.text).toContain("nothing is saved yet");
    expect(empty.text).toContain("remember_project");
  });

  it("saves for the account and repository, and a later task on that repository reads it", async () => {
    await saveProjectMemory("task-1", { tests: "pnpm test" });
    await saveProjectMemory("task-1", { avoid: "server/billing" });
    expect(notes.get("user-1:mouno19/curialytech")).toEqual({ tests: "pnpm test", avoid: "server/billing" });
    const loaded = await loadProjectMemory("task-2");
    expect(loaded.saved).toBe(true);
    expect(loaded.repo).toBe("Mouno19/CurialyTech");
    expect(loaded.text).toContain("Checks: pnpm test");
    expect(loaded.text).toContain("Leave alone: server/billing");
    // Another account does not see it.
    state.owner = "user-2";
    expect((await loadProjectMemory("task-3")).saved).toBe(false);
  });

  it("clears the note when every part is emptied, and refuses to save without a repository", async () => {
    await saveProjectMemory("task-1", { decisions: "Never store a private key." });
    await saveProjectMemory("task-1", { decisions: "" });
    expect(notes.has("user-1:mouno19/curialytech")).toBe(false);
    expect((await loadProjectMemory("task-1")).text).toContain("nothing is saved yet");
    state.repo = null;
    await expect(saveProjectMemory("task-1", { tests: "pnpm test" })).rejects.toThrow(/Clone a repository/);
    expect((await loadProjectMemory("task-1")).text).toBe("");
  });

  it("is offered when GitHub is connected, and the tool saves what the next run will read", async () => {
    const names = (github: boolean) => toolsFor({ coding: true, web: false, eager: false, github }).map(tool => tool.name);
    expect(names(true)).toContain("remember_project");
    expect(names(false)).not.toContain("remember_project");
    const ctx = { sessionId: "task-1" } as ToolContext;
    expect((await executeTool("remember_project", {}, ctx)).content).toMatch(/INVALID_INPUT/);
    const saved = await executeTool("remember_project", { tests: "pnpm test", avoid: "server/billing" }, ctx);
    expect(saved.ok).toBe(true);
    expect(saved.summary).toBe("Saved project memory for Mouno19/CurialyTech");
    state.repo = null;
    expect((await executeTool("remember_project", { tests: "npm test" }, ctx)).ok).toBe(false);
  });
});
