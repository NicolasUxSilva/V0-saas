/**
 * Mapeamento Google Ads → camada canônica (bloco G3).
 *
 * Uma página de `googleAds:search` → N `CanonicalAdPerfRow` (uma por linha
 * campanha × dia). Determinístico e idempotente: a mesma página produz sempre
 * as mesmas linhas e o mesmo `source_hash` (hash da chave natural + valores),
 * que o `normalize` usa para o upsert em `fact_ad_performance_daily`.
 *
 * Dinheiro: `metrics.cost_micros` (int64, string no REST) ÷ 1_000_000. Micros
 * NÃO são valor monetário — a conversão é explícita e arredondada a 4 casas
 * (o grão da coluna `numeric(18,4)`, §6.3). Determinística, sub-centavo.
 *
 * Ausência ≠ zero (§12): `search_impression_share` etc. viram `null` quando a
 * fonte não reporta — nunca 0.
 */
import { createHash } from "node:crypto";

import type {
  CanonicalAdEntityRow,
  CanonicalAdPerfRow,
  CanonicalBatch,
  RawRecord,
} from "@/server/connectors/types";

import {
  adsEntitySearchPageSchema,
  adsSearchPageSchema,
  type AdsSearchRow,
} from "./schema";

const MICROS_PER_UNIT = 1_000_000;

/** Inteiro não-negativo a partir de string|number|ausente. */
function toInt(v: string | number | null | undefined): number {
  const n = Math.trunc(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/** Número decimal (conversões podem ser fracionárias) a partir de string|number. */
function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** micros (int64) → unidade monetária, 4 casas, determinístico. */
function microsToCurrency(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const micros = Number(v);
  if (!Number.isFinite(micros)) return 0;
  return Math.round((micros / MICROS_PER_UNIT) * 1e4) / 1e4;
}

/** Ratio 0..1 — `null` quando a fonte não reporta (NÃO 0). */
function toRatioOrNull(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `dims`: atributos trazidos na GAQL mas não promovidos a coluna no V1. */
function buildDims(row: AdsSearchRow): Record<string, unknown> {
  return {
    advertisingChannelType: row.campaign?.advertisingChannelType ?? null,
    budgetAmount:
      row.campaignBudget?.amountMicros != null
        ? microsToCurrency(row.campaignBudget.amountMicros)
        : null,
  };
}

/**
 * Hash da chave natural + de todos os valores que, mudando, exigem re-gravar a
 * linha. Ordem fixa (array), `JSON.stringify` — `null` continua `null`.
 */
function rowHash(r: Omit<CanonicalAdPerfRow, "sourceHash">): string {
  const key = [
    r.date,
    r.campaignId,
    r.adNetwork,
    r.campaignName,
    r.campaignStatus,
    r.impressions,
    r.clicks,
    Math.round(r.cost * 1e4) / 1e4,
    Math.round(r.conversions * 1e4) / 1e4,
    Math.round(r.conversionValue * 1e4) / 1e4,
    r.impressionShare,
    r.budgetLostIs,
    r.rankLostIs,
    r.currency,
    (r.dims?.advertisingChannelType as string | null) ?? null,
    (r.dims?.budgetAmount as number | null) ?? null,
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

/** Hash da chave natural + valores de uma linha de detalhe. */
function entityHash(r: Omit<CanonicalAdEntityRow, "sourceHash">): string {
  const key = [
    r.level,
    r.date,
    r.accountId,
    r.campaignId,
    r.adGroupId,
    r.adGroupName,
    r.adId,
    r.adName,
    r.status,
    r.entityType,
    r.impressions,
    r.clicks,
    r.cost,
    Math.round(r.conversions * 1e4) / 1e4,
    Math.round(r.conversionValue * 1e4) / 1e4,
    r.currency,
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

/**
 * Streams de detalhe → `ad_entity`. `ad_group_daily`: uma linha por grupo × dia (o
 * status/tipo são do GRUPO). `ad_daily`: uma linha por anúncio × dia (status/tipo do
 * ANÚNCIO; o grupo vem junto). Mesmas regras de dinheiro e de ausência do grão campanha.
 */
function mapEntities(level: "ad_group" | "ad", raw: RawRecord): CanonicalBatch {
  const page = adsEntitySearchPageSchema.parse(raw.payload);

  const rows: CanonicalAdEntityRow[] = (page.results ?? []).map((row) => {
    const campaignId = row.campaign?.id;
    const adGroupId = row.adGroup?.id;
    const adId = level === "ad" ? (row.adGroupAd?.ad?.id ?? "") : "";
    const date = row.segments?.date;
    if (!campaignId || !adGroupId || (level === "ad" && !adId) || !date) {
      throw new Error(
        "Google Ads: linha de detalhe sem campaign.id, ad_group.id, ad.id ou segments.date — resposta fora do contrato.",
      );
    }

    const base = {
      level,
      date,
      accountId: row.customer?.id ? `customers/${row.customer.id}` : "",
      campaignId,
      adGroupId,
      adGroupName: row.adGroup?.name?.trim() ?? "",
      adId,
      adName: level === "ad" ? (row.adGroupAd?.ad?.name?.trim() ?? "") : "",
      status: (level === "ad" ? row.adGroupAd?.status : row.adGroup?.status) ?? "",
      entityType: (level === "ad" ? row.adGroupAd?.ad?.type : row.adGroup?.type) ?? "",
      impressions: toInt(row.metrics?.impressions),
      clicks: toInt(row.metrics?.clicks),
      cost: microsToCurrency(row.metrics?.costMicros),
      conversions: toNum(row.metrics?.conversions),
      conversionValue: toNum(row.metrics?.conversionsValue),
      currency: row.customer?.currencyCode ?? null,
      dims: null,
    };
    return { ...base, sourceHash: entityHash(base) };
  });

  return { target: "ad_entity", rows };
}

export function mapToCanonical(stream: string, raw: RawRecord): CanonicalBatch {
  if (stream === "ad_group_daily") return mapEntities("ad_group", raw);
  if (stream === "ad_daily") return mapEntities("ad", raw);
  if (stream !== "campaign_daily") {
    return { target: "ad_performance", rows: [] };
  }

  const page = adsSearchPageSchema.parse(raw.payload);

  const rows: CanonicalAdPerfRow[] = (page.results ?? []).map((row) => {
    const campaignId = row.campaign?.id;
    const date = row.segments?.date;
    // Chave natural incompleta = contrato da API quebrou. Falha alto — não
    // inventa id/data nem descarta linha em silêncio (§12).
    if (!campaignId || !date) {
      throw new Error(
        "Google Ads: linha sem campaign.id ou segments.date — resposta fora do contrato.",
      );
    }

    const base = {
      date,
      campaignId,
      campaignName: row.campaign?.name?.trim() ?? "",
      campaignStatus: row.campaign?.status ?? "",
      // GAQL do V1 não segmenta por rede (§10.3) → total da campanha no dia.
      adNetwork: "",
      impressions: toInt(row.metrics?.impressions),
      clicks: toInt(row.metrics?.clicks),
      cost: microsToCurrency(row.metrics?.costMicros),
      conversions: toNum(row.metrics?.conversions),
      conversionValue: toNum(row.metrics?.conversionsValue),
      impressionShare: toRatioOrNull(row.metrics?.searchImpressionShare),
      budgetLostIs: toRatioOrNull(row.metrics?.searchBudgetLostImpressionShare),
      rankLostIs: toRatioOrNull(row.metrics?.searchRankLostImpressionShare),
      currency: row.customer?.currencyCode ?? null,
      dims: buildDims(row) as Record<string, unknown> | null,
    };

    return { ...base, sourceHash: rowHash(base) };
  });

  return { target: "ad_performance", rows };
}
