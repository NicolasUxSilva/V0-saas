/**
 * Extração de fatos do `AnalysisContext` para a camada Cross-source.
 *
 * Lê o contexto UMA vez e entrega às análises os números já derivados (razões,
 * "calculável ou não", alinhamento de períodos). Regras que valem aqui:
 *  - nada é inventado: toda razão sai de dois campos do contexto, e é `null`
 *    (nunca 0, nunca NaN/Infinity) quando o denominador é 0 ou a base é inválida;
 *  - nada depende do relógio: datas só entram como texto vindo do contexto;
 *  - zero ≠ ausência: linha existente com valor 0 é dado válido; só a falta de linha
 *    é ausência de dado — e ausência nunca vira zero nem é tratada como atraso;
 *  - período SOLICITADO ≠ cobertura REAL: `referencePeriod` é o pedido
 *    (`ctx.period`) e cada fonte traz o período que ela de fato cobre
 *    (`covered`). Duas fontes só são comparáveis "no mesmo período" quando as duas
 *    cobrem exatamente o período solicitado — ausência de dado nunca vira zero.
 */
import { inclusiveDays } from "../period";
import type { AnalysisContext, RdCrmAttributionCoverage, RdCrmContext } from "../types";
import type { CrossSourcePeriod, CrossSourceSource } from "./types";

const MS_PER_DAY = 86_400_000;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** `part / whole`, ou `null` quando `whole` não é positivo (nunca divide por zero). */
const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? round4(part / whole) : null;

/** Dias de `from` até `to` (negativo se `to` for anterior). 0 se alguma data for inválida. */
function daysBetween(from: string, to: string): number {
  const diff = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.round(diff / MS_PER_DAY) : 0;
}

/**
 * Por que o GA4 está atrasado (`lagDays > 0`):
 *  - `window_clamped`      — o fim da janela foi ENCOLHIDO até o último dia do GA4
 *    (modo padrão): as outras fontes ficam com a mesma janela curta;
 *  - `period_not_covered`  — o período pedido vai além do último dia do GA4
 *    (período explícito): a janela é a pedida, o GA4 é que cobre só parte dela.
 */
export type Ga4LagKind = "window_clamped" | "period_not_covered";

export interface Ga4Facts {
  /** período solicitado (`ctx.period`) — a referência contra a qual as outras fontes são comparadas */
  window: CrossSourcePeriod;
  windowDays: number;
  /** dias do período COM LINHA no GA4 — linha com 0 sessões conta (zero registrado é dado) */
  daysWithData: number;
  /** período efetivamente coberto: do 1º ao último dia COM LINHA; `null` sem nenhum */
  covered: CrossSourcePeriod | null;
  /**
   * o GA4 tem ao menos uma linha no período. Independe do valor: 0 sessões numa linha
   * existente é dado válido ("o GA4 registrou 0"); só a AUSÊNCIA de linha é ausência
   * de dado. Atraso, período parcial e períodos não equivalentes saem daqui — nunca
   * de a métrica ser zero.
   */
  hasData: boolean;
  /** soma das sessões do período — só significa "zero sessões" quando `hasData` */
  sessions: number;
  keyEvents: number;
  history: { firstDate: string | null; lastDate: string | null; distinctDates: number };
  expectedLastDate: string;
  /** dias de atraso do GA4 em relação ao último dia esperado; 0 = em dia */
  lagDays: number;
  lagKind: Ga4LagKind | null;
}

export interface RdMarketingFacts {
  window: CrossSourcePeriod;
  windowDays: number;
  /** dias com ≥ 1 linha da própria fonte dentro da janela (não mede atividade) */
  daysWithData: number;
  firstDate: string | null;
  lastDate: string | null;
  /** período efetivamente coberto (1º ao último dia com linha); `null` sem datas conhecidas */
  covered: CrossSourcePeriod | null;
  visits: number;
  conversions: number;
  assetCount: number;
  /** tipos de ativo distintos, não vazios, em ordem alfabética */
  assetTypes: string[];
}

export interface AttributionFacts extends RdCrmAttributionCoverage {
  /** `withSourceId / total`; `null` quando a população é vazia */
  sourceCoverage: number | null;
  campaignCoverage: number | null;
}

export interface RdCrmFacts {
  window: CrossSourcePeriod;
  windowDays: number;
  /**
   * início do histórico de CRM atualmente importado/disponível no SaaS; `null` =
   * desconhecido (nenhuma sincronização concluída). NÃO é o início do histórico real
   * do CRM, que não é conhecido.
   */
  importedHistoryStartDate: string | null;
  /** o histórico importado começa DEPOIS do início do período: as contagens são piso */
  partialImportedHistory: boolean;
  /** período efetivamente coberto pelo histórico importado */
  covered: CrossSourcePeriod;
  created: number;
  won: number;
  lost: number;
  /** ganhos + perdidos (fechados na janela) */
  closed: number;
  /** criados na janela e ainda abertos na última sincronização */
  createdOpen: number;
  wonValue: number;
  wonWithValue: number;
  lostValue: number;
  lostWithValue: number;
  pipelineCount: number;
  /** ganhos ÷ (ganhos + perdidos); `null` sem nenhum negócio fechado. Abertos ficam FORA. */
  winRate: number | null;
  /** valor ganho ÷ nº de ganhos COM valor; `null` sem ganho com valor positivo */
  averageTicket: number | null;
  /** criados + ganhos + perdidos > 0 */
  hasActivity: boolean;
  attribution: { created: AttributionFacts; won: AttributionFacts };
}

export interface SourceFacts {
  /** período SOLICITADO (`ctx.period`) */
  referencePeriod: CrossSourcePeriod;
  ga4: Ga4Facts;
  rdMarketing: RdMarketingFacts | null;
  rdCrm: RdCrmFacts | null;
  /** fontes com dados no período, em ordem fixa (ga4, rd_marketing, rd_crm) */
  availableSources: CrossSourceSource[];
  /**
   * Fonte com dados cuja janela E cobertura efetiva são exatamente o período
   * solicitado. Só entre duas fontes `aligned` vale a frase "no mesmo período".
   */
  aligned: Record<CrossSourceSource, boolean>;
  /** fontes COM dados que não estão alinhadas (janela diferente OU cobertura parcial nas pontas) */
  mismatchedSources: CrossSourceSource[];
  /** `true` quando toda fonte com dados está alinhada ao período solicitado */
  windowsEquivalent: boolean;
}

const samePeriod = (a: CrossSourcePeriod, b: CrossSourcePeriod): boolean =>
  a.start === b.start && a.end === b.end;

const bothDates = (first: string | null, last: string | null): CrossSourcePeriod | null =>
  first && last ? { start: first, end: last } : null;

function attributionFacts(a: RdCrmAttributionCoverage): AttributionFacts {
  return {
    ...a,
    sourceCoverage: ratio(a.withSourceId, a.total),
    campaignCoverage: ratio(a.withCampaignId, a.total),
  };
}

function crmFacts(c: RdCrmContext): RdCrmFacts {
  const { createdCount, wonCount, lostCount, wonTotalPriceSum } = c.totals;
  const closed = wonCount + lostCount;
  const wonWithValue = c.detail.wonWithValueCount;
  const window = { start: c.window.start, end: c.window.end };

  const importedHistoryStartDate = c.coverage.importedHistoryStartDate;
  const partialImportedHistory =
    importedHistoryStartDate !== null && importedHistoryStartDate > window.start;
  // histórico importado que começa depois do FIM do período não cobre nada dele: ancora no fim
  const coveredStart = partialImportedHistory
    ? importedHistoryStartDate > window.end
      ? window.end
      : importedHistoryStartDate
    : window.start;

  return {
    window,
    windowDays: inclusiveDays(window.start, window.end),
    importedHistoryStartDate,
    partialImportedHistory,
    covered: { start: coveredStart, end: window.end },
    created: createdCount,
    won: wonCount,
    lost: lostCount,
    closed,
    createdOpen: c.detail.createdOpenCount,
    wonValue: wonTotalPriceSum,
    wonWithValue,
    lostValue: c.detail.lostTotalPriceSum,
    lostWithValue: c.detail.lostWithValueCount,
    pipelineCount: c.pipelineCount,
    winRate: ratio(wonCount, closed),
    // Só é média de ticket se há ganho COM valor positivo e a soma é positiva.
    averageTicket:
      wonWithValue > 0 && wonTotalPriceSum > 0
        ? round4(wonTotalPriceSum / wonWithValue)
        : null,
    hasActivity: createdCount + wonCount + lostCount > 0,
    attribution: {
      created: attributionFacts(c.attribution.created),
      won: attributionFacts(c.attribution.won),
    },
  };
}

export function extractSourceFacts(ctx: AnalysisContext): SourceFacts {
  const referencePeriod: CrossSourcePeriod = {
    start: ctx.period.start,
    end: ctx.period.end,
  };

  const { inPeriod } = ctx.coverage;
  const lastDate = ctx.coverage.lastDate;
  const lagDays = lastDate
    ? Math.max(0, daysBetween(lastDate, ctx.coverage.expectedLastDate))
    : 0;
  const ga4: Ga4Facts = {
    window: referencePeriod,
    windowDays: inclusiveDays(referencePeriod.start, referencePeriod.end),
    daysWithData: inPeriod.daysWithData,
    covered: bothDates(inPeriod.firstDate, inPeriod.lastDate),
    hasData: inPeriod.daysWithData > 0,
    sessions: ctx.current.totals.sessions,
    keyEvents: ctx.current.totals.keyEvents,
    history: {
      firstDate: ctx.coverage.firstDate,
      lastDate,
      distinctDates: ctx.coverage.distinctDates,
    },
    expectedLastDate: ctx.coverage.expectedLastDate,
    lagDays,
    lagKind:
      lagDays === 0 || !lastDate
        ? null
        : referencePeriod.end <= lastDate
          ? "window_clamped"
          : "period_not_covered",
  };

  const m = ctx.rdMarketing;
  const rdMarketing: RdMarketingFacts | null = m
    ? {
        window: { start: m.window.start, end: m.window.end },
        windowDays: inclusiveDays(m.window.start, m.window.end),
        daysWithData: m.coverage.daysWithData,
        firstDate: m.coverage.firstDate,
        lastDate: m.coverage.lastDate,
        covered: bothDates(m.coverage.firstDate, m.coverage.lastDate),
        visits: m.totals.visits,
        conversions: m.totals.conversions,
        assetCount: m.assetCount,
        assetTypes: [
          ...new Set(
            m.assets.map((a) => a.assetType).filter((t) => t.trim() !== ""),
          ),
        ].sort(),
      }
    : null;

  const rdCrm = ctx.rdCrm ? crmFacts(ctx.rdCrm) : null;

  const present: Record<CrossSourceSource, boolean> = {
    ga4: ga4.hasData,
    rd_marketing: rdMarketing !== null,
    rd_crm: rdCrm !== null,
  };

  // Alinhada = a janela da fonte E o que ela de fato cobre são o período solicitado.
  // Cobertura desconhecida (`covered` nulo) não conta como alinhada — não se presume.
  const aligned: Record<CrossSourceSource, boolean> = {
    ga4: present.ga4 && ga4.covered !== null && samePeriod(ga4.covered, referencePeriod),
    rd_marketing:
      rdMarketing !== null &&
      samePeriod(rdMarketing.window, referencePeriod) &&
      rdMarketing.covered !== null &&
      samePeriod(rdMarketing.covered, referencePeriod),
    rd_crm:
      rdCrm !== null &&
      samePeriod(rdCrm.window, referencePeriod) &&
      !rdCrm.partialImportedHistory,
  };

  const order: CrossSourceSource[] = ["ga4", "rd_marketing", "rd_crm"];
  const availableSources = order.filter((s) => present[s]);
  const mismatchedSources = order.filter((s) => present[s] && !aligned[s]);

  return {
    referencePeriod,
    ga4,
    rdMarketing,
    rdCrm,
    availableSources,
    aligned,
    mismatchedSources,
    windowsEquivalent: mismatchedSources.length === 0,
  };
}
