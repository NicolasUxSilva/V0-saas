/**
 * Validação Zod das respostas da Google Ads API (`googleAds:search`) — bloco G3.
 * Não confiar no shape da resposta externa (§12 da arquitetura V1).
 *
 * Aqui só se valida a FORMA (campos, tipos crus do JSON REST). A interpretação
 * — micros → dinheiro, string → número, ausência → `null` vs `0` — é feita no
 * `mapping.ts`, do mesmo jeito que o conector GA4 separa schema de mapping.
 *
 * No REST, inteiros de 64 bits (`impressions`, `clicks`, `cost_micros`,
 * `campaign_budget.amount_micros`) chegam como **string**; `conversions`,
 * `conversions_value` e as métricas de impression share chegam como número.
 * Aceitamos `string | number` em tudo que é numérico para tolerar variação.
 */
import { z } from "zod";

/** Numérico "de fio" — string (int64) ou number (double). */
const wireNumber = z.union([z.string(), z.number()]);

const campaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  advertisingChannelType: z.string().optional(),
});

const metricsSchema = z.object({
  impressions: wireNumber.optional(),
  clicks: wireNumber.optional(),
  costMicros: wireNumber.optional(),
  conversions: wireNumber.optional(),
  conversionsValue: wireNumber.optional(),
  // Impression share: ausente para tipos de campanha / volumes que a Google não
  // reporta. `.nullish()` → pode vir ausente OU null; o mapping decide 0 vs null.
  searchImpressionShare: wireNumber.nullish(),
  searchBudgetLostImpressionShare: wireNumber.nullish(),
  searchRankLostImpressionShare: wireNumber.nullish(),
});

const rowSchema = z.object({
  customer: z
    .object({
      id: z.string().optional(),
      currencyCode: z.string().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
  campaign: campaignSchema.optional(),
  campaignBudget: z.object({ amountMicros: wireNumber.optional() }).optional(),
  segments: z.object({ date: z.string().optional() }).optional(),
  metrics: metricsSchema.optional(),
});

/** Uma página da resposta de `googleAds:search` (campanha × dia). */
export const adsSearchPageSchema = z.object({
  results: z.array(rowSchema).optional(),
  nextPageToken: z.string().optional(),
  totalResultsCount: wireNumber.optional(),
});

export type AdsSearchPage = z.infer<typeof adsSearchPageSchema>;
export type AdsSearchRow = z.infer<typeof rowSchema>;

/** Streams do conector Google Ads e seus schemas. */
export const schemas = { campaign_daily: adsSearchPageSchema } as const;
