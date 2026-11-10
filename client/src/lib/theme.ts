import { useSyncExternalStore } from "react";

// Light, dark, or whatever the device uses (the default). The choice is kept in this browser and
// applied as <html data-theme="light|dark"> (styles/tokens.css). The script in index.html applies it
// before the first paint, so a page never flashes the other theme: keep the two in step.

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "curialy:theme";
/** The browser's own chrome (meta theme-color) in each theme: the page background. */
export const THEME_COLOR: Record<Theme, string> = { light: "#f3efe6", dark: "#13120f" };

export const parseChoice = (value: unknown): ThemeChoice => (value === "light" || value === "dark" ? value : "system");
export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): Theme => (choice === "system" ? (systemDark ? "dark" : "light") : choice);

/** choice: what the user picked; theme: what applies; system: what the device prefers. */
type ThemeState = { choice: ThemeChoice; theme: Theme; system: Theme };

const browser = typeof window !== "undefined" && typeof document !== "undefined";
const media = browser && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const systemTheme = (): Theme => (media?.matches ? "dark" : "light");
function storedChoice(): ThemeChoice {
  try {
    return parseChoice(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "system"; // storage blocked (private windows, site data off): the device decides
  }
}

const initial = browser ? storedChoice() : "system";
let state: ThemeState = { choice: initial, theme: resolveTheme(initial, systemTheme() === "dark"), system: systemTheme() };
const listeners = new Set<() => void>();

/** Puts the theme on the page. swap: a change while the page is open, so every color switches at once (no fades). */
function apply(swap: boolean) {
  const root = document.documentElement;
  if (swap) root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", state.theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[state.theme]);
  if (swap) requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
}

function update(choice: ThemeChoice) {
  const system = systemTheme();
  const theme = resolveTheme(choice, system === "dark");
  if (choice === state.choice && theme === state.theme && system === state.system) return;
  const changed = theme !== state.theme;
  state = { choice, theme, system };
  if (changed) apply(true);
  listeners.forEach(listener => listener());
}

/** The user's pick: remembered in this browser ("system" forgets it, so the device decides again). */
export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not stored: it still applies until the page is closed.
  }
  update(choice);
}

if (browser) {
  // In step with what index.html applied (and correct if that script couldn't run).
  apply(false);
  // The device switching between light and dark while "system" is chosen.
  media?.addEventListener("change", () => update(state.choice));
  // A choice made in another tab.
  window.addEventListener("storage", event => {
    if (event.key === THEME_KEY || event.key === null) update(storedChoice());
  });
}

export const themeStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useTheme() {
  const current = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get);
  return { ...current, setChoice: setThemeChoice };
}
