/**
 * Normalização: lote canônico → fact table (bloco B3 · roteador no G1/G3/RD-1).
 *
 * `normalizeBatch` roteia pelo `CanonicalBatch.target`:
 *   - `traffic`           → `fact_traffic_daily`            (GA4)
 *   - `ad_performance`    → `fact_ad_performance_daily`     (Google Ads)
 *   - `conversion_assets` → `fact_conversion_assets_daily`  (RD Station Marketing)
 *   - `opportunities`     → `fact_deals`                    (RD Station CRM)
 *
 * Cada alvo tem sua própria função de upsert, isolada (schemas não se misturam).
 * Upsert idempotente pela chave natural, gravando só quando o `source_hash`
 * muda — um 2º sync do mesmo período não gera escrita nem duplicação. Retorna
 * quantas linhas foram de fato inseridas/atualizadas.
 */
import { sql } from "drizzle-orm";

import type {
  CanonicalAdPerfRow,
  CanonicalBatch,
  CanonicalConversionAssetRow,
  CanonicalDealRow,
  CanonicalTrafficRow,
} from "@/server/connectors/types";
import { db } from "@/server/db";
import {
  factAdPerformanceDaily,
  factConversionAssetsDaily,
  factDeals,
  factTrafficDaily,
} from "@/server/db/schema";

/** Postgres tem limite de ~65535 parâmetros por statement; lotes seguros. */
const BATCH = 1000;

/** Roteia o lote canônico para a fact table certa. */
export async function normalizeBatch(
  workspaceId: string,
  connectionId: string,
  platform: string,
  batch: CanonicalBatch,
): Promise<number> {
  switch (batch.target) {
    case "traffic":
      return upsertFactTraffic(workspaceId, connectionId, platform, batch.rows);
    case "ad_performance":
      return upsertFactAdPerformance(
        workspaceId,
        connectionId,
        platform,
        batch.rows,
      );
    case "conversion_assets":
      return upsertFactConversionAssets(
        workspaceId,
        connectionId,
        platform,
        batch.rows,
      );
    case "opportunities":
      return upsertFactDeals(workspaceId, connectionId, platform, batch.rows);
    default: {
      const _exhaustive: never = batch;
      throw new Error(`CanonicalBatch desconhecido: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function upsertFactTraffic(
  workspaceId: string,
  connectionId: string,
  platform: string,
  rows: CanonicalTrafficRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => ({
      workspaceId,
      connectionId,
      platform,
      date: r.date,
      channel: r.channel,
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      sessions: r.sessions,
      totalUsers: r.totalUsers,
      newUsers: r.newUsers,
      engagedSessions: r.engagedSessions,
      avgEngagementTime: r.avgEngagementTime,
      keyEvents: r.keyEvents,
      conversionValue: r.conversionValue,
      dims: r.dims,
      sourceHash: r.sourceHash,
    }));

    const updated = await db
      .insert(factTrafficDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [
          factTrafficDaily.connectionId,
          factTrafficDaily.platform,
          factTrafficDaily.date,
          factTrafficDaily.channel,
          factTrafficDaily.source,
          factTrafficDaily.medium,
          factTrafficDaily.campaign,
        ],
        set: {
          sessions: sql`excluded.sessions`,
          totalUsers: sql`excluded.total_users`,
          newUsers: sql`excluded.new_users`,
          engagedSessions: sql`excluded.engaged_sessions`,
          avgEngagementTime: sql`excluded.avg_engagement_time`,
          keyEvents: sql`excluded.key_events`,
          conversionValue: sql`excluded.conversion_value`,
          dims: sql`excluded.dims`,
          sourceHash: sql`excluded.source_hash`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${factTrafficDaily.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning({ id: factTrafficDaily.id });

    written += updated.length;
  }

  return written;
}

/**
 * Upsert em `fact_ad_performance_daily` (Google Ads · G3). Isolada de
 * `upsertFactTraffic` — chave natural e colunas próprias. Chave natural:
 * (connection_id, platform, date, campaign_id, ad_network).
 */
async function upsertFactAdPerformance(
  workspaceId: string,
  connectionId: string,
  platform: string,
  rows: CanonicalAdPerfRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => ({
      workspaceId,
      connectionId,
      platform,
      date: r.date,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      campaignStatus: r.campaignStatus,
      adNetwork: r.adNetwork,
      impressions: r.impressions,
      clicks: r.clicks,
      cost: r.cost,
      conversions: r.conversions,
      conversionValue: r.conversionValue,
      impressionShare: r.impressionShare,
      budgetLostIs: r.budgetLostIs,
      rankLostIs: r.rankLostIs,
      currency: r.currency,
      dims: r.dims,
      sourceHash: r.sourceHash,
    }));

    const updated = await db
      .insert(factAdPerformanceDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [
          factAdPerformanceDaily.connectionId,
          factAdPerformanceDaily.platform,
          factAdPerformanceDaily.date,
          factAdPerformanceDaily.campaignId,
          factAdPerformanceDaily.adNetwork,
        ],
        set: {
          campaignName: sql`excluded.campaign_name`,
          campaignStatus: sql`excluded.campaign_status`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          cost: sql`excluded.cost`,
          conversions: sql`excluded.conversions`,
          conversionValue: sql`excluded.conversion_value`,
          impressionShare: sql`excluded.impression_share`,
          budgetLostIs: sql`excluded.budget_lost_is`,
          rankLostIs: sql`excluded.rank_lost_is`,
          currency: sql`excluded.currency`,
          dims: sql`excluded.dims`,
          sourceHash: sql`excluded.source_hash`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${factAdPerformanceDaily.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning({ id: factAdPerformanceDaily.id });

    written += updated.length;
  }

  return written;
}

/**
 * Upsert em `fact_conversion_assets_daily` (RD Station Marketing · RD-1C).
 * Isolada. Chave natural: (connection_id, platform, date, asset_id).
 */
async function upsertFactConversionAssets(
  workspaceId: string,
  connectionId: string,
  platform: string,
  rows: CanonicalConversionAssetRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => ({
      workspaceId,
      connectionId,
      platform,
      date: r.date,
      assetId: r.assetId,
      assetIdentifier: r.assetIdentifier,
      assetType: r.assetType,
      visits: r.visits,
      conversions: r.conversions,
      conversionRate: r.conversionRate,
      dims: r.dims,
      sourceHash: r.sourceHash,
    }));

    const updated = await db
      .insert(factConversionAssetsDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [
          factConversionAssetsDaily.connectionId,
          factConversionAssetsDaily.platform,
          factConversionAssetsDaily.date,
          factConversionAssetsDaily.assetId,
        ],
        set: {
          assetIdentifier: sql`excluded.asset_identifier`,
          assetType: sql`excluded.asset_type`,
          visits: sql`excluded.visits`,
          conversions: sql`excluded.conversions`,
          conversionRate: sql`excluded.conversion_rate`,
          dims: sql`excluded.dims`,
          sourceHash: sql`excluded.source_hash`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${factConversionAssetsDaily.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning({ id: factConversionAssetsDaily.id });

    written += updated.length;
  }

  return written;
}

/**
 * Upsert em `fact_deals` (RD Station CRM · RD-1E). Isolada. Chave natural:
 * (connection_id, platform, deal_id) — UMA linha por negociação, não por dia
 * (ver o comentário em `db/schema.ts`).
 */
async function upsertFactDeals(
  workspaceId: string,
  connectionId: string,
  platform: string,
  rows: CanonicalDealRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => ({
      workspaceId,
      connectionId,
      platform,
      dealId: r.dealId,
      status: r.status,
      totalPrice: r.totalPrice,
      pipelineId: r.pipelineId,
      stageId: r.stageId,
      sourceId: r.sourceId,
      campaignId: r.campaignId,
      lostReasonId: r.lostReasonId,
      dealCreatedAt: r.dealCreatedAt,
      dealUpdatedAt: new Date(r.dealUpdatedAt),
      dealClosedAt: r.dealClosedAt,
      dims: r.dims,
      sourceHash: r.sourceHash,
    }));

    const updated = await db
      .insert(factDeals)
      .values(values)
      .onConflictDoUpdate({
        target: [factDeals.connectionId, factDeals.platform, factDeals.dealId],
        set: {
          status: sql`excluded.status`,
          totalPrice: sql`excluded.total_price`,
          pipelineId: sql`excluded.pipeline_id`,
          stageId: sql`excluded.stage_id`,
          sourceId: sql`excluded.source_id`,
          campaignId: sql`excluded.campaign_id`,
          lostReasonId: sql`excluded.lost_reason_id`,
          dealCreatedAt: sql`excluded.deal_created_at`,
          dealUpdatedAt: sql`excluded.deal_updated_at`,
          dealClosedAt: sql`excluded.deal_closed_at`,
          dims: sql`excluded.dims`,
          sourceHash: sql`excluded.source_hash`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${factDeals.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning({ id: factDeals.id });

    written += updated.length;
  }

  return written;
}
