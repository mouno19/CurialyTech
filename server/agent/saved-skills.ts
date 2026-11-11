import { SAVED_SKILL_LIMITS, type SavedSkill } from "@shared/skills";
import { cleanText } from "../db/json";
import { query } from "../db/pg";
import { setTaskSkills } from "./store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SavedSkillError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SavedSkillError";
    this.status = status;
  }
}

type SkillRow = { id: string; name: string; body: string; updated_at: Date | string };

const toSkill = (row: SkillRow): SavedSkill => ({
  id: row.id,
  name: row.name,
  body: row.body,
  updatedAt: (row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)).toISOString(),
});

const isUnique = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "23505";

function skillName(raw: string) {
  return cleanText(raw).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

function assertText(name: string, body: string) {
  if (!name) throw new SavedSkillError("Name the skill.");
  if (name.length > SAVED_SKILL_LIMITS.name) throw new SavedSkillError(`Keep the name under ${SAVED_SKILL_LIMITS.name} characters.`);
  if (!body) throw new SavedSkillError("Write the procedure.");
  if (body.length > SAVED_SKILL_LIMITS.body) throw new SavedSkillError(`Keep the procedure under ${SAVED_SKILL_LIMITS.body} characters.`);
}

/** Ids in request order, duplicates removed. strict rejects anything that is not a uuid or past the cap. */
function wantedIds(ids: string[], strict: boolean) {
  const unique: string[] = [];
  for (const id of ids) {
    if (!UUID.test(id)) {
      if (strict) throw new SavedSkillError("One of those skills is not on this account.");
      continue;
    }
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length > SAVED_SKILL_LIMITS.maxPerTask) throw new SavedSkillError(`A task can use ${SAVED_SKILL_LIMITS.maxPerTask} skills.`);
  return unique;
}

async function selectSkills(userId: string, ids: string[]) {
  const { rows } = await query<SkillRow>(
    "SELECT id, name, body, updated_at FROM curialy.user_skills WHERE user_id = $1 AND id = ANY($2::uuid[])",
    [userId, ids],
  );
  const byId = new Map(rows.map(row => [row.id, toSkill(row)]));
  return ids.map(id => byId.get(id)).filter((skill): skill is SavedSkill => Boolean(skill));
}

export async function listSavedSkills(userId: string): Promise<SavedSkill[]> {
  const { rows } = await query<SkillRow>(
    "SELECT id, name, body, updated_at FROM curialy.user_skills WHERE user_id = $1 ORDER BY updated_at DESC, name",
    [userId],
  );
  return rows.map(toSkill);
}

/** Create, or update when id is set. The name is unique per account, ignoring case. */
export async function saveSavedSkill(userId: string, input: { id?: string; name: string; body: string }): Promise<SavedSkill> {
  const name = skillName(input.name);
  const body = cleanText(input.body).trim();
  assertText(name, body);
  if (input.id) {
    if (!UUID.test(input.id)) throw new SavedSkillError("That skill is not on this account.", 404);
    const { rows } = await query<SkillRow>(
      `UPDATE curialy.user_skills SET name = $3, body = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2
         AND NOT EXISTS (SELECT 1 FROM curialy.user_skills other WHERE other.user_id = $2 AND other.id <> $1 AND lower(other.name) = lower($3))
       RETURNING id, name, body, updated_at`,
      [input.id, userId, name, body],
    );
    if (rows[0]) return toSkill(rows[0]);
    const { rows: owned } = await query<{ id: string }>("SELECT id FROM curialy.user_skills WHERE id = $1 AND user_id = $2", [input.id, userId]);
    throw new SavedSkillError(owned[0] ? "You already have a skill with that name." : "That skill is not on this account.", owned[0] ? 400 : 404);
  }
  const { rows: count } = await query<{ n: number | string }>("SELECT count(*)::int AS n FROM curialy.user_skills WHERE user_id = $1", [userId]);
  if (Number(count[0]?.n ?? 0) >= SAVED_SKILL_LIMITS.maxPerAccount) throw new SavedSkillError(`You can save ${SAVED_SKILL_LIMITS.maxPerAccount} skills.`);
  try {
    const { rows } = await query<SkillRow>(
      `INSERT INTO curialy.user_skills (user_id, name, body)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM curialy.user_skills WHERE user_id = $1 AND lower(name) = lower($2))
       RETURNING id, name, body, updated_at`,
      [userId, name, body],
    );
    if (!rows[0]) throw new SavedSkillError("You already have a skill with that name.");
    return toSkill(rows[0]);
  } catch (error) {
    if (error instanceof SavedSkillError) throw error;
    if (isUnique(error)) throw new SavedSkillError("You already have a skill with that name.");
    throw error;
  }
}

export async function deleteSavedSkill(userId: string, id: string) {
  if (!UUID.test(id)) throw new SavedSkillError("That skill is not on this account.", 404);
  const { rowCount } = await query("DELETE FROM curialy.user_skills WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!rowCount) throw new SavedSkillError("That skill is not on this account.", 404);
}

/** The account's skills for these ids, in the requested order. Unknown ids are an error. */
export async function skillsForTask(userId: string, ids: string[]) {
  const unique = wantedIds(ids, true);
  if (!unique.length) return [];
  const found = await selectSkills(userId, unique);
  if (found.length !== unique.length) throw new SavedSkillError("One of those skills is not on this account.");
  return found;
}

/** Skills still on the account when a run starts. A deleted one is skipped. */
export async function loadTaskSkills(userId: string, ids: string[]) {
  const unique = wantedIds(ids, false);
  if (!unique.length) return [];
  return selectSkills(userId, unique);
}

/** Replace the skills attached to a task with this account's skills, in this order. */
export async function replaceTaskSkills(taskId: string, userId: string, ids: string[]) {
  const skills = await skillsForTask(userId, ids);
  await setTaskSkills(taskId, skills.map(skill => skill.id));
  return skills;
}

/** System text for the attached procedures. Empty when the task has none. */
export function renderSavedSkills(skills: { name: string; body: string }[]) {
  const kept = skills
    .slice(0, SAVED_SKILL_LIMITS.maxPerTask)
    .map(skill => ({ name: skill.name.trim().slice(0, SAVED_SKILL_LIMITS.name), body: skill.body.trim().slice(0, SAVED_SKILL_LIMITS.body) }))
    .filter(skill => skill.name && skill.body);
  if (!kept.length) return "";
  const blocks = kept.map(skill => `### ${skill.name}\n${skill.body}`);
  return `Saved skills for this task. The user wrote these procedures and asked you to follow them here, including when this task has no repository note:\n\n${blocks.join("\n\n")}`;
}
