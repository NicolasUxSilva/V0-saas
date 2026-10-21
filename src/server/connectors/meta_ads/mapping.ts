/**
 * Mapeamento Meta Ads → camada canônica (`fact_ad_performance_daily`).
 *
 * Uma página de Insights → N `CanonicalAdPerfRow` (uma por campanha × dia). Determinístico
 * e idempotente: a mesma página produz sempre as mesmas linhas e o mesmo `source_hash`.
 *
 * COMO AS MÉTRICAS DA META VIRAM O CANÔNICO (e por que isto NÃO é igual ao Google Ads):
 *  - `clicks` = **cliques no link** (`inline_link_clicks`), o equivalente ao clique do
 *    Google Ads. Os "cliques" da Meta (`clicks`) incluem curtir, comentar, expandir…;
 *    ficam em `dims.allClicks`, nunca no campo comparável;
 *  - `cost` = `spend`, na moeda da conta de anúncios (`account_currency`); sem conversão;
 *  - `conversions` = eventos de **lead, compra e cadastro completo** que a Meta atribui
 *    (janela de atribuição padrão da conta). É uma definição DA META: não é comparável
 *    nem somável com as conversões do Google Ads, os key events do GA4 ou as conversões
 *    do RD — o Cross-source diz isso em toda comparação. Só tipos AGREGADOS entram
 *    (`lead`, não `offsite_conversion.fb_pixel_lead` + `onsite_conversion.lead_grouped`),
 *    senão o mesmo evento seria contado duas vezes. Os valores por tipo ficam em
 *    `dims.conversionActions`, para quem quiser auditar;
 *  - `conversionValue` = valor das **compras** (`action_values` de `purchase`);
 *  - alcance e frequência NÃO são aditivos (somar dias ou campanhas conta a mesma pessoa
 *    várias vezes): ficam em `dims` e nenhum total os usa;
 *  - métricas de leilão do Google (parcela de impressões etc.) não existem na Meta:
 *    `null`, nunca 0.
 *
 * Ausência ≠ zero: a Graph API OMITE campo sem valor; para volume e custo, omitido é 0
 * (a linha existe porque houve entrega), mas a moeda ausente é `null`, nunca BRL.
 */
import { createHash } from "node:crypto";

import type {
  CanonicalAdEntityRow,
  CanonicalAdPerfRow,
  CanonicalBatch,
  RawRecord,
} from "@/server/connectors/types";

import { insightsPageSchema, type InsightRow } from "./schema";

/** Eventos AGREGADOS da Meta que contam como conversão (ver o cabeçalho). */
export const META_CONVERSION_ACTION_TYPES = ["lead", "purchase", "complete_registration"] as const;
/** Eventos cujo valor monetário (`action_values`) entra em `conversionValue`. */
export const META_VALUE_ACTION_TYPES = ["purchase"] as const;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

function toNum(v: string | number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
const toInt = (v: string | number | null | undefined): number => Math.trunc(toNum(v));

/** Soma, por tipo, dos valores de `actions`/`action_values` que estão na lista. */
function actionsByType(
  list: InsightRow["actions"],
  allowed: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of list ?? []) {
    if (!allowed.includes(a.action_type)) continue;
    out[a.action_type] = round4((out[a.action_type] ?? 0) + toNum(a.value));
  }
  return out;
}

const sumValues = (m: Record<string, number>): number =>
  round4(Object.values(m).reduce((a, b) => a + b, 0));

/** Hash da chave natural + de todos os valores que, mudando, exigem re-gravar a linha. */
function rowHash(r: Omit<CanonicalAdPerfRow, "sourceHash">): string {
  const d = r.dims ?? {};
  const key = [
    r.date,
    r.campaignId,
    r.adNetwork,
    r.campaignName,
    r.campaignStatus,
    r.impressions,
    r.clicks,
    r.cost,
    r.conversions,
    r.conversionValue,
    r.currency,
    d.objective ?? null,
    d.allClicks ?? null,
    d.reach ?? null,
    d.frequency ?? null,
    JSON.stringify(d.conversionActions ?? {}),
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

/** Hash da chave natural + valores de uma linha de detalhe. */
function entityHash(r: Omit<CanonicalAdEntityRow, "sourceHash">): string {
  const d = r.dims ?? {};
  const key = [
    r.level,
    r.date,
    r.accountId,
    r.campaignId,
    r.adGroupId,
    r.adGroupName,
    r.adId,
    r.adName,
    r.impressions,
    r.clicks,
    r.cost,
    r.conversions,
    r.conversionValue,
    r.currency,
    d.objective ?? null,
    d.allClicks ?? null,
    JSON.stringify(d.conversionActions ?? {}),
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

/**
 * Níveis de detalhe → `ad_entity`. `adset_daily`: conjunto de anúncios × dia (o
 * `adGroupId` é o `adset_id` — a hierarquia é a da Meta, só o nome da coluna é comum);
 * `ad_daily`: anúncio × dia, com o conjunto junto. Mesmas definições do grão campanha:
 * clique = clique no link; conversões = lead + compra + cadastro, por tipo em `dims`.
 * A Insights não traz status: fica "" (nunca inventado).
 */
function mapEntities(level: "ad_group" | "ad", raw: RawRecord): CanonicalBatch {
  const page = insightsPageSchema.parse(raw.payload);

  const rows: CanonicalAdEntityRow[] = (page.data ?? []).map((row) => {
    const campaignId = row.campaign_id;
    const adGroupId = row.adset_id;
    const adId = level === "ad" ? (row.ad_id ?? "") : "";
    const date = row.date_start;
    if (!campaignId || !adGroupId || (level === "ad" && !adId) || !date) {
      throw new Error(
        "Meta Ads: linha de detalhe sem campaign_id, adset_id, ad_id ou date_start — resposta fora do contrato.",
      );
    }

    const conversionActions = actionsByType(row.actions, META_CONVERSION_ACTION_TYPES);
    const valueActions = actionsByType(row.action_values, META_VALUE_ACTION_TYPES);

    const base = {
      level,
      date,
      accountId: row.account_id ? `act_${row.account_id.replace(/^act_/, "")}` : "",
      campaignId,
      adGroupId,
      adGroupName: row.adset_name?.trim() ?? "",
      adId,
      adName: level === "ad" ? (row.ad_name?.trim() ?? "") : "",
      status: "",
      entityType: "",
      impressions: toInt(row.impressions),
      clicks: toInt(row.inline_link_clicks),
      cost: round4(toNum(row.spend)),
      conversions: sumValues(conversionActions),
      conversionValue: sumValues(valueActions),
      currency: row.account_currency ?? null,
      dims: {
        objective: row.objective ?? null,
        allClicks: toInt(row.clicks),
        conversionActions,
      } as Record<string, unknown>,
    };
    return { ...base, sourceHash: entityHash(base) };
  });

  return { target: "ad_entity", rows };
}

export function mapToCanonical(stream: string, raw: RawRecord): CanonicalBatch {
  if (stream === "adset_daily") return mapEntities("ad_group", raw);
  if (stream === "ad_daily") return mapEntities("ad", raw);
  if (stream !== "campaign_daily") {
    return { target: "ad_performance", rows: [] };
  }

  const page = insightsPageSchema.parse(raw.payload);

  const rows: CanonicalAdPerfRow[] = (page.data ?? []).map((row) => {
    const campaignId = row.campaign_id;
    const date = row.date_start;
    // Chave natural incompleta = contrato da API quebrou. Falha alto — não inventa
    // id/data nem descarta linha em silêncio.
    if (!campaignId || !date) {
      throw new Error("Meta Ads: linha sem campaign_id ou date_start — resposta fora do contrato.");
    }

    const conversionActions = actionsByType(row.actions, META_CONVERSION_ACTION_TYPES);
    const valueActions = actionsByType(row.action_values, META_VALUE_ACTION_TYPES);

    const base = {
      date,
      campaignId,
      campaignName: row.campaign_name?.trim() ?? "",
      // a Insights não traz o status da campanha — e inventá-lo seria pior que deixar vazio
      campaignStatus: "",
      adNetwork: "",
      impressions: toInt(row.impressions),
      clicks: toInt(row.inline_link_clicks),
      cost: round4(toNum(row.spend)),
      conversions: sumValues(conversionActions),
      conversionValue: sumValues(valueActions),
      impressionShare: null,
      budgetLostIs: null,
      rankLostIs: null,
      currency: row.account_currency ?? null,
      dims: {
        objective: row.objective ?? null,
        allClicks: toInt(row.clicks),
        reach: toInt(row.reach),
        frequency: row.frequency !== undefined ? round4(toNum(row.frequency)) : null,
        conversionActions,
      } as Record<string, unknown>,
    };

    return { ...base, sourceHash: rowHash(base) };
  });

  return { target: "ad_performance", rows };
}
