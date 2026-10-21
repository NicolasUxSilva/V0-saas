import { describe, expect, it } from "vitest";

import {
  comparability,
  coverageNote,
  daysIn,
  filtersToQuery,
  isIsoDate,
  parseFilters,
  previousWindow,
  windowCoverage,
} from "@/server/campaigns/period";

const TODAY = "2026-10-21";

describe("parseFilters", () => {
  it("padrão: 28 dias terminando ONTEM (hoje está em curso), comparado com os 28 anteriores", () => {
    const { filters, warnings } = parseFilters({}, TODAY);
    expect(warnings).toEqual([]);
    expect(filters.current).toEqual({ start: "2026-09-23", end: "2026-10-20" });
    expect(filters.previous).toEqual({ start: "2026-08-26", end: "2026-09-22" });
    expect(filters).toMatchObject({ platform: "all", preset: 28, status: null, sort: "cost", page: 1 });
  });

  it("preset de 7 dias e comparação desligada", () => {
    const { filters } = parseFilters({ periodo: "7", comparar: "nao" }, TODAY);
    expect(filters.current).toEqual({ start: "2026-10-14", end: "2026-10-20" });
    expect(filters.previous).toBeNull();
  });

  it("período personalizado válido, com o anterior de mesmo tamanho", () => {
    const { filters } = parseFilters({ periodo: "custom", inicio: "2026-10-01", fim: "2026-10-10" }, TODAY);
    expect(filters.current).toEqual({ start: "2026-10-01", end: "2026-10-10" });
    expect(filters.previous).toEqual({ start: "2026-09-21", end: "2026-09-30" });
  });

  it("valores inválidos caem no padrão COM aviso (nunca em silêncio)", () => {
    for (const p of [
      { periodo: "custom", inicio: "2026-02-31", fim: "2026-03-01" },
      { periodo: "custom", inicio: "2026-10-10", fim: "2026-10-01" },
      { periodo: "custom", inicio: "2026-10-01", fim: "2026-10-25" },
      { periodo: "custom", inicio: "2024-01-01", fim: "2026-10-01" },
      { periodo: "13" },
    ]) {
      const { filters, warnings } = parseFilters(p, TODAY);
      expect(warnings).toHaveLength(1);
      expect(filters.preset).toBe(28);
    }
  });

  it("plataforma, status, ordem e página só aceitam valores conhecidos", () => {
    const ok = parseFilters({ plataforma: "meta_ads", status: "PAUSED", ordem: "cost_per_result", pagina: "3" }, TODAY).filters;
    expect(ok).toMatchObject({ platform: "meta_ads", status: "PAUSED", sort: "cost_per_result", page: 3 });
    const bad = parseFilters({ plataforma: "tiktok", status: "x'; drop", ordem: "hack", pagina: "-1" }, TODAY).filters;
    expect(bad).toMatchObject({ platform: "all", status: null, sort: "cost", page: 1 });
  });

  it("ida e volta pela URL preserva os filtros", () => {
    const params = { plataforma: "google_ads", periodo: "custom", inicio: "2026-10-01", fim: "2026-10-10", status: "ENABLED", ordem: "name" };
    const { filters } = parseFilters(params, TODAY);
    const back = Object.fromEntries(new URLSearchParams(filtersToQuery(filters).slice(1)));
    expect(parseFilters(back, TODAY).filters).toEqual(filters);
  });
});

describe("datas", () => {
  it("isIsoDate rejeita datas impossíveis", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("01/10/2026")).toBe(false);
  });

  it("período anterior atravessa mês e ano", () => {
    expect(previousWindow({ start: "2026-01-01", end: "2026-01-31" })).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(daysIn({ start: "2026-02-01", end: "2026-03-01" })).toBe(29);
  });
});

describe("windowCoverage", () => {
  const w = { start: "2026-10-01", end: "2026-10-10" };

  it("importação que terminou depois do período → completo", () => {
    expect(windowCoverage([{ periodStart: "2026-04-01", periodEnd: "2026-10-15" }], w).state).toBe("complete");
  });

  it("o dia em que a importação rodou é PARCIAL (estava em curso)", () => {
    const c = windowCoverage([{ periodStart: "2026-04-01", periodEnd: "2026-10-10" }], w);
    expect(c).toMatchObject({ state: "partial", completeDays: 9, partialDays: ["2026-10-10"], missingDays: 0 });
    expect(coverageNote("Período atual", c)).toContain("10/10/2026 importado ainda em curso");
  });

  it("importação posterior fecha o dia parcial", () => {
    const c = windowCoverage(
      [
        { periodStart: "2026-04-01", periodEnd: "2026-10-10" },
        { periodStart: "2026-10-05", periodEnd: "2026-10-12" },
      ],
      w,
    );
    expect(c.state).toBe("complete");
  });

  it("lacuna entre importações = dias ausentes (não zero)", () => {
    const c = windowCoverage(
      [
        { periodStart: "2026-09-01", periodEnd: "2026-10-03" },
        { periodStart: "2026-10-08", periodEnd: "2026-10-20" },
      ],
      w,
    );
    expect(c).toMatchObject({ state: "partial", completeDays: 5, partialDays: ["2026-10-03"], missingDays: 4 });
  });

  it("nenhuma importação → none", () => {
    expect(windowCoverage([], w)).toMatchObject({ state: "none", missingDays: 10 });
  });
});

describe("comparability", () => {
  const full = { days: 10, completeDays: 10, partialDays: [], missingDays: 0, state: "complete" as const };
  const part = { days: 10, completeDays: 8, partialDays: [], missingDays: 2, state: "partial" as const };

  it("só compara com os dois períodos completos", () => {
    expect(comparability(full, full)).toEqual({ comparable: true, note: null });
    expect(comparability(full, part).comparable).toBe(false);
    expect(comparability(part, full).note).toMatch(/período atual/);
    expect(comparability(full, null)).toEqual({ comparable: false, note: null });
  });
});
