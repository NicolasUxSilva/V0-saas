"use client";

/**
 * Provedor de tema (Design System v1.0).
 *
 * O script inline do layout raiz já aplicou o tema antes da pintura; este
 * provedor só expõe a preferência para a UI, persiste as trocas e acompanha o
 * sistema operacional quando a preferência é "Sistema". Ver `src/lib/theme.ts`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  DARK_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

// Preferência salva --------------------------------------------------------

const preferenceListeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function subscribePreference(onChange: () => void) {
  preferenceListeners.add(onChange);
  // Outra aba mudou o tema.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

// Preferência do sistema ----------------------------------------------------

function subscribeSystem(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

// Troca sem flash: congela as transições de cor durante a troca, para que a
// página inteira mude no mesmo quadro (sem elementos "atrasados" piscando).
function switchTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme(root, preference, resolveTheme(preference, systemPrefersDark()));
  // Força o cálculo de estilo com as transições desligadas antes de religá-las.
  void window.getComputedStyle(root).color;
  window.setTimeout(() => root.classList.remove("theme-switching"), 1);
  preferenceListeners.forEach((listener) => listener());
}

// Contexto ----------------------------------------------------------------

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    readPreference,
    () => "system" as const,
  );
  const prefersDark = useSyncExternalStore(
    subscribeSystem,
    systemPrefersDark,
    () => false,
  );
  const resolvedTheme = resolveTheme(preference, prefersDark);

  // Mantém o <html> em dia: segue o sistema em tempo real e reaplica depois
  // do remount do Strict Mode em dev (que limpa a classe posta pelo script).
  useLayoutEffect(() => {
    applyTheme(document.documentElement, preference, resolvedTheme);
  }, [preference, resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sem storage (modo privado restrito): troca só nesta página.
    }
    switchTheme(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme precisa estar dentro de <ThemeProvider>");
  return context;
}
