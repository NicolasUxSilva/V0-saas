/**
 * Validação Zod das respostas da Marketing API do Meta Ads. Não confiar no shape de
 * uma resposta externa (§12 da arquitetura V1): aqui só se valida a FORMA; a
 * interpretação (texto → número, ausência → 0 ou `null`) é do `mapping.ts`, como nos
 * demais conectores.
 *
 * A Graph API devolve quase todo número como STRING ("12345", "5339.50"), e OMITE o
 * campo quando o valor é zero ou não se aplica — por isso tudo é opcional e aceita
 * `string | number`.
 */
import { z } from "zod";

const wireNumber = z.union([z.string(), z.number()]);

/** `{ action_type: "lead", value: "3" }` — usado por `actions` e `action_values`. */
const actionStat = z.object({
  action_type: z.string(),
  value: wireNumber.optional(),
});

export const insightRowSchema = z.object({
  account_id: z.string().optional(),
  campaign_id: z.string().optional(),
  campaign_name: z.string().optional(),
  /** só nos níveis `adset` e `ad` */
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  /** só no nível `ad` */
  ad_id: z.string().optional(),
  ad_name: z.string().optional(),
  objective: z.string().optional(),
  /** "YYYY-MM-DD" no fuso da conta de anúncios */
  date_start: z.string().optional(),
  date_stop: z.string().optional(),
  account_currency: z.string().optional(),
  impressions: wireNumber.optional(),
  /** todos os cliques (inclui curtidas, comentários…) */
  clicks: wireNumber.optional(),
  /** cliques no link do anúncio — o equivalente ao clique do Google Ads */
  inline_link_clicks: wireNumber.optional(),
  spend: wireNumber.optional(),
  reach: wireNumber.optional(),
  frequency: wireNumber.optional(),
  actions: z.array(actionStat).optional(),
  action_values: z.array(actionStat).optional(),
});

const pagingSchema = z
  .object({
    cursors: z.object({ before: z.string().optional(), after: z.string().optional() }).optional(),
    next: z.string().optional(),
  })
  .optional();

/** Uma página da resposta de `/{act_id}/insights` (campanha × dia). */
export const insightsPageSchema = z.object({
  data: z.array(insightRowSchema).optional(),
  paging: pagingSchema,
});

export type InsightsPage = z.infer<typeof insightsPageSchema>;
export type InsightRow = z.infer<typeof insightRowSchema>;

/** Uma página da resposta de `/me/adaccounts`. */
export const adAccountsPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      account_id: z.string().optional(),
      name: z.string().optional(),
      currency: z.string().optional(),
      timezone_name: z.string().optional(),
      account_status: z.number().optional(),
    }),
  ),
  paging: pagingSchema,
});

/** Streams do conector Meta Ads e seus schemas. */
export const schemas = {
  campaign_daily: insightsPageSchema,
  adset_daily: insightsPageSchema,
  ad_daily: insightsPageSchema,
} as const;
