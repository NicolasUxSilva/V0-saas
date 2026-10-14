/**
 * O filtro SQL de `fact_ad_performance_daily`.
 *
 * A tabela é compartilhada entre Google Ads e Meta Ads e guarda dado de vários clientes.
 * Se uma leitura esquecer a PLATAFORMA, o contexto de uma plataforma engole as linhas da
 * outra; se esquecer o WORKSPACE, vaza dado entre clientes. Sem Postgres no teste, o que
 * se confere é o SQL que o Drizzle gera — e que TODA leitura da tabela, em `context.ts`,
 * passa por esse filtro.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

const { adPerformanceFilter } = await import("@/server/analysis/context");

const dialect = new PgDialect();
const WINDOW = { start: "2026-10-01", end: "2026-10-04" };

function render(platform: "google_ads" | "meta_ads", workspaceId = "ws-1") {
  const filter = adPerformanceFilter(workspaceId, platform, WINDOW);
  if (!filter) throw new Error("filtro vazio");
  return dialect.sqlToQuery(filter);
}

describe("adPerformanceFilter", () => {
  it("filtra por workspace, plataforma e janela — nessa ordem, com parâmetros (nunca texto colado)", () => {
    const q = render("google_ads");
    expect(q.sql).toBe(
      '("fact_ad_performance_daily"."workspace_id" = $1 and "fact_ad_performance_daily"."platform" = $2 and "fact_ad_performance_daily"."date" >= $3 and "fact_ad_performance_daily"."date" <= $4)',
    );
    expect(q.params).toEqual(["ws-1", "google_ads", "2026-10-01", "2026-10-04"]);
  });

  it("cada plataforma lê SÓ as próprias linhas", () => {
    expect(render("google_ads").params[1]).toBe("google_ads");
    expect(render("meta_ads").params[1]).toBe("meta_ads");
  });

  it("o workspace entra como parâmetro: um injeta o outro? não", () => {
    const q = render("meta_ads", "ws-1' or '1'='1");
    expect(q.sql).not.toContain("or '1'='1");
    expect(q.params[0]).toBe("ws-1' or '1'='1");
  });
});

describe("toda leitura de fact_ad_performance_daily em context.ts usa o filtro", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "context.ts"), "utf8");
  const lines = src.split("\n");

  it("cada `.from(factAdPerformanceDaily)` é seguido do filtro de plataforma", () => {
    const froms = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(".from(factAdPerformanceDaily)"));
    expect(froms.length).toBe(4); // 2 do Google Ads + 2 do Meta Ads
    for (const { i } of froms) {
      const next = lines.slice(i, i + 4).join("\n");
      expect(next, `leitura sem filtro na linha ${i + 1}`).toMatch(/\.where\((adPerformanceFilter\(|inWindow\))/);
    }
  });

  it("os dois contextos usam plataformas diferentes e nenhuma consulta fica sem plataforma", () => {
    expect(src).toContain('adPerformanceFilter(workspaceId, "google_ads", window)');
    expect(src).toContain('adPerformanceFilter(workspaceId, "meta_ads", window)');
    expect(src).not.toMatch(/factAdPerformanceDaily\.platform,\s*"/); // nada de eq() solto fora do filtro
  });
});
