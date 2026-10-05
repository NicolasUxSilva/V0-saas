/**
 * Fábricas de payload sintético da API v2 do RD Station CRM para os testes do
 * conector — shape de `GET /crm/v2/deals`.
 */
export interface FakeDealOpts {
  id?: string;
  status?: "won" | "lost" | "ongoing" | "paused";
  totalPrice?: number | null;
  pipelineId?: string | null;
  stageId?: string | null;
  sourceId?: string | null;
  campaignId?: string | null;
  lostReasonId?: string | null;
  contactIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
  omitId?: boolean;
  omitCreatedAt?: boolean;
  omitUpdatedAt?: boolean;
}

export function fakeDeal(opts: FakeDealOpts = {}): Record<string, unknown> {
  const deal: Record<string, unknown> = {
    name: "Negociação de teste", // nunca deve aparecer na linha canônica
    status: opts.status ?? "ongoing",
    total_price: opts.totalPrice === undefined ? 1000 : opts.totalPrice,
    pipeline_id: opts.pipelineId === undefined ? "pipeline-1" : opts.pipelineId,
    stage_id: opts.stageId === undefined ? "stage-1" : opts.stageId,
    source_id: opts.sourceId === undefined ? "source-1" : opts.sourceId,
    campaign_id: opts.campaignId === undefined ? "campaign-1" : opts.campaignId,
    lost_reason_id: opts.lostReasonId === undefined ? null : opts.lostReasonId,
    contact_ids: opts.contactIds ?? ["contact-1"],
    closed_at: opts.closedAt === undefined ? null : opts.closedAt,
  };
  if (!opts.omitId) deal.id = opts.id ?? "650878567482d9c0c7002050";
  if (!opts.omitCreatedAt) deal.created_at = opts.createdAt ?? "2026-08-01T12:00:00Z";
  if (!opts.omitUpdatedAt) deal.updated_at = opts.updatedAt ?? "2026-08-01T12:00:00Z";
  return deal;
}

export function fakeDealsPage(
  deals: Array<Record<string, unknown>>,
  next?: string | null,
): Record<string, unknown> {
  return {
    data: deals,
    links: {
      self: "https://api.rd.services/crm/v2/deals?page=1",
      ...(next ? { next } : {}),
    },
  };
}

// ── links de paginação no FORMATO REAL da API ───────────────────────────────
// Capturados da resposta real do `GET /crm/v2/deals` (conta piloto, 2026-10-04),
// já com o `sort` que o conector envia. A API devolve `links.{first,self,next,
// last}` com o prefixo INTERNO `/api/v2/` — que o gateway público NÃO roteia
// (404 `no Route matched with those values`); só `/crm/v2/` funciona. Os
// fixtures anteriores a esta captura usavam `/crm/v2/` nos links, e por isso o
// bug de paginação passou despercebido.

/** Filtro RDQL de `updated_at` exatamente como a API o codifica nos links. */
const REAL_FILTER_QS =
  "filter=updated_at%3A%3E%3D%222026-04-07+00%3A00%3A00%22+updated_at%3A%3C%3D%222026-10-04+23%3A59%3A59%22";

/** filtro + ordenação (`sort[updated_at]=asc`, reproduzida pela API nos links) + paginação. */
const pageQs = (n: number) =>
  `${REAL_FILTER_QS}&sort%5Bupdated_at%5D=asc&page%5Bnumber%5D=${n}&page%5Bsize%5D=25`;

/** Link como a API REALMENTE devolve (prefixo interno, não roteável). */
export const internalPageLink = (n: number) =>
  `https://api.rd.services/api/v2/deals?${pageQs(n)}`;

/** O mesmo link na raiz pública — o único que o gateway roteia. */
export const publicPageLink = (n: number) =>
  `https://api.rd.services/crm/v2/deals?${pageQs(n)}`;
