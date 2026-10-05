/**
 * Limitações — a gravidade é uma tabela EXPLÍCITA por código estável, e este teste
 * trava a sua completude contra os códigos que o Cross-source de fato emite: um
 * código novo sem classificação quebra aqui, em vez de cair em silêncio no padrão.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCrossSourceInsights } from "@/server/analysis/cross-source";

import {
  LIMITATION_SEVERITY,
  bySeverity,
  comparisonNotComputable,
  crossSourceNotGenerated,
  diagnosticsPeriodDiffers,
  evidenceConflict,
  isClassified,
  llmNotConnected,
  modelFailed,
  modelOutputRejected,
  severityOf,
} from "../limitations";
import type { AdvisorLimitation } from "../types";
import {
  OCT,
  OCT_GA4_ROWS,
  deal,
  lost,
  makeRdCrm,
  makeRdMarketing,
  octoberContext,
  octoberCrmRows,
  periodContext,
  septemberContext,
  won,
} from "./advisor-fixtures";

const SRC = join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Todos os códigos de limitação que as fixtures fazem o Cross-source emitir, em cenários que cobrem os ramos. */
function emittedCodes(): Set<string> {
  const crmNoValue = makeRdCrm(
    [
      ...Array.from({ length: 3 }, () => deal({ dealCreatedAt: "2026-10-02" })),
      ...Array.from({ length: 2 }, () => won({ dealClosedAt: "2026-10-01" })),
      ...Array.from({ length: 2 }, () => lost({ dealClosedAt: "2026-10-02" })),
    ],
    OCT,
    "2026-04-07",
  );
  const noClosed = makeRdCrm(Array.from({ length: 2 }, () => deal({ dealCreatedAt: "2026-10-02" })), OCT, "2026-04-07");
  const withLostValue = makeRdCrm(
    [
      ...octoberCrmRows(),
      lost({ totalPrice: 500, dealClosedAt: "2026-10-03" }),
    ],
    OCT,
    "2026-04-07",
  );
  const contexts = [
    octoberContext(),
    octoberContext({ ga4Days: [] }),
    octoberContext({ ga4Days: ["2026-10-01", "2026-10-02"] }),
    octoberContext({ rdMarketing: null }),
    octoberContext({ rdCrm: null }),
    octoberContext({ rdMarketing: null, rdCrm: null }),
    octoberContext({ rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-10-03") }),
    octoberContext({ rdCrm: crmNoValue }),
    octoberContext({ rdCrm: noClosed }),
    octoberContext({ rdCrm: withLostValue }),
    octoberContext({ ga4Rows: OCT_GA4_ROWS.map((r) => ({ ...r, sessions: 0 })) }),
    // GA4 atrasado: só até 02/10, quando o esperado era 04/10
    periodContext({
      period: OCT,
      ga4Rows: OCT_GA4_ROWS.slice(0, 2),
      ga4LastDate: "2026-10-02",
      expectedLastDate: "2026-10-04",
      rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 3, conversions: 1 }], { window: OCT, days: 4 }),
      rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-04-07"),
    }),
    septemberContext(),
  ];
  const codes = new Set<string>();
  for (const ctx of contexts) {
    for (const insight of buildCrossSourceInsights(ctx)) {
      for (const s of insight.statements) if (s.layer === "limitation" && s.code) codes.add(s.code);
    }
  }
  return codes;
}

describe("gravidade das limitações", () => {
  it("fonte indisponível é bloqueante", () => {
    for (const code of ["ga4_unavailable", "rd_marketing_unavailable", "rd_crm_unavailable", "no_acquisition_data"]) {
      expect(severityOf(code), code).toBe("blocking");
    }
  });

  it("dado parcial, sem comparação segura ou sem moeda é atenção", () => {
    for (const code of [
      "ga4_partial_days",
      "ga4_data_lag",
      "rd_marketing_partial_days",
      "rd_crm_partial_imported_history",
      "period_mismatch",
      "period_not_aligned",
      "won_value_partial",
      "lost_value_partial",
      "currency_not_informed",
      "campaign_id_insufficient",
      "source_id_insufficient",
      "rd_marketing_no_conversions",
      "metric_not_computable:win_rate",
      "metric_not_computable:average_ticket",
      "metric_not_computable:won_value",
      "metric_not_computable:lost_value",
    ]) {
      expect(severityOf(code), code).toBe("warning");
    }
  });

  it("definição e escopo permanentes são informativos", () => {
    for (const code of [
      "rd_marketing_scope",
      "no_joint_rate",
      "win_rate_scope",
      "pipelines_aggregated",
      "deal_state_snapshot",
      "coexistence_only",
      "no_origin_mapping",
      "attribution_not_supported",
      "populations_differ",
      "not_computed:cac",
      "not_computed:roas",
      "not_computed:ga4_to_rd_rate",
    ]) {
      expect(severityOf(code), code).toBe("info");
    }
  });

  it("código desconhecido cai em `warning` (o lado seguro) e NÃO conta como classificado", () => {
    expect(isClassified("codigo_novo_do_cross_source")).toBe(false);
    expect(severityOf("codigo_novo_do_cross_source")).toBe("warning");
    expect(isClassified("not_computed:qualquer_coisa")).toBe(true);
    expect(isClassified("metric_not_computable:qualquer_coisa")).toBe(true);
    // `constructor`, `toString`… nunca resolvem para algo herdado do Object
    expect(isClassified("constructor")).toBe(false);
    expect(severityOf("toString")).toBe("warning");
  });
});

describe("completude da tabela contra o Cross-source real", () => {
  it("todo código que o Cross-source EMITE (cenários reais) está classificado", () => {
    const codes = emittedCodes();
    expect(codes.size).toBeGreaterThan(20);
    for (const code of codes) expect(isClassified(code), `código sem classificação: ${code}`).toBe(true);
  });

  it("todo código ESCRITO no código-fonte do Cross-source está classificado (inclusive ramos que nenhum cenário alcança)", () => {
    const sources = ["coverage.ts", "integrity.ts", "commercial.ts"].map((f) => read(`server/analysis/cross-source/${f}`));
    const found = new Set<string>();
    for (const src of sources) {
      for (const m of src.matchAll(/\.limit\(\s*["'`]([A-Za-z0-9_:$.{}]+)["'`]/g)) {
        found.add(m[1]!.split("${")[0]!);
      }
    }
    expect(found.size).toBeGreaterThan(25);
    for (const code of found) expect(isClassified(code), `código sem classificação: ${code}`).toBe(true);
  });

  it("a tabela não tem entrada morta: todo código fixo dela existe no código do Cross-source", () => {
    const all = ["coverage.ts", "integrity.ts", "commercial.ts"].map((f) => read(`server/analysis/cross-source/${f}`)).join("\n");
    for (const code of Object.keys(LIMITATION_SEVERITY)) {
      expect(all.includes(`"${code}"`), `código na tabela mas ausente do Cross-source: ${code}`).toBe(true);
    }
  });
});

describe("ordenação por gravidade", () => {
  it("do mais ao menos grave, mantendo a ordem original dentro de cada gravidade", () => {
    const l = (code: string, severity: AdvisorLimitation["severity"]) => ({ code, severity });
    const sorted = bySeverity([l("i1", "info"), l("w1", "warning"), l("b1", "blocking"), l("i2", "info"), l("w2", "warning"), l("b2", "blocking")]);
    expect(sorted.map((x) => x.code)).toEqual(["b1", "b2", "w1", "w2", "i1", "i2"]);
  });
});

describe("limitações do próprio Advisor", () => {
  const period = { startDate: "2026-10-01", endDate: "2026-10-04", days: 4 };

  it("sempre com origem 'advisor', código estável e gravidade", () => {
    const all: AdvisorLimitation[] = [
      crossSourceNotGenerated(period),
      diagnosticsPeriodDiffers(period, [{ start: "2026-09-05", end: "2026-10-02" }]),
      evidenceConflict("ga4.sessions@2026-10-01..2026-10-04"),
      comparisonNotComputable("different_duration", "x", ["ga4"]),
      llmNotConnected(),
      modelOutputRejected("m", ["number_not_in_context", "number_not_in_context", "currency_assumed"]),
      modelFailed("m"),
    ];
    expect(all.every((l) => l.origin === "advisor")).toBe(true);
    expect(all.map((l) => [l.code, l.severity])).toEqual([
      ["cross_source_not_generated", "blocking"],
      ["diagnostics_period_differs", "warning"],
      ["evidence_conflict", "warning"],
      ["comparison_not_computable:different_duration", "blocking"],
      ["llm_not_connected", "info"],
      ["model_output_rejected", "warning"],
      ["model_failed", "warning"],
    ]);
  });

  it("as mensagens citam as datas e os motivos (sem repetir motivo)", () => {
    expect(crossSourceNotGenerated(period).message).toContain("01/10/2026 a 04/10/2026");
    const differs = diagnosticsPeriodDiffers(period, [
      { start: "2026-09-05", end: "2026-10-02" },
      { start: "2026-08-01", end: "2026-08-28" },
    ]);
    expect(differs.message).toContain("05/09/2026 a 02/10/2026; 01/08/2026 a 28/08/2026");
    expect(differs.message).toContain("01/10/2026 a 04/10/2026");
    expect(modelOutputRejected("m", ["a", "a", "b"]).message).toContain("(a, b)");
  });
});
