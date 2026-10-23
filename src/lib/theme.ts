/**
 * Tema (Design System v1.0): preferência Claro / Escuro / Sistema.
 *
 * A preferência fica no `localStorage` (só neste navegador; não vai ao
 * servidor nem ao banco). O tema resolvido é aplicado como a classe `.dark` em
 * `<html>` — a mesma que os componentes já usam via `dark:`.
 *
 * `THEME_INIT_SCRIPT` roda inline no `<head>`, antes da primeira pintura, para
 * evitar o flash de tema errado (padrão de
 * node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md).
 */

export const THEME_STORAGE_KEY = "theseed-theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Aplica o tema resolvido ao `<html>`. Mesma lógica do script inline. */
export function applyTheme(
  root: HTMLElement,
  preference: ThemePreference,
  resolved: ResolvedTheme,
) {
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  root.dataset.themePreference = preference;
}

export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}).matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";r.dataset.themePreference=p}catch(e){}})()`;
