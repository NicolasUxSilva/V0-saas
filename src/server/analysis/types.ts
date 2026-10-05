/**
 * Tipos do motor de análise determinístico (bloco C).
 *
 * `AnalysisContext` é montado por `context.ts` a partir de `fact_traffic_daily`.
 * Todo o resto (`gates`, `contribution`, `detectors`, `scoring`, `templates`) é
 * função pura sobre este contexto — não toca no banco, é testável isolado.
 */

export type MetricFormat = "count" | "rate" | "currency";

export interface DayPoint {
  date: string; // "YYYY-MM-DD"
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  keyEvents: number;
  conversionValue: number;
}

export interface SegmentTotals {
  /** valor da dimensão, ex.: "Organic Search" ou "google / organic" */
  key: string;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  keyEvents: number;
  conversionValue: number;
}

export interface WindowAgg {
  start: string;
  end: string;
  /** dias configurados na janela */
  days: number;
  /**
   * dias da janela com sessões > 0 — é o que os gates e os detectors sempre usaram
   * (completude da janela) e não muda. NÃO é a cobertura por existência de linha:
   * um dia com linha e `sessions = 0` não conta aqui; a camada Cross-source usa
   * `AnalysisContext.coverage.inPeriod`, onde linha com zero conta como dado.
   */
  daysWithData: number;
  totals: {
    sessions: number;
    totalUsers: number;
    newUsers: number;
    engagedSessions: number;
    keyEvents: number;
    conversionValue: number;
  };
  byChannel: SegmentTotals[];
  bySourceMedium: SegmentTotals[];
}

/** Período EXPLÍCITO de uma análise: datas locais "YYYY-MM-DD", inclusivas nas duas pontas. */
export interface AnalysisPeriodInput {
  startDate: string;
  endDate: string;
}

/**
 * Cobertura REAL de uma fonte dentro do período solicitado: em quantos dias ela
 * tem dado e entre quais datas. É por EXISTÊNCIA DE LINHA: linha com valor 0 é um
 * dado válido (zero registrado) e conta; dia sem linha é dia SEM DADO, não conta e
 * nunca é preenchido com zero.
 */
export interface PeriodCoverage {
  daysWithData: number;
  /** primeiro/último dia COM dado dentro do período; `null` quando nenhum */
  firstDate: string | null;
  lastDate: string | null;
}

export interface AnalysisContext {
  workspaceId: string;
  propertyTimezone: string;
  /**
   * Período SOLICITADO desta análise — `{ start, end }` inclusivos. No modo padrão
   * é a janela `current` (28 dias até `analysisEnd`); com período explícito é
   * exatamente o pedido. NUNCA é encolhido por falta de dados de uma fonte: a
   * cobertura real de cada fonte vem em `coverage.inPeriod`, `rdMarketing.coverage`
   * e `rdCrm.coverage`.
   */
  period: { start: string; end: string };
  /**
   * Fim da janela `current` (= `period.end`). No modo padrão: hoje (fuso da
   * propriedade) − 2 dias, limitado ao último dia com dados do GA4. Com período
   * explícito: o `endDate` pedido, mesmo que o GA4 não tenha dados até lá.
   */
  analysisEnd: string;
  coverage: {
    firstDate: string | null;
    lastDate: string | null;
    distinctDates: number;
    /** janela histórica alvo em dias (180) */
    expectedDays: number;
    /**
     * Último dia com dados que o GA4 DEVERIA ter para esta análise. Modo padrão:
     * hoje (fuso da propriedade) − 2 dias — `analysisEnd` é o menor entre isto e
     * `lastDate`, então um GA4 parado encolhe a janela de TODAS as fontes sem que
     * isso apareça em nenhum outro campo. Período explícito: o `endDate` pedido.
     * `lastDate` anterior a este dia = GA4 atrasado. Só leitura — nenhum
     * gate/detector usa.
     */
    expectedLastDate: string;
    /**
     * cobertura REAL do GA4 dentro de `period`: dias COM LINHA e o 1º/último deles.
     * Linha com `sessions = 0` conta (zero registrado é dado); dia sem linha não.
     * NÃO é `current.daysWithData` — esse segue contando só dias com sessões > 0,
     * para os gates e detectors.
     */
    inPeriod: PeriodCoverage;
  };
  /** soma de key_events em todo o intervalo analisado (0 = sem dados de conversão) */
  totalKeyEvents: number;
  totalConversionValue: number;
  /** participação de (not set)/(direct) nas sessões da janela atual, 0..1 */
  notSetDirectSessionShare: number;
  /** há um dia com 0 sessões entre dias não-zerados (janela atual + anterior)? */
  zeroDayGap: boolean;
  /** série diária de sessões da janela do baseline (para z robusto) */
  baselineDailySessions: number[];
  /** série diária completa [baselineStart .. analysisEnd] */
  dailySeries: DayPoint[];
  /** sessões por (data, canal) na janela [previousStart .. analysisEnd] — onset por segmento */
  dailyByChannel: { date: string; channel: string; sessions: number }[];
  current: WindowAgg;
  previous: WindowAgg;
  baseline: WindowAgg;
  /**
   * Contexto de Google Ads (bloco G5) — `null` quando o workspace não tem
   * conexão Ads ou não há linhas de `fact_ad_performance_daily` na janela
   * `current`. Nunca um objeto com zeros: ausência é sempre `null` (não
   * confundir "sem dados" com "campanhas com 0 impressão").
   *
   * **Só disponibiliza dados — nenhum detector lê `ctx.ads` ainda.** Cruzar
   * `ads` com `current`/`previous`/`dailyByChannel` (atribuição, ROAS, CAC,
   * "campanha X explica a queda") é responsabilidade do G6, não deste campo.
   */
  ads: AdsContext | null;
  /**
   * Contexto de RD Station Marketing (bloco RD-1) — `null` quando o workspace
   * não tem conexão Marketing ou não há linhas de
   * `fact_conversion_assets_daily` na janela `current`. Mesmo princípio do
   * `ads`: ausência é sempre `null`, nunca um objeto zerado.
   *
   * **Só disponibiliza dados — nenhum *detector* lê `ctx.rdMarketing`.** Quem o
   * lê é a camada Cross-source V1 (`cross-source/`), pura e fora do engine.
   */
  rdMarketing: RdMarketingContext | null;
  /**
   * Contexto de RD Station CRM (bloco RD-1) — `null` quando o workspace não
   * tem conexão CRM ou nenhuma negociação em `fact_deals` toca a janela
   * `current` (por `deal_created_at` OU `deal_closed_at` — ver
   * `composeRdCrmContext`). Mesmo princípio acima.
   *
   * **Só disponibiliza dados — nenhum *detector* lê `ctx.rdCrm`.** Quem o lê é a
   * camada Cross-source V1 (`cross-source/`), pura e fora do engine.
   */
  rdCrm: RdCrmContext | null;
}

// ─────────────────────────────────────────────────────────────────────
// RD Station Marketing (RD-1 — composição do contexto; cross-source fica
// para um bloco futuro, mesmo padrão do Ads no G5/G6)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resumo de um ativo de conversão (landing page / formulário / pop-up) na
 * janela `current`, agregado a partir de `fact_conversion_assets_daily`.
 * `visits`/`conversions` são a SOMA dos dias da janela; `conversionRate` é a
 * MÉDIA dos dias em que a fonte reportou (não cumulativa); `assetIdentifier`/
 * `assetType` são o snapshot do dia mais recente do ativo dentro da janela.
 */
export interface RdMarketingAssetSummary {
  assetId: string;
  assetIdentifier: string;
  assetType: string;
  visits: number;
  conversions: number;
  /** 0..1, média dos dias com valor na janela; `null` quando nunca reportado — nunca 0 */
  conversionRate: number | null;
}

/**
 * Cobertura diária da PRÓPRIA fonte dentro de `window`: em quantos dias a fonte
 * respondeu (≥ 1 linha em `fact_conversion_assets_daily`). Não mede atividade —
 * a API devolve uma linha por ativo por dia mesmo com 0 visitas, e uma linha com
 * 0 visitas é um zero REAL; dia sem linha é dia sem dado.
 */
export type RdMarketingCoverage = PeriodCoverage;

/** Contexto de RD Station Marketing — ver `AnalysisContext.rdMarketing`. */
export interface RdMarketingContext {
  /** mesma janela de `AnalysisContext.current` — mesmo princípio do `AdsContext.window` */
  window: { start: string; end: string };
  totals: { visits: number; conversions: number };
  assetCount: number;
  assets: RdMarketingAssetSummary[];
  coverage: RdMarketingCoverage;
}

// ─────────────────────────────────────────────────────────────────────
// RD Station CRM (RD-1 — composição do contexto)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resumo de um funil de vendas (pipeline) na janela `current`, agregado a
 * partir de `fact_deals`. `fact_deals` é 1 linha por NEGOCIAÇÃO (não por dia —
 * ver `db/schema.ts`), então aqui a agregação bucketiza por qual data caiu na
 * janela: `created*` usa `deal_created_at`; `won*`/`lost*` usam
 * `deal_closed_at` + `status`. Uma negociação pode contribuir para `created`
 * e para `won`/`lost` ao mesmo tempo (aberta e fechada dentro da mesma janela)
 * ou só para um dos dois.
 */
export interface RdCrmPipelineSummary {
  pipelineId: string;
  createdCount: number;
  createdTotalPriceSum: number;
  wonCount: number;
  wonTotalPriceSum: number;
  lostCount: number;
}

/**
 * Preenchimento dos campos de ORIGEM de uma população de negociações (criadas
 * ou ganhas na janela). `fact_deals` guarda "ausente" como string vazia (`''`),
 * nunca `null` — aqui só conta como preenchido o valor não vazio.
 */
export interface RdCrmAttributionCoverage {
  /** negociações da população */
  total: number;
  /** com `source_id` preenchido */
  withSourceId: number;
  /** com `campaign_id` preenchido */
  withCampaignId: number;
  /** valores distintos de `source_id` (não vazios) dentro da população */
  distinctSourceIds: number;
}

/**
 * Detalhes de estado/valor das negociações da janela. Fica FORA de `totals` de
 * propósito: `totals`/`pipelines` mantêm exatamente o formato do RD-1 (nada que
 * os lê muda); isto é aditivo, para a camada Cross-source.
 */
export interface RdCrmDealDetail {
  /** criadas na janela e ainda `ongoing` na última sincronização (≠ estoque total em aberto) */
  createdOpenCount: number;
  /** ganhas na janela com `total_price > 0` */
  wonWithValueCount: number;
  /** perdidas na janela com `total_price > 0` */
  lostWithValueCount: number;
  /** soma de `total_price` das perdidas na janela */
  lostTotalPriceSum: number;
}

/**
 * Até onde vai o histórico de CRM que o SaaS tem IMPORTADO. `fact_deals` só tem os
 * negócios que o sync trouxe (os atualizados desde o início da 1ª sincronização
 * bem-sucedida): um período que começa antes disso tem contagens que são piso, não
 * total. Isto descreve o que está importado/disponível NO SaaS — não diz nada sobre
 * quando o CRM real começou a registrar negócios.
 */
export interface RdCrmCoverage {
  /**
   * Início do histórico de CRM atualmente importado para o SaaS — o menor
   * `period_start` entre as sincronizações bem-sucedidas do CRM. NÃO é o início do
   * histórico real do CRM (esse não é conhecido). `null` quando nenhuma sincronização
   * foi concluída: aí o contexto NÃO afirma que o histórico importado é completo nem
   * parcial.
   */
  importedHistoryStartDate: string | null;
}

/** Contexto de RD Station CRM — ver `AnalysisContext.rdCrm`. */
export interface RdCrmContext {
  window: { start: string; end: string };
  totals: {
    createdCount: number;
    createdTotalPriceSum: number;
    wonCount: number;
    wonTotalPriceSum: number;
    lostCount: number;
  };
  pipelineCount: number;
  pipelines: RdCrmPipelineSummary[];
  coverage: RdCrmCoverage;
  detail: RdCrmDealDetail;
  attribution: {
    /** negociações CRIADAS na janela (a coorte de aquisição) */
    created: RdCrmAttributionCoverage;
    /** negociações GANHAS na janela (as vendas que se queria atribuir) */
    won: RdCrmAttributionCoverage;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Ads (G5 — composição do contexto; cross-source fica para o G6)
// ─────────────────────────────────────────────────────────────────────

/**
 * Resumo de uma campanha na janela `current`, agregado a partir de
 * `fact_ad_performance_daily`. Métricas cumulativas (impressions/clicks/cost/
 * conversions/conversionValue) são a SOMA dos dias da janela; `status` e
 * `advertisingChannelType` são o snapshot do dia mais recente da campanha
 * dentro da janela (podem mudar dia a dia — ex.: campanha pausada no meio do
 * período); as 3 métricas de leilão são a MÉDIA dos dias em que a fonte
 * reportou valor (não são cumulativas — são compartilhamentos 0..1).
 */
export interface AdsCampaignSummary {
  campaignId: string;
  campaignName: string;
  /** snapshot do dia mais recente na janela, ex.: ENABLED/PAUSED/REMOVED */
  status: string;
  /** snapshot do dia mais recente; `null` se a fonte nunca reportou (vem de `dims`) */
  advertisingChannelType: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  /** 0..1, média dos dias com valor na janela; `null` quando nunca reportado — nunca 0 */
  impressionShare: number | null;
  budgetLostIs: number | null;
  rankLostIs: number | null;
}

/** Contexto de Google Ads — ver `AnalysisContext.ads`. */
export interface AdsContext {
  /** mesma janela de `AnalysisContext.current` (arquitetura V1 §6.5 — janela comum entre fontes) */
  window: { start: string; end: string };
  /** moeda da conta (ISO-4217); `null` se nenhuma linha reportou. Sem conversão cambial. */
  currency: string | null;
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    conversionValue: number;
  };
  campaignCount: number;
  campaigns: AdsCampaignSummary[];
}

// ─────────────────────────────────────────────────────────────────────
// Saída dos detectores
// ─────────────────────────────────────────────────────────────────────

export type InsightKind = "problem" | "opportunity" | "data_quality";
export type InsightSeverity = "critical" | "attention";
export type InsightConfidence = "alta" | "media";

export interface EvidenceBreakdownRow {
  label: string;
  /** participação na variação, 0..1 */
  contributionPct: number;
  detail: string | null;
}

/**
 * Evidência complementar de OUTRA fonte (bloco G6) anexada a um insight já
 * emitido por um detector de GA4. Não é o fato primário — é contexto: "no mesmo
 * período, a outra fonte registrou isto". Nunca afirma causalidade nem
 * atribuição. Só métricas ABSOLUTAS da janela atual (sem variação percentual do
 * lado Ads — não há janela anterior de Ads no `AdsContext`).
 */
export interface CrossSourceEvidence {
  source: "google_ads";
  /** só `same_period` hoje: a janela da fonte coincide exatamente com a do insight */
  relationship: "same_period";
  title: string;
  detail: string;
  /** somas/média sobre as campanhas compatíveis com o canal do insight */
  metrics: {
    campaignCount: number;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    conversionValue: number;
    /** média 0..1 das campanhas que reportaram; `null` se nenhuma reportou */
    impressionShare: number | null;
  };
  /** moeda da conta (ISO-4217) — o `cost` acima está nela; sem conversão cambial */
  currency: string | null;
}

export interface InsightEvidence {
  metricLabel: string;
  current: number;
  previous: number;
  baseline: number | null;
  deltaPct: number;
  format: MetricFormat;
  test: string | null;
  breakdown: EvidenceBreakdownRow[];
  /**
   * Evidência complementar de outras fontes (G6). Ausente = nenhum enriquecimento
   * (comportamento idêntico ao anterior). Opcional de propósito: nenhum detector
   * preenche isto — só `enrichWithAds` (enrichment.ts), depois dos detectores.
   */
  supportingEvidence?: CrossSourceEvidence[];
}

export interface InsightImpact {
  value: number;
  unit: "conversions" | "sessions" | "BRL";
  basis: string;
  isEstimate: boolean;
}

export interface ResponsibleDimension {
  name: string;
  value: string;
  share: number;
}

export interface DetectorInsight {
  detector: string;
  type: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  impact: InsightImpact | null;
  explanation: string;
  hypothesis: string;
  evidence: InsightEvidence;
  periodStart: string;
  periodEnd: string;
  comparedTo: string;
  responsibleDimension: ResponsibleDimension | null;
  confidence: InsightConfidence;
  confidenceBasis: string;
  recommendedAction: string;
  /** preenchido por `scoring.ts` */
  priorityScore: number;
  dedupeKey: string;
  gateTrace: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

/** Famílias de detector que um gate pode suprimir. */
export type SuppressFamily = "traffic" | "conversion" | "attribution";

export interface GateReport {
  /** G0: há histórico e janelas comparáveis suficientes? */
  hasComparableWindows: boolean;
  suppress: Set<SuppressFamily>;
  /** insights de data_quality já derivados dos gates (o detector data-quality os repassa) */
  dataQualityInsights: DetectorInsight[];
  /** medições dos gates, anexadas a cada insight para auditoria */
  trace: {
    coverageDistinctDates: number;
    currentDaysWithData: number;
    previousDaysWithData: number;
    totalKeyEvents: number;
    notSetDirectShare: number;
    zeroDayGap: boolean;
  };
}
