/**
 * Guarda arquitetural da orquestração workspace-level (bloco G4).
 *
 * Não toca o banco: `runWorkspaceAnalysis`/`buildAnalysisContext` importam o
 * cliente `postgres()` (lazy — só abre conexão na 1ª query), mas nenhum teste
 * aqui invoca uma query. O que se verifica é o CONTRATO e as INVARIANTES da
 * fronteira sync→análise (INV-6, INV-8, INV-9), não o comportamento do motor
 * (isso já é coberto por stats/gates/contribution/detectors.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as engine from "@/server/analysis/engine";

const SRC_ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (relPath: string) => readFileSync(join(SRC_ROOT, relPath), "utf8");

describe("runWorkspaceAnalysis — contrato de orquestração (INV-8, INV-9)", () => {
  it("é exportada com este nome (a fronteira é explícita, não um alias de runAnalysis)", () => {
    expect(typeof engine.runWorkspaceAnalysis).toBe("function");
    expect("runAnalysis" in engine).toBe(false);
  });

  it("assinatura aceita só { workspaceId, syncRunId } — provider não é necessário (item C)", () => {
    // Checagem em tempo de compilação: se `runWorkspaceAnalysis` exigisse mais
    // campos (ex.: `provider`), esta atribuição falharia no `pnpm typecheck`.
    const _typeContract: (input: {
      workspaceId: string;
      syncRunId: string;
    }) => ReturnType<typeof engine.runWorkspaceAnalysis> =
      engine.runWorkspaceAnalysis;
    expect(typeof _typeContract).toBe("function");
  });
});

describe("fronteira sync → análise — sem branch por provider (INV-9)", () => {
  const runSyncSrc = read("server/sync/run-sync.ts");

  it("run-sync.ts chama runWorkspaceAnalysis (não mais runAnalysis)", () => {
    expect(runSyncSrc).toContain("runWorkspaceAnalysis({");
    expect(runSyncSrc).not.toMatch(/[^a-zA-Z]runAnalysis\(/);
  });

  it("nenhum if/switch por provider decide se a análise roda", () => {
    // Isola o trecho entre "análise workspace-level" e o catch que a envolve —
    // não pode haver `provider ===` (ou `switch(provider)`) nesse trecho.
    const start = runSyncSrc.indexOf("análise workspace-level");
    const end = runSyncSrc.indexOf("runWorkspaceAnalysis({", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const guardZone = runSyncSrc.slice(start, end);
    expect(guardZone).not.toMatch(/provider\s*===|switch\s*\(\s*.*provider/);
  });

  it("a chamada propaga workspaceId e syncRunId do sync corrente (item A/B)", () => {
    expect(runSyncSrc).toContain(
      "runWorkspaceAnalysis({ workspaceId: conn.workspaceId, syncRunId: run.id })",
    );
  });
});

describe("analysis engine — Ads entra no CONTEXTO, nunca nos detectors (G4 INV-6 → G5)", () => {
  // Pré-G5, `context.ts` também não mencionava Ads — essa era a forma que a
  // invariante tomava antes do contexto composto existir. Desde o G5,
  // `context.ts` DEVE referenciar `fact_ad_performance_daily` (é o seu
  // trabalho); a invariante que continua de pé é mais precisa: os
  // consumidores do contexto — detectors/gates/scoring — nunca podem.
  const contextSrc = read("server/analysis/context.ts");
  const detectorsSrc = read("server/analysis/detectors.ts");
  const gatesSrc = read("server/analysis/gates.ts");
  const scoringSrc = read("server/analysis/scoring.ts");

  it("context.ts constrói o contexto de Ads a partir de fact_ad_performance_daily (G5)", () => {
    expect(contextSrc).toContain("factAdPerformanceDaily");
    expect(contextSrc).toContain("composeAdsContext");
  });

  it("detectors.ts / gates.ts / scoring.ts continuam sem nenhuma referência a Ads (itens G/H/I)", () => {
    for (const src of [detectorsSrc, gatesSrc, scoringSrc]) {
      expect(src).not.toMatch(
        /ctx\.ads|AdsContext|factAdPerformanceDaily|google_ads|googleAdsConnector/,
      );
    }
  });
});

describe("analysis engine — RD Station entra no CONTEXTO, nunca nos detectors (bloco RD-1)", () => {
  // Mesmo princípio do bloco acima para o Ads (G5): `context.ts` DEVE
  // referenciar as fact tables do RD Station (é o seu trabalho); os
  // consumidores do contexto — detectors/gates/scoring — nunca podem. Também
  // confirma que RD não criou dependência direta com GA4 nem com Ads (as
  // fontes só se encontram ACIMA dos conectores: no enriquecimento do G6 e na
  // camada pura `cross-source/`).
  const contextSrc = read("server/analysis/context.ts");
  const detectorsSrc = read("server/analysis/detectors.ts");
  const gatesSrc = read("server/analysis/gates.ts");
  const scoringSrc = read("server/analysis/scoring.ts");
  const enrichmentSrc = read("server/analysis/enrichment.ts");

  it("context.ts constrói os contextos de RD Station a partir das fact tables certas (RD-1)", () => {
    expect(contextSrc).toContain("factConversionAssetsDaily");
    expect(contextSrc).toContain("composeRdMarketingContext");
    expect(contextSrc).toContain("factDeals");
    expect(contextSrc).toContain("composeRdCrmContext");
  });

  it("detectors.ts / gates.ts / scoring.ts não referenciam RD Station", () => {
    for (const src of [detectorsSrc, gatesSrc, scoringSrc]) {
      expect(src).not.toMatch(
        /ctx\.rdMarketing|ctx\.rdCrm|RdMarketingContext|RdCrmContext|factConversionAssetsDaily|factDeals|rd_station/,
      );
    }
  });

  it("o enriquecimento do G6 (Ads) continua sem nenhuma referência a RD Station — o cross-source de RD vive em `cross-source/`, não aqui", () => {
    expect(enrichmentSrc).not.toMatch(
      /rdMarketing|rdCrm|RdMarketingContext|RdCrmContext|rd_station/,
    );
  });

  it("RD Station não referencia GA4/Ads diretamente, e GA4/Ads não referenciam RD Station (fontes só se encontram acima dos conectores: enriquecimento e `cross-source/`)", () => {
    // Só o CÓDIGO importa aqui — os comentários destes arquivos legitimamente
    // CITAM Google Ads/GA4 em prosa (para contrastar o que é diferente na API
    // do RD), o que é documentação, não uma dependência (mesmo filtro que
    // `enrichment.test.ts` usa para `AnalysisContext`/`ctx`).
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const rdMarketingFiles = [
      "server/connectors/rd_station_marketing/oauth.ts",
      "server/connectors/rd_station_marketing/http.ts",
      "server/connectors/rd_station_marketing/discovery.ts",
      "server/connectors/rd_station_marketing/extract.ts",
      "server/connectors/rd_station_marketing/mapping.ts",
    ];
    const rdCrmFiles = [
      "server/connectors/rd_station_crm/oauth.ts",
      "server/connectors/rd_station_crm/http.ts",
      "server/connectors/rd_station_crm/discovery.ts",
      "server/connectors/rd_station_crm/extract.ts",
      "server/connectors/rd_station_crm/mapping.ts",
    ];
    for (const path of [...rdMarketingFiles, ...rdCrmFiles]) {
      const code = stripComments(read(path));
      expect(code).not.toMatch(/ga4|google_ads|googleAds/i);
    }

    const ga4GoogleAdsFiles = [
      "server/connectors/ga4/extract.ts",
      "server/connectors/ga4/mapping.ts",
      "server/connectors/google_ads/extract.ts",
      "server/connectors/google_ads/mapping.ts",
    ];
    for (const path of ga4GoogleAdsFiles) {
      const code = stripComments(read(path));
      expect(code).not.toMatch(/rd_station|rdStation/i);
    }
  });
});
