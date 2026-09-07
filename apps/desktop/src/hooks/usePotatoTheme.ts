import { useCallback, useSyncExternalStore } from "react";

export type PotatoTheme = "light" | "dark";

const STORAGE_KEY = "potatollm.theme";

function readStoredTheme(): PotatoTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private-mode / storage-disabled: fall through to the OS preference.
  }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * Module-level store, not component state: the theme is now read from more
 * than one place at once (the header's toggle, the sidebar's appearance
 * menu), and two independent `useState`s never learn about each other's
 * writes — the second mount would keep showing whatever theme was current
 * when it happened to read localStorage, forever. `useSyncExternalStore`
 * keeps every call site in lockstep with this one value instead.
 */
let theme: PotatoTheme = readStoredTheme();
const listeners = new Set<() => void>();

function applyTheme(next: PotatoTheme) {
  theme = next;
  // <html data-pot-theme> is where potato.css's Tailwind-token mapping is
  // declared — see the comment at the top of that file — so it has to live
  // on the root element, not a React-rendered wrapper.
  if (typeof document !== "undefined") document.documentElement.dataset.potTheme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Preference just doesn't persist; the session still themes correctly.
  }
  listeners.forEach((listener) => listener());
}

// Applied once at module load (before any component mounts) so the very
// first paint already carries the right theme rather than a flash of dark.
if (typeof document !== "undefined") {
  document.documentElement.dataset.potTheme = theme;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function usePotatoTheme() {
  const current = useSyncExternalStore(subscribe, () => theme, () => theme);
  const setTheme = useCallback((next: PotatoTheme) => applyTheme(next), []);
  const toggleTheme = useCallback(() => applyTheme(theme === "dark" ? "light" : "dark"), []);

  return { theme: current, setTheme, toggleTheme };
}
