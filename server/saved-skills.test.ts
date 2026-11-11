import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_SKILL_LIMITS } from "@shared/skills";

type Row = { id: string; user_id: string; name: string; body: string; updated_at: Date };
const mem = vi.hoisted(() => {
  let n = 0;
  return {
    rows: [] as Row[],
    sessions: new Map<string, string[]>(),
    id: () => `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
});

vi.mock("./db/pg", () => ({
  query: async (text: string, values: any[] = []) => {
    const same = (userId: string, name: string, except?: string) => mem.rows.some(row => row.user_id === userId && row.name.toLowerCase() === name.toLowerCase() && row.id !== except);
    if (text.includes("count(*)::int")) return { rows: [{ n: mem.rows.filter(row => row.user_id === values[0]).length }] };
    if (text.startsWith("DELETE FROM curialy.user_skills")) {
      const before = mem.rows.length;
      const kept = mem.rows.filter(row => !(row.id === values[0] && row.user_id === values[1]));
      mem.rows.splice(0, mem.rows.length, ...kept);
      return { rows: [], rowCount: before - kept.length };
    }
    if (text.startsWith("UPDATE curialy.user_skills")) {
      const row = mem.rows.find(item => item.id === values[0] && item.user_id === values[1]);
      if (!row || same(values[1], values[2], values[0])) return { rows: [] };
      row.name = values[2];
      row.body = values[3];
      row.updated_at = new Date();
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("UPDATE curialy.chat_sessions SET skill_ids")) {
      mem.sessions.set(values[0], values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT id FROM curialy.user_skills")) {
      const row = mem.rows.find(item => item.id === values[0] && item.user_id === values[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (text.includes("id = ANY")) {
      const ids = values[1] as string[];
      return { rows: mem.rows.filter(row => row.user_id === values[0] && ids.includes(row.id)) };
    }
    if (text.includes("ORDER BY updated_at DESC")) {
      const rows = mem.rows.filter(row => row.user_id === values[0]).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || a.name.localeCompare(b.name));
      return { rows };
    }
    if (text.includes("INSERT INTO curialy.user_skills")) {
      if (same(values[0], values[1])) return { rows: [] };
      const row = { id: mem.id(), user_id: values[0], name: values[1], body: values[2], updated_at: new Date() };
      mem.rows.push(row);
      return { rows: [row] };
    }
    throw new Error(`unexpected sql: ${text}`);
  },
  heartbeatQuery: async () => ({ rows: [] }),
  db: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }) }),
}));

const { deleteSavedSkill, listSavedSkills, loadTaskSkills, renderSavedSkills, replaceTaskSkills, saveSavedSkill, SavedSkillError, skillsForTask } = await import("./agent/saved-skills");

const user = "40000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mem.rows.splice(0, mem.rows.length);
  mem.sessions.clear();
});

describe("saved skills", () => {
  it("renders nothing when a task has no skills, and the procedure when it does", () => {
    expect(renderSavedSkills([])).toBe("");
    const text = renderSavedSkills([{ name: "How to run tests", body: "Run pnpm test." }]);
    expect(text).toContain("including when this task has no repository note");
    expect(text).toContain("### How to run tests\nRun pnpm test.");
  });

  it("saves, renames, and deletes a procedure, and rejects a second skill with the same name", async () => {
    const saved = await saveSavedSkill(user, { name: "  How to run tests \n", body: "Run pnpm test." });
    expect(saved.name).toBe("How to run tests");
    await expect(saveSavedSkill(user, { name: "how to run tests", body: "Again." })).rejects.toThrow(/already have a skill/);
    const updated = await saveSavedSkill(user, { id: saved.id, name: "Pull requests", body: "Describe the user-visible change." });
    expect(updated.body).toBe("Describe the user-visible change.");
    const other = await saveSavedSkill(user, { name: "Off limits", body: "Leave server/billing alone." });
    await expect(saveSavedSkill(user, { id: other.id, name: "Pull requests", body: "Clash." })).rejects.toThrow(/already have a skill/);
    await deleteSavedSkill(user, saved.id);
    await expect(deleteSavedSkill(user, saved.id)).rejects.toBeInstanceOf(SavedSkillError);
    expect((await listSavedSkills(user)).map(skill => skill.name)).toEqual(["Off limits"]);
  });

  it("attaches only this account's skills, in the requested order, and skips a deleted one at run time", async () => {
    const first = await saveSavedSkill(user, { name: "First", body: "Do the first thing." });
    const second = await saveSavedSkill(user, { name: "Second", body: "Do the second thing." });
    expect((await skillsForTask(user, [second.id, first.id, second.id])).map(skill => skill.name)).toEqual(["Second", "First"]);
    await expect(skillsForTask("40000000-0000-4000-8000-000000000002", [first.id])).rejects.toThrow(/not on this account/);
    await replaceTaskSkills("task-1", user, [second.id]);
    expect(mem.sessions.get("task-1")).toEqual([second.id]);
    await deleteSavedSkill(user, second.id);
    expect((await loadTaskSkills(user, [second.id, first.id])).map(skill => skill.name)).toEqual(["First"]);
    await replaceTaskSkills("task-1", user, []);
    expect(mem.sessions.get("task-1")).toEqual([]);
  });

  it("stops at the account cap and the length caps", async () => {
    for (let index = 0; index < SAVED_SKILL_LIMITS.maxPerAccount; index++) {
      await saveSavedSkill(user, { name: `Skill ${index}`, body: "A procedure." });
    }
    await expect(saveSavedSkill(user, { name: "One more", body: "A procedure." })).rejects.toThrow(/30 skills/);
    await expect(saveSavedSkill("40000000-0000-4000-8000-000000000003", { name: "x", body: "y".repeat(SAVED_SKILL_LIMITS.body + 1) })).rejects.toThrow(/under 2000/);
    await expect(saveSavedSkill("40000000-0000-4000-8000-000000000003", { name: "", body: "A procedure." })).rejects.toThrow(/Name the skill/);
  });
});
