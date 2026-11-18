// Skills from anywhere: a SKILL.md (YAML frontmatter and a markdown body), plain markdown, a YAML
// skill file, or several of them from an archive or a folder, read into the name and procedure the
// Skill Store saves. Used by the import route (server/agent/skill-importer.ts) and, for a live
// preview of pasted text, by the Skill Store (client/src/pages/Skills.tsx). No I/O here.

import { SAVED_SKILL_LIMITS } from "./skills";

/** What one imported skill becomes: body is the procedure as it will be saved (editable before saving). */
export type ParsedSkill = { name: string; body: string; description?: string; version?: string; source?: string };
/** A text file from an upload, an archive or a remote folder; path keeps its folders (a SKILL.md is named after its folder). */
export type SkillFile = { path: string; text: string };

/** Skills one import brings in at most (an archive or a folder of skills). */
export const MAX_IMPORT_SKILLS = 10;
/** Files a single import accepts by name. */
export const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt", ".yaml", ".yml", ".zip"] as const;

/** Text as one newline style, without a byte order mark, NULs or other control characters (tabs and newlines stay). */
export function normalizeSkillText(text: string) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

// ---- A small YAML reader: the top-level scalar fields a skill uses ----

const KEY_LINE = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const indentOf = (line: string) => line.length - line.trimStart().length;

function unquoteDouble(raw: string) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape: string) => {
    if (escape[0] === "u" || escape[0] === "x") return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ n: "\n", t: "\t", r: "", "0": "", '"': '"', "\\": "\\", "/": "/", " ": " " } as Record<string, string>)[escape] ?? escape;
  });
}

/** A quoted scalar that may continue on the next lines: its text and the index after it. */
function readQuoted(lines: string[], start: number, first: string): [string, number] {
  const quote = first[0];
  let text = first.slice(1);
  let index = start;
  const closing = quote === '"' ? /(^|[^\\])(\\\\)*"/ : /'(?!')/;
  for (;;) {
    const match = closing.exec(quote === "'" ? text.replace(/''/g, "\u0000\u0000") : text);
    if (match) {
      const end = quote === '"' ? match.index + match[0].length - 1 : match.index;
      const inner = text.slice(0, end);
      return [quote === '"' ? unquoteDouble(inner) : inner.replace(/''/g, "'"), index + 1];
    }
    if (index + 1 >= lines.length) return [quote === '"' ? unquoteDouble(text) : text.replace(/''/g, "'"), index + 1];
    index++;
    // Line breaks inside a quoted scalar fold to spaces; an empty line is a newline.
    const next = lines[index].trim();
    text = next ? `${text.trimEnd()} ${next}` : `${text.trimEnd()}\n`;
  }
}

/** A block scalar (| or >, with chomping): its text and the index after it. */
function readBlock(lines: string[], start: number, header: string): [string, number] {
  const folded = header.startsWith(">");
  const keep = header.includes("+");
  const body: string[] = [];
  let indent = -1;
  let index = start + 1;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { body.push(""); continue; }
    const width = indentOf(line);
    if (width === 0 || (indent >= 0 && width < indent)) break;
    if (indent < 0) indent = width;
    body.push(line.slice(indent));
  }
  while (body.length && !body[body.length - 1]) body.pop();
  let text = "";
  if (!folded) text = body.join("\n");
  else {
    // Lines fold into one with spaces; an empty line is a line break; more-indented lines keep theirs.
    let previous: "start" | "text" | "blank" | "indented" = "start";
    for (const line of body) {
      if (!line) { text += "\n"; previous = "blank"; continue; }
      const indented = /^\s/.test(line);
      if (previous === "start" || previous === "blank") text += line;
      else text += previous === "text" && !indented ? ` ${line}` : `\n${line}`;
      previous = indented ? "indented" : "text";
    }
  }
  return [keep ? `${text}\n` : text, index];
}

/**
 * The top-level text fields of a YAML mapping, keys in lower case. Nested maps and lists are
 * skipped (a skill's metadata, allowed tools); anything that isn't YAML is ignored line by line.
 */
export function parseYamlFields(source: string): Record<string, string> {
  const lines = normalizeSkillText(source).split("\n");
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const match = !line.trim() || /^\s/.test(line) || line.trimStart().startsWith("#") ? null : KEY_LINE.exec(line.trimEnd());
    if (!match) { index++; continue; }
    const key = match[1].toLowerCase();
    const rest = (match[2] ?? "").trim();
    let value: string | undefined;
    if (/^[|>][+-]?\d*(\s+#.*)?$/.test(rest)) {
      [value, index] = readBlock(lines, index, rest);
    } else if (rest.startsWith('"') || rest.startsWith("'")) {
      [value, index] = readQuoted(lines, index, rest);
    } else {
      index++;
      if (!rest) {
        // A nested map or a list (skipped), or a plain scalar that starts on the next line.
        const next = lines.slice(index).find(item => item.trim());
        if (next && /^\s/.test(next) && !/^\s+(-\s|-$|[\w.-]+\s*:(\s|$))/.test(next)) {
          const parts: string[] = [];
          while (index < lines.length && (/^\s/.test(lines[index]) || !lines[index].trim())) parts.push(lines[index++].trim());
          value = parts.filter(Boolean).join(" ");
        } else {
          while (index < lines.length && (/^\s/.test(lines[index]) || !lines[index].trim())) index++;
        }
      } else if (rest.startsWith("[") || rest.startsWith("{")) {
        value = undefined; // a flow list or map
      } else {
        const parts = [rest.replace(/\s+#.*$/, "")];
        // A plain scalar continues on more-indented lines, folded with spaces.
        while (index < lines.length && /^\s+\S/.test(lines[index]) && !/^\s+-\s/.test(lines[index])) parts.push(lines[index++].trim());
        value = parts.join(" ");
        if (/^(~|null)$/i.test(value)) value = "";
      }
    }
    if (value !== undefined) fields[key] = value.trim();
  }
  return fields;
}

/** The frontmatter fields and the markdown after them, or null when the text has no frontmatter. */
export function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } | null {
  const normalized = normalizeSkillText(text);
  const match = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) return null;
  return { fields: parseYamlFields(match[1] ?? ""), body: normalized.slice(match[0].length) };
}

// ---- Names ----

/** A name as the Skill Store keeps it: plain text on one line, no markdown, at most 80 characters (cut at a word). */
export function cleanSkillName(raw: string) {
  let name = normalizeSkillText(raw)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]{0,200}>/g, "")
    .replace(/[`*]+/g, "")
    .replace(/(^|\s)_{1,2}(\S(?:.*?\S)?)_{1,2}(?=\s|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[\s:–—-]+$/, "")
    .trim();
  if (name.length > SAVED_SKILL_LIMITS.name) {
    const cut = name.slice(0, SAVED_SKILL_LIMITS.name + 1);
    const space = cut.lastIndexOf(" ");
    name = (space > SAVED_SKILL_LIMITS.name * 0.6 ? cut.slice(0, space) : cut.slice(0, SAVED_SKILL_LIMITS.name)).trim();
  }
  return name;
}

const GENERIC_FILE = /^(skill|skills|readme|index|instructions|prompt|agents?|untitled)$/i;
const ACRONYMS = new Set(["api", "apis", "pdf", "docx", "xlsx", "pptx", "csv", "json", "yaml", "html", "css", "sql", "ui", "ux", "ai", "llm", "mcp", "seo", "ci", "cd", "pr", "prs", "cli", "sdk", "url", "http", "ios", "svg", "qa", "tdd", "e2e", "faq"]);

/**
 * A slug ("frontend-design", "pdf", "code_review") as words ("Frontend design", "PDF", "Code review"),
 * common abbreviations in capitals. Anything that isn't a slug is returned as it is.
 */
export function humanizeSlug(name: string) {
  if (!/^[a-z0-9]+([-_.][a-z0-9]+)*$/.test(name)) return name;
  return name.split(/[-_.]+/).map((word, index) => (ACRONYMS.has(word) ? word.toUpperCase() : index === 0 ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");
}

/** A name from a file path: its name without extensions, or its folder's for a SKILL.md, in words. */
export function nameFromPath(filePath: string) {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  let base = (parts.at(-1) ?? "").replace(/(\.(md|markdown|txt|ya?ml|zip))+$/i, "");
  if (GENERIC_FILE.test(base)) base = parts.length > 1 ? parts.at(-2)! : "";
  if (GENERIC_FILE.test(base)) base = "";
  const slug = base.trim().toLowerCase() === base.trim() ? humanizeSlug(base.trim().replace(/\s+/g, "-")) : base;
  return cleanSkillName(slug.replace(/[-_]+/g, " ").replace(/\s+/g, " "));
}

/** The first level-one heading outside code blocks (# Title, or Title over ===) and the text without it. */
export function takeTitle(markdown: string): { title: string; rest: string } | null {
  const lines = markdown.split("\n");
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const atx = /^\s{0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    const setext = line.trim() && /^\s{0,3}=+\s*$/.test(lines[index + 1] ?? "") ? line.trim() : null;
    const title = atx?.[1] ?? setext;
    if (title && cleanSkillName(title)) {
      const rest = [...lines.slice(0, index), ...lines.slice(index + (setext && !atx ? 2 : 1))].join("\n");
      return { title: cleanSkillName(title), rest };
    }
  }
  return null;
}

/** A name from the first line of plain text: up to 60 characters, cut at a word. */
function nameFromFirstLine(text: string) {
  const line = text.split("\n").map(item => item.trim()).find(Boolean) ?? "";
  const plain = cleanSkillName(line.replace(/^[#>*\-\d.)\s]+/, ""));
  if (plain.length <= 60) return plain;
  const cut = plain.slice(0, 61);
  const space = cut.lastIndexOf(" ");
  return (space > 30 ? cut.slice(0, space) : cut.slice(0, 60)).trim();
}

/** Body text tidied: no trailing spaces on lines, at most one blank line in a row, trimmed. */
function tidy(text: string) {
  return text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

const looksLikeYamlSkill = (text: string) => /^name[ \t]*:/im.test(text.split("\n").find(line => line.trim() && !line.trimStart().startsWith("#")) ?? "") && /^(instructions|procedure|body|prompt|content)[ \t]*:/im.test(text);

/**
 * One skill from a file or pasted text, or null when there is nothing to save.
 * - Frontmatter (--- … ---): name, description, version and instructions from it, the markdown after
 *   it as the procedure; without a name, the first # heading, then the file name.
 * - Plain markdown or text: the first # heading is the name and the rest the procedure.
 * - A YAML skill file: name, description and instructions (or procedure / body / prompt).
 * The description, when there is one and the procedure doesn't already open with it, leads the
 * procedure: it says when the skill applies.
 */
export function parseSkill(source: string, filename = ""): ParsedSkill | null {
  const text = normalizeSkillText(source);
  if (!text.trim()) return null;
  let fields: Record<string, string> = {};
  let markdown: string;
  const front = splitFrontmatter(text);
  if (front) {
    fields = front.fields;
    markdown = front.body;
  } else if (/\.ya?ml$/i.test(filename) || looksLikeYamlSkill(text)) {
    fields = parseYamlFields(text);
    markdown = "";
  } else {
    markdown = text;
  }
  const instructions = fields.instructions || fields.procedure || fields.body || fields.prompt || fields.content || "";
  let name = cleanSkillName(humanizeSlug((fields.name || fields.title || "").trim()));
  if (!name) {
    const title = takeTitle(markdown);
    if (title) {
      name = title.title;
      markdown = title.rest;
    }
  }
  if (!name) name = nameFromPath(filename);
  const description = tidy(fields.description || fields.summary || "").replace(/\s*\n\s*/g, " ") || undefined;
  const procedure = tidy([instructions, markdown].map(part => tidy(part)).filter(Boolean).join("\n\n"));
  if (!procedure && !description) return null;
  const opensWithDescription = description && procedure.slice(0, description.length + 200).replace(/\s+/g, " ").includes(description);
  const body = tidy([opensWithDescription ? "" : description ?? "", procedure].filter(Boolean).join("\n\n"));
  if (!name) name = nameFromFirstLine(procedure || body);
  const version = cleanSkillName(fields.version || "").slice(0, 20) || undefined;
  return { name, body, ...(description ? { description } : {}), ...(version ? { version } : {}) };
}

const IGNORED_SEGMENT = /^(__MACOSX|node_modules|\..+)$/;
const NOT_A_SKILL = /^(readme|license|licence|changelog|changes|contributing|code_of_conduct|security|notice|authors|history|support)(\.[^/]*)?$/i;

/** A path inside an archive or folder worth reading as a skill: markdown, not hidden or system files. */
export function isSkillCandidate(filePath: string) {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some(part => IGNORED_SEGMENT.test(part))) return false;
  return /\.(md|markdown)$/i.test(parts.at(-1)!);
}

/**
 * The skills in a set of files (an archive, a folder): every SKILL.md when there is one (the other
 * files of a skill's folder are its resources), otherwise each markdown file that isn't a README,
 * licence or changelog, and a README only when nothing else is there. Up to MAX_IMPORT_SKILLS,
 * shallowest first; names made unique within the import.
 */
export function skillsFromFiles(files: SkillFile[]): { skills: ParsedSkill[]; skipped: number } {
  const markdown = files.filter(file => isSkillCandidate(file.path));
  const skillFiles = markdown.filter(file => /(^|\/)skill\.md$/i.test(file.path));
  let picked = skillFiles.length ? skillFiles : markdown.filter(file => !NOT_A_SKILL.test(file.path.split("/").at(-1)!));
  if (!picked.length) picked = markdown;
  const depth = (file: SkillFile) => file.path.split("/").length;
  picked = [...picked].sort((a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path));
  const skills: ParsedSkill[] = [];
  const taken = new Set<string>();
  let considered = 0;
  for (const file of picked) {
    if (skills.length >= MAX_IMPORT_SKILLS) break;
    considered++;
    const parsed = parseSkill(file.text, file.path);
    if (!parsed) continue;
    let name = parsed.name || nameFromPath(file.path) || "Imported skill";
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${(parsed.name || "Imported skill").slice(0, SAVED_SKILL_LIMITS.name - 5)} (${n})`;
    taken.add(name.toLowerCase());
    skills.push({ ...parsed, name, source: file.path });
  }
  return { skills, skipped: picked.length - considered };
}

/** POST /api/agent/skills/import: what was read (each skill's length, and whether it fits a saved skill), and with autoSave what was saved. */
export type SkillImportResponse = {
  skills: (ParsedSkill & { chars: number; fits: boolean })[];
  /** Skills found beyond MAX_IMPORT_SKILLS (not read). */
  skipped: number;
  saved?: import("./skills").SavedSkill[];
  failed?: { name: string; error: string }[];
};
