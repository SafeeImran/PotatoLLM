import { useCallback, useSyncExternalStore } from "react";

export type FontSize = "sm" | "md" | "lg";
export type FontStyle = "walsheim" | "grotesk";
export type ColorTheme = "baked-potato" | "monochromatic";

export const FONT_SIZES: readonly FontSize[] = ["sm", "md", "lg"];
export const FONT_STYLES: readonly FontStyle[] = ["walsheim", "grotesk"];
export const COLOR_THEMES: readonly ColorTheme[] = ["baked-potato", "monochromatic"];

/**
 * A localStorage-backed choice, shared across every component that reads it
 * (the sidebar's appearance menu is the only reader today, but the same
 * "two independent useStates never learn about each other's writes" trap
 * that motivated usePotatoTheme's rewrite applies here too) — see that file
 * for the fuller rationale. `attr` is the <html data-*> key the CSS in
 * potato.css switches on.
 */
function createChoiceStore<T extends string>(storageKey: string, values: readonly T[], fallback: T, attr: string) {
  function read(): T {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && (values as readonly string[]).includes(stored)) return stored as T;
    } catch {
      // Private-mode / storage-disabled: fall through to the default.
    }
    return fallback;
  }

  let value: T = read();
  const listeners = new Set<() => void>();

  function apply(next: T) {
    value = next;
    if (typeof document !== "undefined") document.documentElement.dataset[attr] = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Preference just doesn't persist; the session still applies correctly.
    }
    listeners.forEach((listener) => listener());
  }

  // Applied once at module load so first paint already carries the stored
  // choice rather than a flash of the default.
  if (typeof document !== "undefined") document.documentElement.dataset[attr] = value;

  function subscribe(onStoreChange: () => void) {
    listeners.add(onStoreChange);
    return () => listeners.delete(onStoreChange);
  }

  return function useChoice() {
    const current = useSyncExternalStore(subscribe, () => value, () => value);
    const setValue = useCallback((next: T) => apply(next), []);
    return [current, setValue] as const;
  };
}

const useFontSizeChoice = createChoiceStore<FontSize>("potatollm.fontSize", FONT_SIZES, "md", "potFontSize");
const useFontStyleChoice = createChoiceStore<FontStyle>("potatollm.fontStyle", FONT_STYLES, "walsheim", "potFontFamily");
const useColorThemeChoice = createChoiceStore<ColorTheme>(
  "potatollm.colorTheme",
  COLOR_THEMES,
  "baked-potato",
  "potColorTheme",
);

/**
 * Font Size scales root `rem` sizing (potato.css), which covers every page
 * built from Tailwind's `text-*` utilities — the large majority of the app.
 * It does not reach the Playground/Header/Sidebar/Live Monitor's own
 * hand-tuned pixel sizes, which exist to match the prototype exactly rather
 * than to scale (those are now user-resizable directly instead — see the
 * sidebar's and live monitor's own drag handles).
 *
 * Font Style swaps the whole app's typeface (--pot-sans and its aliases) —
 * GT Walsheim Condensed by default, or the earlier Space Grotesk. Both are
 * vendored (see fonts.css), so switching is instant either way.
 *
 * Color Theme picks between the app's default look ("Baked Potato" — the
 * sidebar keeps its own warm accent, distinct from the monochrome main
 * pages in light mode) and "Monochromatic" (the sidebar drops that override
 * and reads from the same palette as everywhere else). Dark mode already
 * uses one palette throughout, so this only visibly changes light mode.
 */
export function useAppearance() {
  const [fontSize, setFontSize] = useFontSizeChoice();
  const [fontStyle, setFontStyle] = useFontStyleChoice();
  const [colorTheme, setColorTheme] = useColorThemeChoice();
  return { fontSize, setFontSize, fontStyle, setFontStyle, colorTheme, setColorTheme };
}
