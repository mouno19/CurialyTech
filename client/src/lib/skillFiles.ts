import { parseSkill } from "@shared/skill-parser";
import { SAVED_SKILL_LIMITS, type SavedSkill } from "@shared/skills";
import { agentApi, ApiError } from "./api";
import { rememberSavedSkills } from "./savedSkills";

// A markdown file dropped on a composer, saved as a skill: read in the browser with the same reader
// the Skill Store's import uses.

export const isSkillFile = (file: File) => /\.(md|markdown)$/i.test(file.name);
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const count = (value: number) => value.toLocaleString("en-US");

/** Save a markdown file as a skill. A name already taken becomes "Name (2)", "Name (3)" and so on. */
export async function saveSkillFile(file: File): Promise<SavedSkill> {
  if (file.size > MAX_SKILL_FILE_BYTES) throw new Error(`${file.name} is larger than 1 MB, more than a skill holds.`);
  const parsed = parseSkill(await file.text(), file.name);
  if (!parsed) throw new Error(`${file.name} has no procedure to save.`);
  const body = parsed.body.trim();
  if (body.length > SAVED_SKILL_LIMITS.body) throw new Error(`${file.name} has ${count(body.length)} characters and a skill holds ${count(SAVED_SKILL_LIMITS.body)}. Import it from the Skill Store to shorten it first.`);
  const base = parsed.name || file.name.replace(/\.(md|markdown)$/i, "");
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base.slice(0, SAVED_SKILL_LIMITS.name - 5)} (${attempt})`;
    try {
      const { skill } = await agentApi.saveSkill({ name, body });
      rememberSavedSkills(skill);
      return skill;
    } catch (error) {
      if (attempt < 5 && error instanceof ApiError && /already have a skill/i.test(error.message)) continue;
      throw error;
    }
  }
}
