import { describe, expect, it, vi } from "vitest";
import type { SavedSkill } from "@shared/skills";

const api = vi.hoisted(() => ({ skills: vi.fn() }));
vi.mock("./api", () => ({ agentApi: api, errorMessage: (_error: unknown, fallback: string) => fallback }));
const { forgetSavedSkill, refreshSavedSkills, rememberSavedSkills, savedSkillsNow } = await import("./savedSkills");

const skill = (id: string, name = id): SavedSkill => ({ id, name, body: "Do it.", updatedAt: "2026-11-18T12:00:00.000Z" });

describe("the shared saved-skills list", () => {
  it("keeps a skill saved, and drops one deleted, while an older list was loading", async () => {
    let answer!: (value: { skills: SavedSkill[] }) => void;
    api.skills.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
    const loading = refreshSavedSkills();
    // Saved and deleted after the load started: the list it brings back predates both.
    rememberSavedSkills(skill("new", "Imported"));
    forgetSavedSkill("gone");
    answer({ skills: [skill("old"), skill("gone")] });
    await loading;
    expect(savedSkillsNow()?.map(item => item.id)).toEqual(["new", "old"]);

    // Once loaded, a save lands first at once; a later load is the server's word again.
    rememberSavedSkills(skill("newer"));
    expect(savedSkillsNow()?.map(item => item.id)).toEqual(["newer", "new", "old"]);
    api.skills.mockResolvedValueOnce({ skills: [skill("newer"), skill("old")] });
    await refreshSavedSkills();
    expect(savedSkillsNow()?.map(item => item.id)).toEqual(["newer", "old"]);
  });
});
