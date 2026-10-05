/**
 * Validação Zod da resposta de `GET /platform/analytics/conversions`
 * (RD Station Marketing, bloco RD-1C) — "Estatísticas dos Ativos de Conversão",
 * disponível nos planos Pro e Advanced.
 *
 * Só valida a FORMA; a interpretação (o que vira coluna, o que é `dims`) é do
 * `mapping.ts`, no mesmo espírito do conector Google Ads.
 */
import { z } from "zod";

// `asset_id` é opcional AQUI de propósito — mesmo padrão do conector Google
// Ads: o Zod só valida a FORMA; `mapping.ts` decide que a ausência é "resposta
// fora do contrato" e lança com mensagem própria.
//
// NOMES = os da API REAL, não os da documentação oficial. A doc do endpoint
// publica `asset_type` e `conversions_count` em cada linha; a API devolve
// `assets_type` (string, ex. "LandingPage") e `conversion_count` (number) —
// CONFIRMADO nas 90 linhas reais da conta piloto (45 respostas diárias × 2
// ativos, 2026-08-21 → 2026-10-04): os nomes da doc não aparecem em nenhuma.
// Não é detalhe estético: `z.object` DESCARTA chaves não declaradas, então
// declarar o nome da doc apaga o campo real antes de o mapping vê-lo — foi assim
// que `asset_type` ficou "" e as conversões ficariam 0 mesmo se a fonte as
// reportasse. (`visits_count` e `conversion_rate` estão corretos.)
const assetConversionRowSchema = z.object({
  asset_id: z.union([z.string(), z.number()]).optional(),
  asset_identifier: z.string().optional(),
  assets_type: z.string().optional(),
  asset_created_at: z.string().optional(),
  asset_updated_at: z.string().optional(),
  visits_count: z.union([z.string(), z.number()]).optional(),
  conversion_count: z.union([z.string(), z.number()]).optional(),
  conversion_rate: z.union([z.string(), z.number()]).nullish(),
});

/**
 * Uma resposta do endpoint — como o RD-1 chama com `start_date=end_date=<dia>`
 * (ver extract.ts), `query_date` já identifica o único dia desta resposta.
 */
export const conversionAssetsResponseSchema = z.object({
  account_id: z.union([z.string(), z.number()]).optional(),
  query_date: z
    .object({
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    })
    .optional(),
  assets_type: z.array(z.string()).optional(),
  conversions: z.array(assetConversionRowSchema).optional(),
});

export type ConversionAssetsResponse = z.infer<
  typeof conversionAssetsResponseSchema
>;
export type AssetConversionRow = z.infer<typeof assetConversionRowSchema>;

/** Streams do conector RD Station Marketing e seus schemas. */
export const schemas = {
  conversion_assets_daily: conversionAssetsResponseSchema,
} as const;
