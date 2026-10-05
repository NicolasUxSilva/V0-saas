/**
 * Mapeamento RD Station Marketing → camada canônica (bloco RD-1C).
 *
 * Uma resposta de `/platform/analytics/conversions` (um dia — ver `extract.ts`)
 * → N `CanonicalConversionAssetRow` (uma por ativo). Determinístico e
 * idempotente: a mesma resposta produz sempre as mesmas linhas e o mesmo
 * `source_hash`, que o `normalize` usa para o upsert em
 * `fact_conversion_assets_daily`.
 *
 * Sem PII: a resposta não traz dado de contato/lead, só contagens por ativo.
 */
import { createHash } from "node:crypto";

import type {
  CanonicalBatch,
  CanonicalConversionAssetRow,
  RawRecord,
} from "@/server/connectors/types";

import {
  conversionAssetsResponseSchema,
  type AssetConversionRow,
} from "./schema";

function toInt(v: string | number | null | undefined): number {
  const n = Math.trunc(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/** 0..1 — `null` quando a fonte não reporta (NÃO 0; ver §12 do GA4/Ads, mesmo princípio). */
function toRatioOrNull(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowHash(r: Omit<CanonicalConversionAssetRow, "sourceHash">): string {
  const key = [
    r.date,
    r.assetId,
    r.assetIdentifier,
    r.assetType,
    r.visits,
    r.conversions,
    r.conversionRate,
  ];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}

export function mapToCanonical(stream: string, raw: RawRecord): CanonicalBatch {
  if (stream !== "conversion_assets_daily") {
    return { target: "conversion_assets", rows: [] };
  }

  const page = conversionAssetsResponseSchema.parse(raw.payload);
  // `extract.ts` sempre grava `occurredOn` (o dia da chamada); `query_date`
  // serve só como checagem de sanidade — se divergirem, confia no `occurredOn`
  // (é o que o nosso próprio `pull` pediu), nunca inventa uma 3ª data.
  const date = raw.occurredOn ?? page.query_date?.start_date;
  if (!date) {
    throw new Error(
      "RD Station Marketing: resposta de /platform/analytics/conversions sem data — contrato quebrado.",
    );
  }

  const rows: CanonicalConversionAssetRow[] = (page.conversions ?? []).map(
    (row: AssetConversionRow) => {
      const assetId = row.asset_id;
      if (assetId == null) {
        throw new Error(
          "RD Station Marketing: linha de conversão sem asset_id — resposta fora do contrato.",
        );
      }
      const base = {
        date,
        assetId: String(assetId),
        assetIdentifier: row.asset_identifier?.trim() ?? "",
        // `assets_type` e `conversion_count` são os nomes da API REAL — a doc
        // oficial diz `asset_type`/`conversions_count`, que a API não devolve
        // (ver o comentário em `schema.ts`).
        assetType: row.assets_type ?? "",
        visits: toInt(row.visits_count),
        conversions: toInt(row.conversion_count),
        conversionRate: toRatioOrNull(row.conversion_rate),
        dims: null as Record<string, unknown> | null,
      };
      return { ...base, sourceHash: rowHash(base) };
    },
  );

  return { target: "conversion_assets", rows };
}
