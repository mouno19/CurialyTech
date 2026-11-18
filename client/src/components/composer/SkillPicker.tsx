import { useEffect, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bookmark } from "lucide-react";
import { Link } from "wouter";
import { SAVED_SKILL_LIMITS } from "@shared/skills";
import { Tip } from "@/components/common/Tooltip";
import { POPOVER_COLLISION } from "@/components/RepoSelector";
import { refreshSavedSkills, useSavedSkills } from "@/lib/savedSkills";

const STORAGE_KEY = "curialy.skills.attached";

/** The skills the new-task composer attached last time, until the account's list says otherwise. */
export function readAttachedSkills(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, SAVED_SKILL_LIMITS.maxPerTask) : [];
  } catch {
    return [];
  }
}

export function writeAttachedSkills(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, SAVED_SKILL_LIMITS.maxPerTask)));
  } catch {
    // Private mode can refuse storage; the selection still applies to this task.
  }
}

export function SkillPicker({ selected, onChange, onReady }: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** True once this account's skills have loaded, so the task can be saved with this set. */
  onReady: (ready: boolean) => void;
}) {
  // Shared with the Skill Store and other composers: a skill saved or imported anywhere is listed here at once.
  const { skills, error } = useSavedSkills();
  const failed = Boolean(error) && !skills;
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!skills) return;
    const known = new Set(skills.map(skill => skill.id));
    const next = selected.filter(id => known.has(id)).slice(0, SAVED_SKILL_LIMITS.maxPerTask);
    if (next.join() !== selected.join()) onChangeRef.current(next);
    onReadyRef.current(true);
  }, [skills, selected]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(current => current !== id));
    else if (selected.length < SAVED_SKILL_LIMITS.maxPerTask) onChange([...selected, id]);
  };

  const count = skills ? selected.filter(id => skills.some(skill => skill.id === id)).length : selected.length;
  const full = count >= SAVED_SKILL_LIMITS.maxPerTask;

  return (
    <Popover.Root onOpenChange={open => { if (open) void refreshSavedSkills(); }}>
      <Tip content="Attach saved skills: procedures you wrote for how this account works">
        <Popover.Trigger asChild>
          <button type="button" className="toggle skill-pick" aria-label={count ? `Skills, ${count} attached` : "Skills"}>
            <Bookmark size={14} aria-hidden="true" />
            <span className="toggle-label">Skills</span>
            {count > 0 && <span className="omni-opts-count" aria-hidden="true">{count}</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content className="popover skill-pick-panel" side="bottom" align="start" sideOffset={8} collisionPadding={POPOVER_COLLISION} aria-label="Saved skills">
          <p className="skill-pick-lead">Procedures you saved. They follow this task, including a repository with no note.</p>
          {failed && <p className="field-error">Couldn't load your skills. This task keeps the ones it already has.</p>}
          {!failed && !skills && <p className="field-hint">Loading your skills…</p>}
          {skills && skills.length === 0 && (
            <p className="skill-pick-empty">None yet. <Link href="/skills" className="link">Save a skill</Link> — how tests run, how a pull request should read, which folders are off limits.</p>
          )}
          {skills && skills.length > 0 && (
            <ul className="skill-pick-list">
              {skills.map(skill => {
                const on = selected.includes(skill.id);
                return (
                  <li key={skill.id}>
                    <label className="skill-pick-row">
                      <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(skill.id)} />
                      <span>
                        <span className="skill-pick-name">{skill.name}</span>
                        <span className="skill-pick-body">{skill.body.slice(0, 240)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {full && <p className="field-hint">A task can use {SAVED_SKILL_LIMITS.maxPerTask} skills.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
