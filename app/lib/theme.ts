// Light/dark preference. "system" follows the device; a stored choice wins.
// Storage can be unavailable (private windows, blocked site data), so every
// access is guarded and the page still renders with the device theme.
export type ThemeChoice = "system" | "light" | "dark";
const key = "rw-theme";

export function storedTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function saveTheme(choice: ThemeChoice) {
  applyTheme(choice);
  try {
    if (choice === "system") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, choice);
  } catch {
    /* The choice still applies to this page. */
  }
}

export function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
