import { describe, expect, it } from "vitest";

import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
} from "@/lib/theme";

describe("parseThemePreference", () => {
  it("aceita light e dark; qualquer outro valor vira system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("escolha manual vence o sistema", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system segue o sistema", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

/** Roda o script inline contra um DOM mínimo e devolve o estado do <html>. */
function runInitScript(stored: string | null, systemDark: boolean) {
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle: (name: string, on: boolean) =>
        on ? classes.add(name) : classes.delete(name),
    },
    style: { colorScheme: "" },
    dataset: {} as Record<string, string>,
  };
  const window = { matchMedia: () => ({ matches: systemDark }) };
  const localStorage = {
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null),
  };
  new Function("window", "document", "localStorage", THEME_INIT_SCRIPT)(
    window,
    { documentElement: root },
    localStorage,
  );
  return {
    dark: classes.has("dark"),
    colorScheme: root.style.colorScheme,
    preference: root.dataset.themePreference,
  };
}

describe("THEME_INIT_SCRIPT", () => {
  it("sem preferência salva, segue o sistema", () => {
    expect(runInitScript(null, true)).toEqual({
      dark: true,
      colorScheme: "dark",
      preference: "system",
    });
    expect(runInitScript(null, false)).toEqual({
      dark: false,
      colorScheme: "light",
      preference: "system",
    });
  });

  it("preferência manual persiste independentemente do sistema", () => {
    expect(runInitScript("light", true).dark).toBe(false);
    expect(runInitScript("dark", false).dark).toBe(true);
  });

  it("valor inválido salvo cai para system", () => {
    expect(runInitScript("sepia", true).preference).toBe("system");
  });

  it("não lança se o storage falhar", () => {
    expect(() =>
      new Function("window", "document", "localStorage", THEME_INIT_SCRIPT)(
        {},
        {},
        {
          getItem: () => {
            throw new Error("bloqueado");
          },
        },
      ),
    ).not.toThrow();
  });
});
