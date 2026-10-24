import type { CurialySkill } from "@shared/skills";

export type LocalTask = {
  id: string;
  prompt: string;
  createdAt: string;
  status: "queued" | "planning" | "running" | "completed" | "failed" | "cancelled";
  model: string;
  think: boolean;
  webSearch: boolean;
  answer?: string;
  plan?: string[];
  skillsUsed?: string[];
  provider?: "platform-llm" | "local-demo";
  limitation?: string;
};

export type Preferences = {
  model: string;
  think: boolean;
  webSearch: boolean;
};

const TASKS_KEY = "curialy.tasks.v1";
const PREFS_KEY = "curialy.preferences.v1";

export const defaultPreferences: Preferences = {
  model: "gemini-3-flash-preview",
  think: false,
  webSearch: false,
};

export function readTasks(): LocalTask[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeTasks(tasks: LocalTask[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks.slice(0, 40)));
}

export function readPreferences(): Preferences {
  try {
    return { ...defaultPreferences, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return defaultPreferences;
  }
}

export function writePreferences(preferences: Preferences) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

export function formatRelativeTime(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function skillName(id: string, skills: CurialySkill[]) {
  return skills.find(skill => skill.id === id)?.name ?? id;
}
