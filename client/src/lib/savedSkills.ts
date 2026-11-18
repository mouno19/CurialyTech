import { useSyncExternalStore } from "react";
import type { SavedSkill } from "@shared/skills";
import { agentApi, errorMessage } from "./api";

// The account's saved skills, shared by the Skill Store and the composers' skill menus: a skill
// saved or imported anywhere is in every menu at once. Loaded on first use and again when a menu
// opens (another tab may have changed them).

type State = { skills: SavedSkill[] | null; error: string | null };
let state: State = { skills: null, error: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener());
};

// Saves and deletes made while a load is under way: the list it brings back may predate them.
let savedMeanwhile: SavedSkill[] = [];
let deletedMeanwhile = new Set<string>();
let inflight: Promise<void> | null = null;
export function refreshSavedSkills() {
  if (inflight) return inflight;
  savedMeanwhile = [];
  deletedMeanwhile = new Set();
  inflight = agentApi.skills().then(
    result => {
      const newer = new Set(savedMeanwhile.map(skill => skill.id));
      const loaded = result.skills.filter(skill => !newer.has(skill.id) && !deletedMeanwhile.has(skill.id));
      set({ skills: [...savedMeanwhile, ...loaded], error: null });
    },
    failure => set({ error: errorMessage(failure, "Couldn't load your skills.") }),
  ).finally(() => { inflight = null; });
  return inflight;
}

/** Saved or changed skills, newest first. */
export function rememberSavedSkills(...saved: SavedSkill[]) {
  const ids = new Set(saved.map(skill => skill.id));
  savedMeanwhile = [...saved, ...savedMeanwhile.filter(skill => !ids.has(skill.id))];
  if (state.skills) set({ skills: [...saved, ...state.skills.filter(skill => !ids.has(skill.id))] });
  else void refreshSavedSkills();
}

export function forgetSavedSkill(id: string) {
  deletedMeanwhile.add(id);
  savedMeanwhile = savedMeanwhile.filter(skill => skill.id !== id);
  if (state.skills) set({ skills: state.skills.filter(skill => skill.id !== id) });
}

/** The current list, for code outside React (null until loaded). */
export const savedSkillsNow = () => state.skills;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && !state.skills) void refreshSavedSkills();
  return () => { listeners.delete(listener); };
}

export function useSavedSkills() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
