/** Light/dark theme: localStorage + system preference. Free-forever, no SaaS. */

export type ThemeMode = "light" | "dark";

const KEY = "bushi.theme";

export function getStoredTheme(fallback: ThemeMode): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* private mode */
  }
  try {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    /* */
  }
  return fallback;
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.style.colorScheme = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* */
  }
}

export function initTheme(defaultMode: ThemeMode): ThemeMode {
  const mode = getStoredTheme(defaultMode);
  applyTheme(mode);
  return mode;
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
