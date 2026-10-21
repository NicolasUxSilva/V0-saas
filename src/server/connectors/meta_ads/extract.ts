/**
 * Extração do Meta Ads via Marketing API Insights.
 *
 * `GET /{act_id}/insights` com `time_increment=1`: `level=campaign` (stream obrigatório,
 * grão campanha × dia, o MESMO do Google Ads) e, desde a área Campanhas (Fase 1), os
 * streams OPCIONAIS de detalhe `level=adset` (conjunto × dia) e `level=ad` (anúncio ×
 * dia) — ainda sem posicionamento nem demografia. Um `RawRecord` = uma página de
 * resultados, append-only em `raw_records` e replayável.
 *
 * Decisões:
 *  - o período é fatiado em janelas de 31 dias: o Insights recusa consultas grandes
 *    demais (erro 100/1487534) e uma janela por vez mantém cada chamada pequena;
 *  - paginação por CURSOR (`paging.cursors.after`), nunca pela URL `paging.next` — ela
 *    ecoa o `access_token` na query. O payload guardado em `raw_records` é SANEADO
 *    (`paging` sem `next`/`previous`): token nenhum vai para o banco;
 *  - datas (`date_start`) já vêm no fuso da conta de anúncios, o mesmo de
 *    `connection_properties.timezone` que o `run-sync` usa para montar a janela.
 */
import { createHash } from "node:crypto";

import { addDays } from "@/lib/dates";
import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { metaFetch } from "./http";
import { insightsPageSchema } from "./schema";

/** Teto de segurança de linhas por sync (mesma ordem de grandeza do Google Ads). */
export const MAX_META_ROWS = 2_000_000;
/** Dias por chamada (janela fatiada). */
export const CHUNK_DAYS = 31;
/** Linhas por página de Insights. */
export const PAGE_LIMIT = 500;

/** Campos pedidos — o que o `mapping.ts` lê e mais nada. */
const FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective",
  "date_start",
  "date_stop",
  "account_currency",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "spend",
  "actions",
  "action_values",
].join(",");

/** Campos extras dos níveis de detalhe (alcance/frequência ficam de fora: não são aditivos). */
const DETAIL_BASE = [
  "account_id",
  "campaign_id",
  "adset_id",
  "adset_name",
  "objective",
  "date_start",
  "date_stop",
  "account_currency",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "spend",
  "actions",
  "action_values",
];

/** stream → nível do Insights e campos. */
const LEVELS: Record<string, { level: string; fields: string }> = {
  campaign_daily: { level: "campaign", fields: FIELDS },
  adset_daily: { level: "adset", fields: DETAIL_BASE.join(",") },
  ad_daily: { level: "ad", fields: [...DETAIL_BASE, "ad_id", "ad_name"].join(",") },
};

/** `act_123456789` → caminho do edge de Insights. Rejeita qualquer outra forma. */
export function insightsPath(externalId: string): string {
  if (!/^act_\d+$/.test(externalId)) {
    throw new Error(
      `Conta do Meta Ads inválida: "${externalId}". Selecione uma conta de anúncios válida em Conexões antes de importar.`,
    );
  }
  return `/${externalId}/insights`;
}

/** [since, until] (inclusivo) → janelas consecutivas de até `days` dias. */
export function splitWindow(
  since: string,
  until: string,
  days = CHUNK_DAYS,
): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  for (let start = since; start <= until; start = addDays(start, days)) {
    const end = addDays(start, days - 1);
    out.push({ since: start, until: end < until ? end : until });
  }
  return out;
}

/** O payload que vai para `raw_records`: sem `paging.next`/`previous` (carregam o token). */
export function sanitizePage(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const { paging, ...rest } = payload as { paging?: { cursors?: unknown } };
  return paging?.cursors ? { ...rest, paging: { cursors: paging.cursors } } : rest;
}

export async function* pull(args: PullArgs): AsyncIterable<RawRecord> {
  const spec = LEVELS[args.stream];
  if (!spec) {
    throw new Error(`Stream desconhecido no conector Meta Ads: ${args.stream}`);
  }

  const path = insightsPath(args.account.externalId);
  let fetched = 0;

  for (const win of splitWindow(args.since, args.until)) {
    let after: string | undefined;
    let pageNo = 0;

    do {
      const payload = await metaFetch(path, {
        accessToken: args.access.accessToken,
        params: {
          level: spec.level,
          time_increment: "1",
          time_range: JSON.stringify({ since: win.since, until: win.until }),
          fields: spec.fields,
          limit: String(PAGE_LIMIT),
          ...(after ? { after } : {}),
        },
      });

      const page = insightsPageSchema.parse(payload);
      fetched += page.data?.length ?? 0;

      const safe = sanitizePage(payload);
      yield {
        stream: args.stream,
        externalId: `${args.account.externalId}:${win.since}:${win.until}:${pageNo}`,
        occurredOn: null,
        payload: safe,
        sourceHash: createHash("sha256").update(JSON.stringify(safe)).digest("hex"),
      };

      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      pageNo += 1;
    } while (after && fetched < MAX_META_ROWS);

    if (fetched >= MAX_META_ROWS) break;
  }
}
