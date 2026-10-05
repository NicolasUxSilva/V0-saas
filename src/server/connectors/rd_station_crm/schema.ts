/**
 * Validação Zod da resposta de `GET /crm/v2/deals` (RD Station CRM, bloco
 * RD-1E). Só valida a FORMA; a interpretação (o que vira coluna, o que fica de
 * fora por ser PII/desnecessário) é do `mapping.ts`.
 */
import { z } from "zod";

export const dealStatusSchema = z.enum(["won", "lost", "ongoing", "paused"]);

// `id`/`created_at`/`updated_at` são opcionais AQUI de propósito — mesmo
// padrão do conector Google Ads (`campaign.id`/`segments.date` em
// `google_ads/schema.ts`): o Zod só valida a FORMA; é `mapping.ts` quem decide
// que a ausência desses três campos é "resposta fora do contrato" e lança com
// uma mensagem própria, mais clara que o erro genérico do Zod.
const dealSchema = z.object({
  id: z.string().optional(),
  // `name` existe na API mas NÃO é lido pelo mapping (RD-1 pede para não
  // promover o título da negociação, que é texto livre, a dado canônico).
  status: dealStatusSchema.optional(),
  total_price: z.number().nullish(),
  pipeline_id: z.string().nullish(),
  stage_id: z.string().nullish(),
  owner_id: z.string().nullish(),
  source_id: z.string().nullish(),
  campaign_id: z.string().nullish(),
  lost_reason_id: z.string().nullish(),
  organization_id: z.string().nullish(),
  contact_ids: z.array(z.string()).nullish(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  closed_at: z.string().nullish(),
});

const linksSchema = z
  .object({
    first: z.string().optional(),
    prev: z.string().nullish(),
    self: z.string().optional(),
    next: z.string().nullish(),
    last: z.string().optional(),
  })
  .optional();

export const dealsPageSchema = z.object({
  data: z.array(dealSchema).optional(),
  links: linksSchema,
});

export type DealsPage = z.infer<typeof dealsPageSchema>;
export type DealRow = z.infer<typeof dealSchema>;

/** Streams do conector RD Station CRM e seus schemas. */
export const schemas = { deals: dealsPageSchema } as const;
