/**
 * Monta o `AnalysisContext` a partir de `fact_traffic_daily` (bloco C2) +,
 * desde o bloco G5, `fact_ad_performance_daily` (`ctx.ads`) +, desde o bloco
 * RD-1, `fact_conversion_assets_daily` (`ctx.rdMarketing`) e `fact_deals`
 * (`ctx.rdCrm`). É a única parte do motor que toca no banco (INV-2).
 *
 * Duas camadas dentro deste arquivo:
 *  - `buildAnalysisContext` — só LÊ: resolve as janelas (ver `./period`), roda as
 *    consultas e entrega os dados crus;
 *  - `assembleAnalysisContext` — PURA: transforma esses dados crus no contexto
 *    (janelas, totais, cobertura). É o que os testes exercitam sem banco.
 *
 * Janelas GA4: atual 28d (terminando em D−2 no fuso da propriedade) · anterior
 * 28d · baseline ~120d — **inalteradas** no modo padrão. Com um período explícito
 * (`buildAnalysisContext(workspaceId, { startDate, endDate })`) a janela `current`
 * é exatamente o período pedido, e `previous`/`baseline` são derivadas dela (mesmo
 * tamanho, imediatamente antes / 120 dias antes); só a camada Cross-source usa um
 * contexto assim — os detectors rodam sempre sobre o contexto padrão.
 *
 * `ctx.ads`/`ctx.rdMarketing`/`ctx.rdCrm` reusam a mesma janela `current`
 * (mesmo `analysisEnd`) para já virem alinhados com o tráfego, sem calcular
 * nenhuma relação entre as fontes — a relação entre elas é feita pela camada
 * `cross-source/` (pura, só lê este contexto), nunca aqui. Os três são `null`
 * quando a fonte não está conectada ou sem linhas no período; nenhum *detector*
 * lê nenhum desses campos.
 */
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { addDays, todayInTimeZone } from "@/lib/dates";
import { db } from "@/server/db";
import {
  connectionProperties,
  connections,
  factAdPerformanceDaily,
  factConversionAssetsDaily,
  factDeals,
  factTrafficDaily,
  syncRuns,
} from "@/server/db/schema";

import {
  BASELINE_DAYS,
  CUTOFF_LAG_DAYS,
  HISTORY_DAYS,
  resolveWindowPlan,
  validateAnalysisPeriod,
  type WindowPlan,
} from "./period";
import type {
  AdsCampaignSummary,
  AdsContext,
  AnalysisContext,
  AnalysisPeriodInput,
  DayPoint,
  RdCrmAttributionCoverage,
  RdCrmContext,
  RdCrmPipelineSummary,
  RdMarketingAssetSummary,
  RdMarketingContext,
  SegmentTotals,
  WindowAgg,
} from "./types";

const num = (col: SQLWrapper) => sql<number>`coalesce(sum(${col}), 0)::float8`;

function emptyTotals(): WindowAgg["totals"] {
  return {
    sessions: 0,
    totalUsers: 0,
    newUsers: 0,
    engagedSessions: 0,
    keyEvents: 0,
    conversionValue: 0,
  };
}

function sumDays(days: DayPoint[]): WindowAgg["totals"] {
  return days.reduce((acc, d) => {
    acc.sessions += d.sessions;
    acc.totalUsers += d.totalUsers;
    acc.newUsers += d.newUsers;
    acc.engagedSessions += d.engagedSessions;
    acc.keyEvents += d.keyEvents;
    acc.conversionValue += d.conversionValue;
    return acc;
  }, emptyTotals());
}

function isDirectOrNotSet(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("(not set)") ||
    k === "(direct) / (none)" ||
    k === "(direct) / (not set)"
  );
}

// ─────────────────────────────────────────────────────────────────────
// Montagem PURA do contexto
// ─────────────────────────────────────────────────────────────────────

/** O que `buildAnalysisContext` LÊ do banco para o tráfego GA4 — a entrada da montagem. */
export interface TrafficInputs {
  timezone: string;
  /** menor/maior `date` de fact_traffic_daily do workspace (todo o histórico) */
  firstDate: string | null;
  lastDate: string;
  /** dias distintos com dado em [historyStart .. analysisEnd] */
  distinctDates: number;
  /** 1 ponto por dia COM linha em [baselineStart .. analysisEnd], em ordem crescente de data */
  daily: DayPoint[];
  curByChannel: SegmentTotals[];
  curBySM: SegmentTotals[];
  prevByChannel: SegmentTotals[];
  prevBySM: SegmentTotals[];
  baseByChannel: SegmentTotals[];
  /** sessões por (data, canal) em [previousStart .. analysisEnd] */
  dailyByChannel: { date: string; channel: string; sessions: number }[];
}

/**
 * Dados crus → `AnalysisContext`. **Pura** — não toca o banco nem o relógio.
 * Dia sem linha em `daily` é dia SEM DADO: nada é preenchido com zero.
 */
export function assembleAnalysisContext(input: {
  workspaceId: string;
  plan: WindowPlan;
  /** ver `AnalysisContext.coverage.expectedLastDate` */
  expectedLastDate: string;
  traffic: TrafficInputs;
  ads: AdsContext | null;
  rdMarketing: RdMarketingContext | null;
  rdCrm: RdCrmContext | null;
}): AnalysisContext {
  const { workspaceId, plan, expectedLastDate, traffic, ads, rdMarketing, rdCrm } = input;
  const { periodStart, analysisEnd, previousStart, previousEnd, baselineStart, baselineEnd } =
    plan;

  const dailySeries = traffic.daily;
  const dayByDate = new Map(dailySeries.map((d) => [d.date, d]));

  const inRange = (start: string, end: string) =>
    dailySeries.filter((d) => d.date >= start && d.date <= end);
  const daysWithData = (start: string, end: string) =>
    inRange(start, end).filter((d) => d.sessions > 0).length;

  const mkWindow = (
    start: string,
    end: string,
    byChannel: SegmentTotals[],
    bySourceMedium: SegmentTotals[],
  ): WindowAgg => ({
    start,
    end,
    days: plan.windowDays,
    daysWithData: daysWithData(start, end),
    totals: sumDays(inRange(start, end)),
    byChannel,
    bySourceMedium,
  });

  const current = mkWindow(periodStart, analysisEnd, traffic.curByChannel, traffic.curBySM);
  const previous = mkWindow(previousStart, previousEnd, traffic.prevByChannel, traffic.prevBySM);
  const baseline: WindowAgg = {
    start: baselineStart,
    end: baselineEnd,
    days: BASELINE_DAYS,
    daysWithData: daysWithData(baselineStart, baselineEnd),
    totals: sumDays(inRange(baselineStart, baselineEnd)),
    byChannel: traffic.baseByChannel,
    bySourceMedium: [],
  };

  // (not set)/(direct) share na janela atual
  const curSessions = current.totals.sessions;
  const notSetDirect = traffic.curBySM
    .filter((s) => isDirectOrNotSet(s.key))
    .reduce((a, s) => a + s.sessions, 0);
  const notSetDirectSessionShare =
    curSessions > 0 ? notSetDirect / curSessions : 0;

  // buraco de coleta em [previousStart .. analysisEnd]
  let zeroDayGap = false;
  {
    let cursor = previousStart;
    const seq: number[] = [];
    while (cursor <= analysisEnd) {
      seq.push(dayByDate.get(cursor)?.sessions ?? 0);
      cursor = addDays(cursor, 1);
    }
    for (let i = 1; i < seq.length - 1; i++) {
      if ((seq[i] ?? 0) === 0 && (seq[i - 1] ?? 0) > 0 && (seq[i + 1] ?? 0) > 0) {
        zeroDayGap = true;
        break;
      }
    }
  }

  const analyzed = inRange(baselineStart, analysisEnd);
  const totalKeyEvents = analyzed.reduce((a, d) => a + d.keyEvents, 0);
  const totalConversionValue = analyzed.reduce(
    (a, d) => a + d.conversionValue,
    0,
  );

  // Cobertura REAL do GA4 dentro do período solicitado, por EXISTÊNCIA DE LINHA:
  //  - dia COM linha é dado válido, mesmo com `sessions = 0` — um zero registrado é
  //    um zero, nunca atraso nem ausência;
  //  - dia SEM linha é ausência de dado — e nunca vira zero.
  // `dailySeries` (GROUP BY date) só tem as datas com ao menos uma linha. Atraso do
  // GA4, período parcial e períodos não equivalentes dependem DISTO, não do valor da
  // métrica. (`current.daysWithData`, acima, segue contando só dias com sessões > 0:
  // é o que os gates e os detectors sempre usaram e não muda.)
  const covered = inRange(periodStart, analysisEnd);
  const inPeriod = {
    daysWithData: covered.length,
    firstDate: covered[0]?.date ?? null,
    lastDate: covered.at(-1)?.date ?? null,
  };

  return {
    workspaceId,
    propertyTimezone: traffic.timezone,
    period: { start: periodStart, end: analysisEnd },
    analysisEnd,
    coverage: {
      firstDate: traffic.firstDate ?? null,
      lastDate: traffic.lastDate,
      distinctDates: traffic.distinctDates,
      expectedDays: HISTORY_DAYS,
      // `analysisEnd` (modo padrão) = min(hoje − 2, lastDate): guardar o dia
      // esperado é o que deixa a análise enxergar um GA4 parado (lastDate < esperado).
      expectedLastDate,
      inPeriod,
    },
    totalKeyEvents,
    totalConversionValue,
    notSetDirectSessionShare,
    zeroDayGap,
    baselineDailySessions: inRange(baselineStart, baselineEnd).map(
      (d) => d.sessions,
    ),
    dailyByChannel: traffic.dailyByChannel.map((r) => ({
      date: r.date,
      channel: r.channel,
      sessions: r.sessions,
    })),
    dailySeries,
    current,
    previous,
    baseline,
    ads,
    rdMarketing,
    rdCrm,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────────────

/**
 * Único ponto de leitura do banco para a análise. Sem `period` o comportamento é o
 * de sempre (janela móvel de 28 dias); com `period` a janela `current` é o período
 * pedido, SEM ser encolhida quando o GA4 não tem dados até lá — a cobertura real
 * vem em `ctx.coverage.inPeriod` e nos `coverage` de cada fonte.
 *
 * Lança `AnalysisPeriodError` para período inválido (antes de qualquer consulta,
 * exceto a checagem de "fim no futuro", que precisa do fuso da propriedade).
 */
export async function buildAnalysisContext(
  workspaceId: string,
  period?: AnalysisPeriodInput,
): Promise<AnalysisContext | null> {
  // formato/ordem/tamanho do período explícito: falha ANTES de abrir o banco
  if (period) validateAnalysisPeriod(period);

  // propriedade selecionada (para o fuso)
  const [prop] = await db
    .select({ timezone: connectionProperties.timezone })
    .from(connectionProperties)
    .innerJoin(
      connections,
      eq(connections.id, connectionProperties.connectionId),
    )
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "ga4"),
        eq(connectionProperties.isSelected, true),
      ),
    )
    .limit(1);

  const tz = prop?.timezone ?? "UTC";

  // último dia com dados + cobertura na janela histórica
  const [cov] = await db
    .select({
      firstDate: sql<string | null>`min(${factTrafficDaily.date})`,
      lastDate: sql<string | null>`max(${factTrafficDaily.date})`,
    })
    .from(factTrafficDaily)
    .where(eq(factTrafficDaily.workspaceId, workspaceId));

  if (!cov?.lastDate) return null;

  const today = todayInTimeZone(tz);
  const naturalEnd = addDays(today, -CUTOFF_LAG_DAYS);
  const { plan, expectedLastDate } = resolveWindowPlan(period, {
    naturalEnd,
    lastDate: cov.lastDate,
    today,
  });
  const {
    periodStart,
    analysisEnd,
    previousStart,
    previousEnd,
    baselineStart,
    baselineEnd,
    historyStart,
  } = plan;

  // cobertura de dias distintos na janela histórica
  const [covDates] = await db
    .select({ n: sql<number>`count(distinct ${factTrafficDaily.date})::int` })
    .from(factTrafficDaily)
    .where(
      and(
        eq(factTrafficDaily.workspaceId, workspaceId),
        gte(factTrafficDaily.date, historyStart),
        lte(factTrafficDaily.date, analysisEnd),
      ),
    );

  // série diária [baselineStart .. analysisEnd]
  const dailyRows = await db
    .select({
      date: factTrafficDaily.date,
      sessions: num(factTrafficDaily.sessions),
      totalUsers: num(factTrafficDaily.totalUsers),
      newUsers: num(factTrafficDaily.newUsers),
      engagedSessions: num(factTrafficDaily.engagedSessions),
      keyEvents: num(factTrafficDaily.keyEvents),
      conversionValue: num(factTrafficDaily.conversionValue),
    })
    .from(factTrafficDaily)
    .where(
      and(
        eq(factTrafficDaily.workspaceId, workspaceId),
        gte(factTrafficDaily.date, baselineStart),
        lte(factTrafficDaily.date, analysisEnd),
      ),
    )
    .groupBy(factTrafficDaily.date)
    .orderBy(asc(factTrafficDaily.date));

  const daily: DayPoint[] = dailyRows.map((r) => ({
    date: r.date,
    sessions: r.sessions,
    totalUsers: r.totalUsers,
    newUsers: r.newUsers,
    engagedSessions: r.engagedSessions,
    keyEvents: r.keyEvents,
    conversionValue: r.conversionValue,
  }));

  // segmentos por janela
  const channelExpr = factTrafficDaily.channel;
  const smExpr = sql<string>`${factTrafficDaily.source} || ' / ' || ${factTrafficDaily.medium}`;

  async function segTotals(
    start: string,
    end: string,
    keyExpr: SQL<string> | typeof factTrafficDaily.channel,
  ): Promise<SegmentTotals[]> {
    const rows = await db
      .select({
        key: keyExpr,
        sessions: num(factTrafficDaily.sessions),
        totalUsers: num(factTrafficDaily.totalUsers),
        newUsers: num(factTrafficDaily.newUsers),
        engagedSessions: num(factTrafficDaily.engagedSessions),
        keyEvents: num(factTrafficDaily.keyEvents),
        conversionValue: num(factTrafficDaily.conversionValue),
      })
      .from(factTrafficDaily)
      .where(
        and(
          eq(factTrafficDaily.workspaceId, workspaceId),
          gte(factTrafficDaily.date, start),
          lte(factTrafficDaily.date, end),
        ),
      )
      .groupBy(keyExpr);
    return rows.map((r) => ({ ...r, key: String(r.key) }));
  }

  const [
    curByChannel,
    curBySM,
    prevByChannel,
    prevBySM,
    baseByChannel,
  ] = await Promise.all([
    segTotals(periodStart, analysisEnd, channelExpr),
    segTotals(periodStart, analysisEnd, smExpr),
    segTotals(previousStart, previousEnd, channelExpr),
    segTotals(previousStart, previousEnd, smExpr),
    segTotals(baselineStart, baselineEnd, channelExpr),
  ]);

  // sessões por (data, canal) na janela [previousStart .. analysisEnd] (onset)
  const dbcRows = await db
    .select({
      date: factTrafficDaily.date,
      channel: factTrafficDaily.channel,
      sessions: num(factTrafficDaily.sessions),
    })
    .from(factTrafficDaily)
    .where(
      and(
        eq(factTrafficDaily.workspaceId, workspaceId),
        gte(factTrafficDaily.date, previousStart),
        lte(factTrafficDaily.date, analysisEnd),
      ),
    )
    .groupBy(factTrafficDaily.date, factTrafficDaily.channel);

  // Cada fonte recebe a MESMA janela `current` (um objeto novo por chamada — o
  // contexto devolvido não compartilha referências entre as fontes).
  const ads = await buildAdsContext(workspaceId, {
    start: periodStart,
    end: analysisEnd,
  });
  const rdMarketing = await buildRdMarketingContext(workspaceId, {
    start: periodStart,
    end: analysisEnd,
  });
  const rdCrm = await buildRdCrmContext(workspaceId, {
    start: periodStart,
    end: analysisEnd,
  });

  return assembleAnalysisContext({
    workspaceId,
    plan,
    expectedLastDate,
    traffic: {
      timezone: tz,
      firstDate: cov.firstDate ?? null,
      lastDate: cov.lastDate,
      distinctDates: covDates?.n ?? 0,
      daily,
      curByChannel,
      curBySM,
      prevByChannel,
      prevBySM,
      baseByChannel,
      dailyByChannel: dbcRows.map((r) => ({
        date: r.date,
        channel: r.channel,
        sessions: r.sessions,
      })),
    },
    ads,
    rdMarketing,
    rdCrm,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Ads (bloco G5) — lê fact_ad_performance_daily, alinhada à janela `current`
// já calculada acima. Puramente aditiva: se não houver linhas, `ads` fica
// `null` e o resto do contexto (tudo acima) é idêntico ao que já era antes
// do G5. Nenhum detector consome isto ainda — ver docs/v1-architecture.md §8.
// ─────────────────────────────────────────────────────────────────────

/** Linha agregada por campanha (SUM cumulativo + AVG das métricas de leilão). */
interface AdsPerCampaignAgg {
  campaignId: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  impressionShare: number | null;
  budgetLostIs: number | null;
  rankLostIs: number | null;
}

/** Linha crua (1 por campanha × dia) usada só para achar o snapshot mais recente. */
interface AdsSnapshotRow {
  campaignId: string;
  date: string;
  campaignName: string;
  status: string;
  currency: string | null;
  dims: unknown;
}

/**
 * Funde os agregados por campanha com o snapshot (nome/status/canal/moeda) do
 * dia mais recente de cada uma → `AdsContext`. **Pura** — não toca o banco,
 * não sabe nada de GA4/tráfego (não recebe `current`/`previous`/`dailyByChannel`
 * como argumento) — é estruturalmente impossível fazer cross-source aqui.
 * `perCampaign.length === 0` → `null` (sem dados na janela = ausência explícita).
 */
export function composeAdsContext(
  perCampaign: AdsPerCampaignAgg[],
  snapshotRows: AdsSnapshotRow[],
  window: { start: string; end: string },
): AdsContext | null {
  if (perCampaign.length === 0) return null;

  // snapshotRows deve vir ordenado por data ascendente — a última escrita no
  // Map por campaignId é o dia mais recente dessa campanha na janela.
  const latestByCampaign = new Map<string, AdsSnapshotRow>();
  for (const row of snapshotRows) {
    latestByCampaign.set(row.campaignId, row);
  }

  let currency: string | null = null;
  const campaigns: AdsCampaignSummary[] = perCampaign.map((agg) => {
    const snap = latestByCampaign.get(agg.campaignId);
    if (!currency && snap?.currency) currency = snap.currency;
    const dims = (snap?.dims ?? null) as {
      advertisingChannelType?: string | null;
    } | null;

    return {
      campaignId: agg.campaignId,
      campaignName: snap?.campaignName ?? "",
      status: snap?.status ?? "",
      advertisingChannelType: dims?.advertisingChannelType ?? null,
      impressions: agg.impressions,
      clicks: agg.clicks,
      cost: agg.cost,
      conversions: agg.conversions,
      conversionValue: agg.conversionValue,
      impressionShare: agg.impressionShare,
      budgetLostIs: agg.budgetLostIs,
      rankLostIs: agg.rankLostIs,
    };
  });

  const totals = campaigns.reduce(
    (acc, c) => ({
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      cost: acc.cost + c.cost,
      conversions: acc.conversions + c.conversions,
      conversionValue: acc.conversionValue + c.conversionValue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 },
  );

  return { window, currency, totals, campaignCount: campaigns.length, campaigns };
}

/** SUM cumulativo, 0 quando não há linha (nunca `null` para métricas de volume/custo). */
const adsSum = (col: SQLWrapper) =>
  sql<number>`coalesce(sum(${col}), 0)::float8`;
/** AVG — preserva `null` quando nenhuma linha reportou (métrica de leilão, não cumulativa). */
const adsAvg = (col: SQLWrapper) => sql<number | null>`avg(${col})::float8`;

/** Único ponto que lê `fact_ad_performance_daily` para o motor (INV-2: mesma regra do tráfego). */
async function buildAdsContext(
  workspaceId: string,
  window: { start: string; end: string },
): Promise<AdsContext | null> {
  const perCampaign = await db
    .select({
      campaignId: factAdPerformanceDaily.campaignId,
      impressions: adsSum(factAdPerformanceDaily.impressions),
      clicks: adsSum(factAdPerformanceDaily.clicks),
      cost: adsSum(factAdPerformanceDaily.cost),
      conversions: adsSum(factAdPerformanceDaily.conversions),
      conversionValue: adsSum(factAdPerformanceDaily.conversionValue),
      impressionShare: adsAvg(factAdPerformanceDaily.impressionShare),
      budgetLostIs: adsAvg(factAdPerformanceDaily.budgetLostIs),
      rankLostIs: adsAvg(factAdPerformanceDaily.rankLostIs),
    })
    .from(factAdPerformanceDaily)
    .where(
      and(
        eq(factAdPerformanceDaily.workspaceId, workspaceId),
        gte(factAdPerformanceDaily.date, window.start),
        lte(factAdPerformanceDaily.date, window.end),
      ),
    )
    .groupBy(factAdPerformanceDaily.campaignId);

  // Sem linhas na janela = sem Ads (não conectado OU conectado sem dados no
  // período) — os dois casos são a mesma coisa do ponto de vista do contexto.
  if (perCampaign.length === 0) return null;

  const snapshotRows = await db
    .select({
      campaignId: factAdPerformanceDaily.campaignId,
      date: factAdPerformanceDaily.date,
      campaignName: factAdPerformanceDaily.campaignName,
      status: factAdPerformanceDaily.campaignStatus,
      currency: factAdPerformanceDaily.currency,
      dims: factAdPerformanceDaily.dims,
    })
    .from(factAdPerformanceDaily)
    .where(
      and(
        eq(factAdPerformanceDaily.workspaceId, workspaceId),
        gte(factAdPerformanceDaily.date, window.start),
        lte(factAdPerformanceDaily.date, window.end),
      ),
    )
    .orderBy(asc(factAdPerformanceDaily.date));

  return composeAdsContext(perCampaign, snapshotRows, window);
}

// ─────────────────────────────────────────────────────────────────────
// RD Station Marketing (bloco RD-1) — lê fact_conversion_assets_daily,
// alinhada à janela `current` já calculada acima. Puramente aditiva: sem
// linhas, `rdMarketing` fica `null` e o resto do contexto é idêntico. Nenhum
// detector consome isto ainda.
// ─────────────────────────────────────────────────────────────────────

/** Linha agregada por ativo (SUM cumulativo + AVG da taxa de conversão). */
interface RdMarketingPerAssetAgg {
  assetId: string;
  visits: number;
  conversions: number;
  conversionRate: number | null;
}

/** Linha crua (1 por ativo × dia) usada só para achar o snapshot mais recente. */
interface RdMarketingSnapshotRow {
  assetId: string;
  date: string;
  assetIdentifier: string;
  assetType: string;
}

/**
 * Funde os agregados por ativo com o snapshot (identificador/tipo) do dia mais
 * recente de cada um → `RdMarketingContext`. **Pura** — mesmo papel do
 * `composeAdsContext`. `perAsset.length === 0` → `null`.
 */
export function composeRdMarketingContext(
  perAsset: RdMarketingPerAssetAgg[],
  snapshotRows: RdMarketingSnapshotRow[],
  window: { start: string; end: string },
): RdMarketingContext | null {
  if (perAsset.length === 0) return null;

  const latestByAsset = new Map<string, RdMarketingSnapshotRow>();
  for (const row of snapshotRows) {
    latestByAsset.set(row.assetId, row);
  }

  const assets: RdMarketingAssetSummary[] = perAsset.map((agg) => {
    const snap = latestByAsset.get(agg.assetId);
    return {
      assetId: agg.assetId,
      assetIdentifier: snap?.assetIdentifier ?? "",
      assetType: snap?.assetType ?? "",
      visits: agg.visits,
      conversions: agg.conversions,
      conversionRate: agg.conversionRate,
    };
  });

  const totals = assets.reduce(
    (acc, a) => ({
      visits: acc.visits + a.visits,
      conversions: acc.conversions + a.conversions,
    }),
    { visits: 0, conversions: 0 },
  );

  // Cobertura diária da própria fonte (dias com ≥ 1 linha dentro da janela) —
  // sai das mesmas linhas do snapshot, sem query nova.
  const dates = [
    ...new Set(
      snapshotRows
        .map((r) => r.date)
        .filter((d) => d >= window.start && d <= window.end),
    ),
  ].sort();
  const coverage = {
    daysWithData: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  };

  return { window, totals, assetCount: assets.length, assets, coverage };
}

/** Único ponto que lê `fact_conversion_assets_daily` para o motor (INV-2). */
async function buildRdMarketingContext(
  workspaceId: string,
  window: { start: string; end: string },
): Promise<RdMarketingContext | null> {
  const perAsset = await db
    .select({
      assetId: factConversionAssetsDaily.assetId,
      visits: adsSum(factConversionAssetsDaily.visits),
      conversions: adsSum(factConversionAssetsDaily.conversions),
      conversionRate: adsAvg(factConversionAssetsDaily.conversionRate),
    })
    .from(factConversionAssetsDaily)
    .where(
      and(
        eq(factConversionAssetsDaily.workspaceId, workspaceId),
        gte(factConversionAssetsDaily.date, window.start),
        lte(factConversionAssetsDaily.date, window.end),
      ),
    )
    .groupBy(factConversionAssetsDaily.assetId);

  // Sem linhas na janela = sem Marketing (não conectado, sem plano Pro/Advanced
  // para o endpoint, OU conectado sem dados no período) — mesma semântica do Ads.
  if (perAsset.length === 0) return null;

  const snapshotRows = await db
    .select({
      assetId: factConversionAssetsDaily.assetId,
      date: factConversionAssetsDaily.date,
      assetIdentifier: factConversionAssetsDaily.assetIdentifier,
      assetType: factConversionAssetsDaily.assetType,
    })
    .from(factConversionAssetsDaily)
    .where(
      and(
        eq(factConversionAssetsDaily.workspaceId, workspaceId),
        gte(factConversionAssetsDaily.date, window.start),
        lte(factConversionAssetsDaily.date, window.end),
      ),
    )
    .orderBy(asc(factConversionAssetsDaily.date));

  return composeRdMarketingContext(perAsset, snapshotRows, window);
}

// ─────────────────────────────────────────────────────────────────────
// RD Station CRM (bloco RD-1) — lê fact_deals. Diferente do Ads/Marketing:
// `fact_deals` é 1 linha por NEGOCIAÇÃO (não por dia), então a janela `current`
// não filtra uma coluna `date` — busca negociações cujo `deal_created_at` OU
// `deal_closed_at` caem na janela, e a composição pura decide em qual balde
// (created/won/lost) cada uma entra. `deal_updated_at` NUNCA é usada aqui (é
// só bookkeeping de sync, não data de um fato — ver `db/schema.ts`).
// ─────────────────────────────────────────────────────────────────────

interface RdCrmDealRow {
  status: string;
  totalPrice: number;
  pipelineId: string;
  dealCreatedAt: string;
  dealClosedAt: string | null;
  /** origem/campanha do CRM — `''` (ou ausente) = não preenchido */
  sourceId?: string;
  campaignId?: string;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** `fact_deals` guarda "ausente" como `''` — só valor não vazio conta como preenchido. */
const isFilled = (v: string | undefined): v is string =>
  typeof v === "string" && v.trim() !== "";

/** Acumulador de preenchimento de origem de UMA população (criadas ou ganhas). */
function newAttributionAcc() {
  return { total: 0, withSourceId: 0, withCampaignId: 0, sourceIds: new Set<string>() };
}

function addToAttribution(
  acc: ReturnType<typeof newAttributionAcc>,
  row: RdCrmDealRow,
): void {
  acc.total += 1;
  if (isFilled(row.sourceId)) {
    acc.withSourceId += 1;
    acc.sourceIds.add(row.sourceId.trim());
  }
  if (isFilled(row.campaignId)) acc.withCampaignId += 1;
}

function toAttributionCoverage(
  acc: ReturnType<typeof newAttributionAcc>,
): RdCrmAttributionCoverage {
  return {
    total: acc.total,
    withSourceId: acc.withSourceId,
    withCampaignId: acc.withCampaignId,
    distinctSourceIds: acc.sourceIds.size,
  };
}

/**
 * Bucketiza as negociações da janela por pipeline → `RdCrmContext`. **Pura**.
 * `rows.length === 0` → `null`. Uma negociação pode contribuir para `created`
 * e para `won`/`lost` na mesma chamada (aberta e fechada dentro da janela).
 */
export function composeRdCrmContext(
  rows: RdCrmDealRow[],
  window: { start: string; end: string },
  /** início do histórico de CRM importado no SaaS (ver `RdCrmCoverage`); `null` = desconhecido */
  importedHistoryStartDate: string | null = null,
): RdCrmContext | null {
  if (rows.length === 0) return null;

  const byPipeline = new Map<string, RdCrmPipelineSummary>();
  const ensure = (pipelineId: string): RdCrmPipelineSummary => {
    const existing = byPipeline.get(pipelineId);
    if (existing) return existing;
    const created: RdCrmPipelineSummary = {
      pipelineId,
      createdCount: 0,
      createdTotalPriceSum: 0,
      wonCount: 0,
      wonTotalPriceSum: 0,
      lostCount: 0,
    };
    byPipeline.set(pipelineId, created);
    return created;
  };

  // Acumuladores do detalhe aditivo (estado/valor/origem) — mesma passada.
  const createdAttr = newAttributionAcc();
  const wonAttr = newAttributionAcc();
  let createdOpenCount = 0;
  let wonWithValueCount = 0;
  let lostWithValueCount = 0;
  let lostTotalPriceSum = 0;

  for (const r of rows) {
    const createdInWindow =
      r.dealCreatedAt >= window.start && r.dealCreatedAt <= window.end;
    const closedInWindow =
      r.dealClosedAt != null &&
      r.dealClosedAt >= window.start &&
      r.dealClosedAt <= window.end;

    if (createdInWindow) {
      const p = ensure(r.pipelineId);
      p.createdCount += 1;
      p.createdTotalPriceSum = round4(p.createdTotalPriceSum + r.totalPrice);
      addToAttribution(createdAttr, r);
      if (r.status === "ongoing") createdOpenCount += 1;
    }
    if (closedInWindow && r.status === "won") {
      const p = ensure(r.pipelineId);
      p.wonCount += 1;
      p.wonTotalPriceSum = round4(p.wonTotalPriceSum + r.totalPrice);
      addToAttribution(wonAttr, r);
      if (r.totalPrice > 0) wonWithValueCount += 1;
    }
    if (closedInWindow && r.status === "lost") {
      const p = ensure(r.pipelineId);
      p.lostCount += 1;
      if (r.totalPrice > 0) lostWithValueCount += 1;
      lostTotalPriceSum = round4(lostTotalPriceSum + r.totalPrice);
    }
  }

  const pipelines = [...byPipeline.values()];
  // A query SQL já filtra por created/closed na janela, mas uma negociação
  // pode ter vindo pela borda (ex.: closed_at no limite) sem, por arredondamento
  // de string, cair em nenhum balde aqui — defensivo, não esperado na prática.
  if (pipelines.length === 0) return null;

  const totals = pipelines.reduce(
    (acc, p) => ({
      createdCount: acc.createdCount + p.createdCount,
      createdTotalPriceSum: round4(acc.createdTotalPriceSum + p.createdTotalPriceSum),
      wonCount: acc.wonCount + p.wonCount,
      wonTotalPriceSum: round4(acc.wonTotalPriceSum + p.wonTotalPriceSum),
      lostCount: acc.lostCount + p.lostCount,
    }),
    {
      createdCount: 0,
      createdTotalPriceSum: 0,
      wonCount: 0,
      wonTotalPriceSum: 0,
      lostCount: 0,
    },
  );

  return {
    window,
    totals,
    pipelineCount: pipelines.length,
    pipelines,
    coverage: { importedHistoryStartDate },
    detail: {
      createdOpenCount,
      wonWithValueCount,
      lostWithValueCount,
      lostTotalPriceSum,
    },
    attribution: {
      created: toAttributionCoverage(createdAttr),
      won: toAttributionCoverage(wonAttr),
    },
  };
}

/** Único ponto que lê `fact_deals` para o motor (INV-2). */
async function buildRdCrmContext(
  workspaceId: string,
  window: { start: string; end: string },
): Promise<RdCrmContext | null> {
  const rows = await db
    .select({
      status: factDeals.status,
      totalPrice: factDeals.totalPrice,
      pipelineId: factDeals.pipelineId,
      dealCreatedAt: factDeals.dealCreatedAt,
      dealClosedAt: factDeals.dealClosedAt,
      sourceId: factDeals.sourceId,
      campaignId: factDeals.campaignId,
    })
    .from(factDeals)
    .where(
      and(
        eq(factDeals.workspaceId, workspaceId),
        or(
          and(
            gte(factDeals.dealCreatedAt, window.start),
            lte(factDeals.dealCreatedAt, window.end),
          ),
          and(
            gte(factDeals.dealClosedAt, window.start),
            lte(factDeals.dealClosedAt, window.end),
          ),
        ),
      ),
    );

  if (rows.length === 0) return null;

  // Início do histórico de CRM IMPORTADO no SaaS: o início da janela da 1ª sincronização
  // BEM-SUCEDIDA do CRM (uma que falhou no meio não garante nada do que pediu).
  // `fact_deals` só tem negócios atualizados desde então — um período que começa
  // antes disso tem contagens que são piso, não total. NÃO é o início do histórico
  // real do CRM, que não é conhecido; a ingestão não é tocada.
  const [imported] = await db
    .select({ start: sql<string | null>`min(${syncRuns.periodStart})` })
    .from(syncRuns)
    .innerJoin(connections, eq(connections.id, syncRuns.connectionId))
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, "rd_station_crm"),
        inArray(syncRuns.status, ["success", "partial"]),
      ),
    );

  return composeRdCrmContext(rows, window, imported?.start ?? null);
}
