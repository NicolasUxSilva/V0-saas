/**
 * Fixtures do Advisor.
 *
 * Nada aqui é um Cross-source escrito à mão: os conjuntos são produzidos pelo
 * construtor REAL (`buildCrossSourceInsights`), persistidos e relidos pelo store em
 * memória que imita o jsonb — exatamente o caminho que `getCrossSourceInsights`
 * faz no Postgres. Assim os testes do Advisor exercitam o shape de verdade.
 */
import {
  OCT,
  deal,
  lost,
  makeRdCrm,
  makeRdMarketing,
  octoberCrmRows,
  periodContext,
  won,
} from "@/server/analysis/__tests__/cross-source-fixtures";
import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";
import { generateCrossSourceInsights, getCrossSourceInsights } from "@/server/analysis/cross-source-store";
import type { AnalysisContext, RdCrmContext, RdMarketingContext } from "@/server/analysis/types";

import type { AdvisorServiceDeps } from "../service";
import type { AdvisorDiagnosticItem, AdvisorPeriodInput } from "../types";

export { OCT, deal, lost, makeRdCrm, makeRdMarketing, octoberCrmRows, periodContext, won };

export const WS = "ws-advisor-test";
/** instante em que o Cross-source foi gerado */
export const GENERATED_AT = new Date("2026-10-04T20:10:55.505Z");
/** instante em que o contexto do Advisor é montado */
export const NOW = new Date("2026-10-04T21:00:00.000Z");

export const OCT_PERIOD: AdvisorPeriodInput = { startDate: OCT.start, endDate: OCT.end };
/** o período de 4 dias imediatamente anterior ao de outubro */
export const SEP = { start: "2026-09-27", end: "2026-09-30" };
export const SEP_PERIOD: AdvisorPeriodInput = { startDate: SEP.start, endDate: SEP.end };

/** 487 sessões em 4 dias — a mesma soma do fechamento parcial real. */
export const OCT_GA4_ROWS = [
  { date: "2026-10-01", sessions: 120 },
  { date: "2026-10-02", sessions: 130 },
  { date: "2026-10-03", sessions: 117 },
  { date: "2026-10-04", sessions: 120 },
];

/** 2 landing pages, 6 visitas, 0 conversões, nos 4 dias do período. */
export function octoberRdMarketing(window = OCT): RdMarketingContext {
  return makeRdMarketing(
    [
      { assetId: "a1", assetIdentifier: "lp-exemplo", assetType: "LandingPage", visits: 6, conversions: 0 },
      { assetId: "a2", assetIdentifier: "lp-confirmacao-exemplo", assetType: "LandingPage", visits: 0, conversions: 0 },
    ],
    { window, days: 4 },
  );
}

/** O fechamento parcial de outubro em miniatura (o mesmo do Cross-source: 9 criados, 5 ganhos, 14 perdidos). */
export function octoberContext(
  over: {
    ga4Rows?: { date: string; sessions: number }[];
    ga4Days?: string[];
    rdMarketing?: RdMarketingContext | null;
    rdCrm?: RdCrmContext | null;
  } = {},
): AnalysisContext {
  return periodContext({
    period: OCT,
    ...("ga4Days" in over ? { ga4Days: over.ga4Days } : { ga4Rows: over.ga4Rows ?? OCT_GA4_ROWS }),
    rdMarketing: "rdMarketing" in over ? (over.rdMarketing ?? null) : octoberRdMarketing(),
    rdCrm: "rdCrm" in over ? (over.rdCrm ?? null) : makeRdCrm(octoberCrmRows(), OCT, "2026-04-07"),
  });
}

/** Um período-base de 4 dias (27–30/09) com números próprios, para os testes de comparação. */
export function septemberContext(
  over: {
    sessions?: number[];
    visits?: number;
    crmRows?: ReturnType<typeof octoberCrmRows>;
    importedHistoryStartDate?: string | null;
  } = {},
): AnalysisContext {
  const sessions = over.sessions ?? [100, 110, 95, 105];
  const dates = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
  return periodContext({
    period: SEP,
    ga4Rows: dates.map((date, i) => ({ date, sessions: sessions[i] ?? 0 })),
    rdMarketing: makeRdMarketing(
      [{ assetId: "a1", assetIdentifier: "lp-exemplo", assetType: "LandingPage", visits: over.visits ?? 4, conversions: 0 }],
      { window: SEP, days: 4 },
    ),
    rdCrm: makeRdCrm(
      over.crmRows ?? [
        ...Array.from({ length: 6 }, () => deal({ dealCreatedAt: "2026-09-28", sourceId: "src-1" })),
        won({ dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" }),
        won({ dealClosedAt: "2026-09-30", dealCreatedAt: "2026-08-01" }),
        ...Array.from({ length: 7 }, () => lost({ dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" })),
      ],
      SEP,
      "importedHistoryStartDate" in over ? (over.importedHistoryStartDate ?? null) : "2026-04-07",
    ),
  });
}

/** Persiste o Cross-source de um contexto no store em memória (como `generateCrossSourceInsights` faz no banco). */
export async function persist(
  ctx: AnalysisContext,
  period: AdvisorPeriodInput,
  memory = createMemoryStore(),
  workspaceId = WS,
) {
  await generateCrossSourceInsights(workspaceId, period, {
    store: memory.store,
    buildContext: async () => ctx,
    now: () => GENERATED_AT,
  });
  return memory;
}

/** As fontes de dados do Advisor apontando para o store em memória e para um diagnóstico dado. */
export function sourcesFrom(
  memory: ReturnType<typeof createMemoryStore>,
  diagnostics: AdvisorDiagnosticItem[] = [],
): AdvisorServiceDeps {
  return {
    readCrossSource: (workspaceId, period) =>
      getCrossSourceInsights(workspaceId, period, { store: memory.store }),
    readDiagnostics: async () => diagnostics,
    now: () => NOW,
  };
}

/** O insight que o motor tem hoje no piloto: `data-quality:no_key_events` na janela de 28 dias. */
export function diagnosticItem(over: Partial<AdvisorDiagnosticItem> = {}): AdvisorDiagnosticItem {
  return {
    dedupeKey: "data-quality:no_key_events",
    detector: "data-quality",
    kind: "data_quality",
    severity: "attention",
    status: "open",
    title: "Sem dados de conversão (nenhum key event no período)",
    explanation:
      "A métrica de key events retornou 0 em todo o intervalo analisado, e a receita também. Isso é tratado como ausência de dados de conversão — não como falha de sincronização.",
    hypothesis:
      "A propriedade não tem eventos marcados como key event, ou eles não registraram ocorrências no período.",
    recommendedAction:
      "Para diagnósticos de eficiência de conversão e ROI, marcar os eventos-chave no GA4 (Admin → Eventos). Enquanto isso, o diagnóstico se limita a volume e qualidade de tráfego.",
    confidence: "alta",
    confidenceBasis: "Contagem de key events zerada em todo o intervalo.",
    impact: null,
    evidence: {
      metricLabel: "Key events",
      current: 0,
      previous: 0,
      baseline: null,
      deltaPct: 0,
      format: "count",
      test: null,
      breakdown: [],
    },
    period: { start: "2026-09-05", end: "2026-10-02" },
    comparedTo: "28 dias anteriores",
    priorityScore: 70,
    ...over,
  };
}

/** Um insight de problema com variação (o formato do `traffic-volume-drop`). */
export function trafficDropItem(over: Partial<AdvisorDiagnosticItem> = {}): AdvisorDiagnosticItem {
  return diagnosticItem({
    dedupeKey: "traffic-volume-drop:Paid Search",
    detector: "traffic-volume-drop",
    kind: "problem",
    severity: "critical",
    title: "Sessões de Paid Search caíram ~16%",
    explanation: "As sessões de Paid Search recuaram 15,9% contra os 28 dias anteriores.",
    hypothesis: "Pode haver mudança de investimento ou de campanha em Paid Search.",
    recommendedAction: "Revisar as campanhas de Paid Search.",
    evidence: {
      metricLabel: "Sessões de Paid Search",
      current: 1200,
      previous: 1427,
      baseline: 1390,
      deltaPct: -0.159,
      format: "count",
      test: "z robusto −4,3",
      breakdown: [],
    },
    priorityScore: 66.1,
    ...over,
  });
}
