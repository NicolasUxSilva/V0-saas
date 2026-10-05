/**
 * Mapeamento RD Station CRM → camada canônica (bloco RD-1E).
 *
 * Uma página de `/crm/v2/deals` → N `CanonicalDealRow` (uma por negociação —
 * SEM agregação; ver o comentário em `db/schema.ts` sobre `factDeals` para o
 * porquê do grão ser por deal e não por dia). Determinístico e idempotente.
 *
 * Sem PII (RD-1): `name` da negociação e `contact_ids` NÃO são lidos aqui —
 * só IDs técnicos (pipeline/stage/source/campaign/lost reason) e números.
 * `owner_id` também fica de fora por não ser necessário ainda (fácil de somar
 * depois, sem migração, via `dims`).
 */
import { createHash } from "node:crypto";

import type {
  CanonicalBatch,
  CanonicalDealRow,
  RawRecord,
} from "@/server/connectors/types";

import { dealsPageSchema, type DealRow } from "./schema";

/** ISO 8601 (UTC, conforme a introdução da API v2) → só a parte da data. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function rowHash(r: Omit<CanonicalDealRow, "sourceHash">): string {
  const key = [
    r.dealId,
    r.status,
    r.totalPrice,
    r.pipelineId,
    r.stageId,
    r.sourceId,
    r.campaignId,
    r.lostReasonId,
    r.dealCreatedAt,
    r.dealUpdatedAt,
    r.dealClosedAt,
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

export function mapToCanonical(stream: string, raw: RawRecord): CanonicalBatch {
  if (stream !== "deals") {
    return { target: "opportunities", rows: [] };
  }

  const page = dealsPageSchema.parse(raw.payload);

  const rows: CanonicalDealRow[] = (page.data ?? []).map((row: DealRow) => {
    // Chave natural incompleta = contrato da API quebrou — falha alto, não
    // inventa id nem descarta a linha em silêncio (mesmo princípio do G3).
    if (!row.id || !row.created_at || !row.updated_at) {
      throw new Error(
        "RD Station CRM: negociação sem id/created_at/updated_at — resposta fora do contrato.",
      );
    }

    const base = {
      dealId: row.id,
      status: row.status ?? "",
      totalPrice: row.total_price ?? 0,
      pipelineId: row.pipeline_id ?? "",
      stageId: row.stage_id ?? "",
      sourceId: row.source_id ?? "",
      campaignId: row.campaign_id ?? "",
      lostReasonId: row.lost_reason_id ?? "",
      // Data do FATO (abertura) — nunca `updated_at`.
      dealCreatedAt: dateOnly(row.created_at),
      // Só bookkeeping de sync (RDQL incremental) — nunca usada como data de
      // um fato em `context.ts` ou em qualquer agregação futura.
      dealUpdatedAt: row.updated_at,
      // Data do FATO (fechamento) — null enquanto ongoing/paused.
      dealClosedAt: row.closed_at ? dateOnly(row.closed_at) : null,
      dims: null as Record<string, unknown> | null,
    };

    return { ...base, sourceHash: rowHash(base) };
  });

  return { target: "opportunities", rows };
}
