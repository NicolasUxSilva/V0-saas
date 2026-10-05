/**
 * Gates de confiabilidade (bloco C1). Rodam ANTES dos detectores analíticos.
 *
 * G0 — disponibilidade: há histórico e janelas comparáveis?
 * G4 — qualidade de dados (veto): (not set)/(direct) alto, buraco de coleta,
 *      ausência de key events. Cada falha vira um insight `data_quality` e
 *      suprime a família de detector dependente.
 *
 * (G1 volume mínimo, G2 significância, G3 materialidade são aplicados dentro de
 *  cada detector, com as medições anexadas ao insight.)
 */
import type {
  AnalysisContext,
  DetectorInsight,
  GateReport,
  SuppressFamily,
} from "./types";

const MIN_COVERAGE_DAYS = 150;
const MIN_WINDOW_DAYS_WITH_DATA = 26; // de 28
const NOT_SET_DIRECT_MAX_SHARE = 0.4;

function dataQualityInsight(params: {
  type: string;
  title: string;
  explanation: string;
  hypothesis: string;
  recommendedAction: string;
  ctx: AnalysisContext;
  evidence?: Partial<DetectorInsight["evidence"]>;
}): DetectorInsight {
  const { ctx } = params;
  return {
    detector: "data-quality",
    type: params.type,
    kind: "data_quality",
    severity: "attention",
    title: params.title,
    impact: null,
    explanation: params.explanation,
    hypothesis: params.hypothesis,
    evidence: {
      metricLabel: params.evidence?.metricLabel ?? "Qualidade dos dados",
      current: params.evidence?.current ?? 0,
      previous: params.evidence?.previous ?? 0,
      baseline: params.evidence?.baseline ?? null,
      deltaPct: params.evidence?.deltaPct ?? 0,
      format: params.evidence?.format ?? "count",
      test: params.evidence?.test ?? null,
      breakdown: params.evidence?.breakdown ?? [],
    },
    periodStart: ctx.current.start,
    periodEnd: ctx.current.end,
    comparedTo: "28 dias anteriores",
    responsibleDimension: null,
    confidence: "alta",
    confidenceBasis: `${ctx.coverage.distinctDates} dias com dados no intervalo`,
    recommendedAction: params.recommendedAction,
    priorityScore: 0,
    dedupeKey: `data-quality:${params.type}`,
    gateTrace: {},
  };
}

export function evaluateGates(ctx: AnalysisContext): GateReport {
  const suppress = new Set<SuppressFamily>();
  const dataQualityInsights: DetectorInsight[] = [];

  const trace = {
    coverageDistinctDates: ctx.coverage.distinctDates,
    currentDaysWithData: ctx.current.daysWithData,
    previousDaysWithData: ctx.previous.daysWithData,
    totalKeyEvents: ctx.totalKeyEvents,
    notSetDirectShare: ctx.notSetDirectSessionShare,
    zeroDayGap: ctx.zeroDayGap,
  };

  // ── G0 — disponibilidade ────────────────────────────────────────
  const hasComparableWindows =
    ctx.coverage.distinctDates >= MIN_COVERAGE_DAYS &&
    ctx.current.daysWithData >= MIN_WINDOW_DAYS_WITH_DATA &&
    ctx.previous.daysWithData >= MIN_WINDOW_DAYS_WITH_DATA;

  if (!hasComparableWindows) {
    suppress.add("traffic");
    suppress.add("conversion");
    suppress.add("attribution");
    dataQualityInsights.push(
      dataQualityInsight({
        type: "insufficient_history",
        title: "Histórico insuficiente para diagnóstico comparativo",
        explanation: `Há dados em ${ctx.coverage.distinctDates} dias (mínimo ${MIN_COVERAGE_DAYS}); janela atual com ${ctx.current.daysWithData}/28 dias e anterior com ${ctx.previous.daysWithData}/28. Sem base comparável, o motor não emite diagnósticos de tendência.`,
        hypothesis:
          "A propriedade tem pouco histórico coletado, ou houve interrupções de coleta no período.",
        recommendedAction:
          "Aguardar acumular mais histórico e/ou verificar a coleta do GA4 nos períodos sem dados.",
        ctx,
        evidence: {
          metricLabel: "Dias com dados",
          current: ctx.coverage.distinctDates,
          previous: ctx.coverage.expectedDays,
        },
      }),
    );
    return { hasComparableWindows, suppress, dataQualityInsights, trace };
  }

  // ── G4 — ausência de dados de conversão (não é erro de sync) ─────
  if (ctx.totalKeyEvents === 0) {
    suppress.add("conversion");
    dataQualityInsights.push(
      dataQualityInsight({
        type: "no_key_events",
        title: "Sem dados de conversão (nenhum key event no período)",
        explanation: `A métrica de key events retornou 0 em todo o intervalo analisado, e a receita também. Isso é tratado como ausência de dados de conversão — não como falha de sincronização.`,
        hypothesis:
          "A propriedade não tem eventos marcados como key event, ou eles não registraram ocorrências no período.",
        recommendedAction:
          "Para diagnósticos de eficiência de conversão e ROI, marcar os eventos-chave no GA4 (Admin → Eventos). Enquanto isso, o diagnóstico se limita a volume e qualidade de tráfego.",
        ctx,
        evidence: {
          metricLabel: "Key events",
          current: 0,
          previous: 0,
          test: `Nenhum key event e receita zero em ${ctx.coverage.distinctDates} dias de dados (janela atual, anterior e baseline de ~120 dias). Por isso a família de detectores de conversão (eficiência de conversão, ROI) está suprimida nesta análise — só entram diagnósticos de volume e qualidade de tráfego.`,
        },
      }),
    );
  }

  // ── G4 — atribuição pouco confiável ─────────────────────────────
  if (ctx.notSetDirectSessionShare > NOT_SET_DIRECT_MAX_SHARE) {
    suppress.add("attribution");
    const pct = Math.round(ctx.notSetDirectSessionShare * 100);
    dataQualityInsights.push(
      dataQualityInsight({
        type: "high_not_set_share",
        title: `${pct}% das sessões estão sem origem definida`,
        explanation: `Na janela atual, ${pct}% das sessões caem em (not set) / (direct). Acima de ${Math.round(
          NOT_SET_DIRECT_MAX_SHARE * 100,
        )}%, a atribuição por canal/origem fica pouco confiável.`,
        hypothesis:
          "Provável ausência de UTMs em campanhas e/ou configuração de referral exclusions incompleta no GA4.",
        recommendedAction:
          "Padronizar UTMs nas campanhas e revisar as referral exclusions. Insights que dependem de canal ficam suprimidos ou com confiança reduzida enquanto isso.",
        ctx,
        evidence: {
          metricLabel: "Sessões sem origem (janela atual)",
          current: Math.round(
            ctx.current.totals.sessions * ctx.notSetDirectSessionShare,
          ),
          previous: 0,
          format: "count",
        },
      }),
    );
  }

  // ── G4 — buraco de coleta ──────────────────────────────────────
  if (ctx.zeroDayGap) {
    dataQualityInsights.push(
      dataQualityInsight({
        type: "collection_gap",
        title: "Possível falha de coleta em algum dia do período",
        explanation:
          "Há pelo menos um dia com 0 sessões cercado por dias com tráfego normal, o que costuma indicar tag ausente naquele dia.",
        hypothesis:
          "Interrupção pontual da tag do GA4 (deploy, GTM, bloqueio) em um ou mais dias.",
        recommendedAction:
          "Verificar a coleta nos dias zerados. Diagnósticos de tendência que cruzam esses dias podem estar distorcidos.",
        ctx,
        evidence: {
          metricLabel: "Coleta diária",
          current: 0,
          previous: 0,
          test: "Pelo menos um dia com 0 sessões entre dias de tráfego normal na janela analisada (atual + anterior). Diagnósticos de tendência que cruzam esse(s) dia(s) podem estar distorcidos.",
        },
      }),
    );
  }

  return { hasComparableWindows, suppress, dataQualityInsights, trace };
}
