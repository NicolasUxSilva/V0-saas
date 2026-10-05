/**
 * Extração do RD Station CRM via `GET /crm/v2/deals` (bloco RD-1E).
 *
 * Incremental por RDQL em `updated_at` — `since`/`until` (os mesmos parâmetros
 * genéricos de qualquer conector, vindos de `run-sync.ts`) viram o filtro
 * `updated_at:>=since updated_at<=until`. Importante (ver RD-1 / docs): isso
 * filtra QUAIS negociações buscar, não QUANDO elas aconteceram — uma
 * negociação aberta há 300 dias e fechada hoje tem `updated_at` de hoje, mas
 * `created_at` de 300 dias atrás; `mapping.ts` preserva as duas datas
 * separadas, nunca usa `updated_at` como data de um fato.
 *
 * Paginação: segue `links.next` da própria resposta em vez de reconstruir os
 * parâmetros de página; só a primeira página usa o `filter` montado aqui, as
 * seguintes repetem a query que a API devolveu (`page[number]`/`page[size]`,
 * 25 por página — confirmado com a conta real em 2026-10-04).
 *
 * ATENÇÃO: a API devolve esses links com o prefixo INTERNO `/api/v2/deals`, que
 * o gateway público não roteia (404 `no Route matched`). Por isso o link nunca
 * é chamado como veio: `rdCrmFetch` o reancora em `/crm/v2/...` via
 * `resolveCrmUrl` (ver `./http`) — a 1ª importação real quebrou na página 2
 * justamente por seguir o link cru.
 */
import { createHash } from "node:crypto";

import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { rdCrmFetch } from "./http";
import { dealsPageSchema } from "./schema";

/** Válvula de segurança — nenhum workspace piloto chega perto disto. */
const MAX_PAGES = 1000;

function buildUpdatedAtFilter(since: string, until: string): string {
  // Formato DateTime da RDQL tal como documentado (string entre aspas, com
  // espaço) — ver developers.rdstation.com/reference/crm-v2-rdql-filtering.
  // CONFIRMADO com a conta real (2026-10-04): a API aceita esta sintaxe (200) e
  // a ecoa de volta, codificada, nos links de paginação.
  return `updated_at:>="${since} 00:00:00" updated_at:<="${until} 23:59:59"`;
}

export async function* pull(args: PullArgs): AsyncIterable<RawRecord> {
  if (args.stream !== "deals") {
    throw new Error(`Stream desconhecido no conector RD Station CRM: ${args.stream}`);
  }

  const filter = buildUpdatedAtFilter(args.since, args.until);
  // Ordenação EXPLÍCITA por `updated_at` ascendente — sintaxe documentada em
  // developers.rdstation.com/reference/crm-v2-introduction (`sort[propriedade]=
  // asc|desc`; `updated_at` é ordenável em `deals`). Sem ela a API devolve uma
  // ordem NÃO determinística: em 2026-10-04 a MESMA página 1, pedida duas vezes
  // seguidas, voltou com listas diferentes, e a lista não vinha ordenada por
  // nenhum campo — paginar assim pode pular negociações, e o upsert por
  // `deal_id` não protege disso (o que não chega, não é gravado). A doc diz que
  // os links de paginação reproduzem `filter`, `sort` e `page`; só a 1ª URL
  // precisa levar o sort.
  let nextUrl: string | null =
    `/deals?filter=${encodeURIComponent(filter)}&sort%5Bupdated_at%5D=asc`;
  let pageNo = 0;

  while (nextUrl && pageNo < MAX_PAGES) {
    const payload = await rdCrmFetch(nextUrl, { method: "GET" }, args.access.accessToken);
    const page = dealsPageSchema.parse(payload);

    yield {
      stream: "deals",
      externalId: `rd_station_crm:${args.since}:${args.until}:${pageNo}`,
      occurredOn: null,
      payload,
      sourceHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    };

    nextUrl = page.links?.next ?? null;
    pageNo += 1;
  }
}
