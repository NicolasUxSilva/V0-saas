/**
 * Fábricas de payload sintético da Google Ads API (`googleAds:search`) para os
 * testes do conector — o shape do REST: inteiros de 64 bits como string,
 * doubles como número.
 */
import type { RawRecord } from "@/server/connectors/types";

export interface FakeRowOpts {
  campaignId?: string;
  campaignName?: string;
  campaignStatus?: string;
  channelType?: string;
  budgetMicros?: string | null;
  date?: string;
  impressions?: string | null;
  clicks?: string | null;
  costMicros?: string | null;
  conversions?: number | string | null;
  conversionsValue?: number | string | null;
  searchImpressionShare?: number | null;
  searchBudgetLostImpressionShare?: number | null;
  searchRankLostImpressionShare?: number | null;
  currencyCode?: string | null;
  timeZone?: string | null;
  /** omite blocos inteiros para simular resposta enxuta */
  omit?: Array<"campaign" | "segments" | "metrics" | "customer" | "campaignBudget">;
}

export function fakeRow(opts: FakeRowOpts = {}): Record<string, unknown> {
  const omit = new Set(opts.omit ?? []);
  const row: Record<string, unknown> = {};

  if (!omit.has("customer")) {
    row.customer = {
      id: "1234567890",
      currencyCode: opts.currencyCode === undefined ? "BRL" : opts.currencyCode,
      timeZone: opts.timeZone === undefined ? "America/Sao_Paulo" : opts.timeZone,
    };
  }
  if (!omit.has("campaign")) {
    row.campaign = {
      id: opts.campaignId ?? "111",
      name: opts.campaignName ?? "Campanha Search Brasil",
      status: opts.campaignStatus ?? "ENABLED",
      advertisingChannelType: opts.channelType ?? "SEARCH",
    };
  }
  if (!omit.has("campaignBudget")) {
    row.campaignBudget = {
      amountMicros:
        opts.budgetMicros === undefined ? "50000000" : opts.budgetMicros,
    };
  }
  if (!omit.has("segments")) {
    row.segments = { date: opts.date ?? "2026-09-01" };
  }
  if (!omit.has("metrics")) {
    row.metrics = {
      impressions: opts.impressions === undefined ? "1000" : opts.impressions,
      clicks: opts.clicks === undefined ? "120" : opts.clicks,
      costMicros: opts.costMicros === undefined ? "12340000" : opts.costMicros,
      conversions: opts.conversions === undefined ? 8 : opts.conversions,
      conversionsValue:
        opts.conversionsValue === undefined ? 960.5 : opts.conversionsValue,
      searchImpressionShare:
        opts.searchImpressionShare === undefined
          ? 0.62
          : opts.searchImpressionShare,
      searchBudgetLostImpressionShare:
        opts.searchBudgetLostImpressionShare === undefined
          ? 0.11
          : opts.searchBudgetLostImpressionShare,
      searchRankLostImpressionShare:
        opts.searchRankLostImpressionShare === undefined
          ? 0.27
          : opts.searchRankLostImpressionShare,
    };
  }
  return row;
}

export function fakePage(
  rows: Array<Record<string, unknown>>,
  nextPageToken?: string,
): Record<string, unknown> {
  return {
    results: rows,
    ...(nextPageToken ? { nextPageToken } : {}),
    totalResultsCount: String(rows.length),
  };
}

/** Embrulha um payload de página como um `RawRecord` (o que o `pull` gera). */
export function rawFromPage(payload: unknown): RawRecord {
  return {
    stream: "campaign_daily",
    externalId: "customers/1234567890:2026-03-01:2026-09-01:0",
    occurredOn: null,
    payload,
    sourceHash: "test-hash",
  };
}
