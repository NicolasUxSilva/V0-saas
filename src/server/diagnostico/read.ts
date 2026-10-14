/**
 * Leituras do banco para a tela Diagnóstico (SOMENTE `select`): o estado das fontes e a
 * mídia paga real. A decisão do que mostrar fica nos módulos puros
 * (`./status`, `./paid-media`); aqui só se lê — e tudo é escopado pelo `workspace_id`.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { todayInTimeZone } from "@/lib/dates";
import type { PaidMediaSnapshot, SourceKey, SourceStatus } from "@/lib/insight";
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
  PAID_WINDOW_DAYS,
  composePaidMediaSnapshot,
  paidWindows,
  type PaidPlatform,
  type PaidWindowTotals,
} from "./paid-media";
import {
  SOURCE_ORDER,
  buildSourceStatuses,
  type ConnectionSnapshot,
  type DataFootprint,
} from "./status";

const isSourceKey = (v: string): v is SourceKey => (SOURCE_ORDER as readonly string[]).includes(v);

/** Período dos dados já gravados por fonte (uma consulta pequena por tabela). */
async function readFootprints(workspaceId: string): Promise<Partial<Record<SourceKey, DataFootprint | null>>> {
  const span = (first: string | null, last: string | null): DataFootprint | null =>
    first && last ? { firstDate: first, lastDate: last } : null;

  const [traffic] = await db
    .select({
      first: sql<string | null>`min(${factTrafficDaily.date})`,
      last: sql<string | null>`max(${factTrafficDaily.date})`,
    })
    .from(factTrafficDaily)
    .where(eq(factTrafficDaily.workspaceId, workspaceId));

  const ads = await db
    .select({
      platform: factAdPerformanceDaily.platform,
      first: sql<string | null>`min(${factAdPerformanceDaily.date})`,
      last: sql<string | null>`max(${factAdPerformanceDaily.date})`,
    })
    .from(factAdPerformanceDaily)
    .where(eq(factAdPerformanceDaily.workspaceId, workspaceId))
    .groupBy(factAdPerformanceDaily.platform);

  const [rdMarketing] = await db
    .select({
      first: sql<string | null>`min(${factConversionAssetsDaily.date})`,
      last: sql<string | null>`max(${factConversionAssetsDaily.date})`,
    })
    .from(factConversionAssetsDaily)
    .where(eq(factConversionAssetsDaily.workspaceId, workspaceId));

  const [rdCrm] = await db
    .select({
      first: sql<string | null>`min(${factDeals.dealCreatedAt})`,
      last: sql<string | null>`max(${factDeals.dealCreatedAt})`,
    })
    .from(factDeals)
    .where(eq(factDeals.workspaceId, workspaceId));

  const adsBy = (platform: string) => ads.find((a) => a.platform === platform);
  return {
    ga4: span(traffic?.first ?? null, traffic?.last ?? null),
    google_ads: span(adsBy("google_ads")?.first ?? null, adsBy("google_ads")?.last ?? null),
    meta_ads: span(adsBy("meta_ads")?.first ?? null, adsBy("meta_ads")?.last ?? null),
    rd_station_marketing: span(rdMarketing?.first ?? null, rdMarketing?.last ?? null),
    rd_station_crm: span(rdCrm?.first ?? null, rdCrm?.last ?? null),
  };
}

/** Conexões do workspace + conta escolhida + última importação de cada uma. */
async function readConnections(workspaceId: string): Promise<ConnectionSnapshot[]> {
  const conns = await db
    .select({
      id: connections.id,
      provider: connections.provider,
      status: connections.status,
      lastSyncedAt: connections.lastSyncedAt,
      lastError: connections.lastError,
      tokenExpiresAt: connections.tokenExpiresAt,
    })
    .from(connections)
    .where(eq(connections.workspaceId, workspaceId));
  if (conns.length === 0) return [];

  const ids = conns.map((c) => c.id);
  const selected = await db
    .select({ connectionId: connectionProperties.connectionId })
    .from(connectionProperties)
    .where(and(inArray(connectionProperties.connectionId, ids), eq(connectionProperties.isSelected, true)));
  const runs = await db
    .selectDistinctOn([syncRuns.connectionId], {
      connectionId: syncRuns.connectionId,
      status: syncRuns.status,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(inArray(syncRuns.connectionId, ids))
    .orderBy(syncRuns.connectionId, desc(syncRuns.startedAt));

  const hasSelected = new Set(selected.map((s) => s.connectionId));
  const lastRun = new Map(runs.map((r) => [r.connectionId, r]));

  return conns.flatMap((c): ConnectionSnapshot[] => {
    if (!isSourceKey(c.provider)) return []; // `rd_station` (valor morto) não tem linha na tela
    const run = lastRun.get(c.id);
    return [
      {
        provider: c.provider,
        status: c.status,
        lastSyncedAt: c.lastSyncedAt,
        lastError: c.lastError,
        tokenExpiresAt: c.tokenExpiresAt,
        hasSelectedAccount: hasSelected.has(c.id),
        lastRun: run ? { status: run.status, error: run.error, startedAt: run.startedAt } : null,
      },
    ];
  });
}

/** O estado REAL das cinco fontes do workspace e o período dos dados de cada uma. */
export async function readSources(
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ sources: SourceStatus[]; footprints: Partial<Record<SourceKey, DataFootprint | null>> }> {
  const [conns, footprints] = await Promise.all([readConnections(workspaceId), readFootprints(workspaceId)]);
  const sources = buildSourceStatuses({
    connections: conns,
    footprints,
    today: todayInTimeZone("America/Sao_Paulo"),
    now,
  });
  return { sources, footprints };
}

/** Soma por janela de uma plataforma (uma consulta, dois conjuntos de somas filtradas). */
async function readPaidTotals(
  workspaceId: string,
  platform: PaidPlatform,
  windows: ReturnType<typeof paidWindows>,
): Promise<{ current: PaidWindowTotals; previous: PaidWindowTotals; currency: string | null }> {
  const f = factAdPerformanceDaily;
  const inCurrent = and(gte(f.date, windows.current.start), lte(f.date, windows.current.end));
  const inPrevious = and(gte(f.date, windows.previous.start), lte(f.date, windows.previous.end));
  const sum = (col: typeof f.cost | typeof f.impressions | typeof f.clicks | typeof f.conversions, win: typeof inCurrent) =>
    sql<number>`coalesce(sum(${col}) filter (where ${win}), 0)::float8`;
  const days = (win: typeof inCurrent) => sql<number>`count(distinct ${f.date}) filter (where ${win})::int`;

  const [row] = await db
    .select({
      curCost: sum(f.cost, inCurrent),
      curImpressions: sum(f.impressions, inCurrent),
      curClicks: sum(f.clicks, inCurrent),
      curConversions: sum(f.conversions, inCurrent),
      curDays: days(inCurrent),
      prevCost: sum(f.cost, inPrevious),
      prevImpressions: sum(f.impressions, inPrevious),
      prevClicks: sum(f.clicks, inPrevious),
      prevConversions: sum(f.conversions, inPrevious),
      prevDays: days(inPrevious),
    })
    .from(f)
    .where(
      and(
        eq(f.workspaceId, workspaceId),
        eq(f.platform, platform),
        gte(f.date, windows.previous.start),
        lte(f.date, windows.current.end),
      ),
    );

  const [latest] = await db
    .select({ currency: f.currency })
    .from(f)
    .where(and(eq(f.workspaceId, workspaceId), eq(f.platform, platform)))
    .orderBy(desc(f.date))
    .limit(1);

  return {
    current: {
      cost: row?.curCost ?? 0,
      impressions: row?.curImpressions ?? 0,
      clicks: row?.curClicks ?? 0,
      conversions: row?.curConversions ?? 0,
      daysWithData: row?.curDays ?? 0,
    },
    previous: {
      cost: row?.prevCost ?? 0,
      impressions: row?.prevImpressions ?? 0,
      clicks: row?.prevClicks ?? 0,
      conversions: row?.prevConversions ?? 0,
      daysWithData: row?.prevDays ?? 0,
    },
    currency: latest?.currency ?? null,
  };
}

/**
 * Mídia paga REAL: para cada plataforma com dados, os `PAID_WINDOW_DAYS` dias mais
 * recentes e os anteriores — a partir do último dia com dado da PRÓPRIA plataforma.
 */
export async function readPaidMedia(
  workspaceId: string,
  footprints: Partial<Record<SourceKey, DataFootprint | null>>,
): Promise<PaidMediaSnapshot[]> {
  const out: PaidMediaSnapshot[] = [];
  for (const platform of ["google_ads", "meta_ads"] as const) {
    const lastDate = footprints[platform]?.lastDate;
    if (!lastDate) continue;
    const totals = await readPaidTotals(workspaceId, platform, paidWindows(lastDate));
    const snapshot = composePaidMediaSnapshot({ platform, lastDate, ...totals });
    if (snapshot) out.push(snapshot);
  }
  return out;
}

export { PAID_WINDOW_DAYS };
