/**
 * Extração do RD Station Marketing via `GET /platform/analytics/conversions`
 * (bloco RD-1C) — "Estatísticas dos Ativos de Conversão", disponível nos
 * planos Pro e Advanced (a conta piloto MS Server é Pro — ver relatório RD-1;
 * a "Estatísticas do Funil de Vendas", rica em lead/oportunidade/venda, exige
 * Advanced e NÃO é usada aqui).
 *
 * O endpoint NÃO devolve série diária (sem `reference_day` na resposta, ao
 * contrário do funil de vendas) — cada chamada é um TOTAL por ativo no período
 * pedido. Por isso o `pull` chama a API uma vez por dia (`start_date=end_date`)
 * para que cada `RawRecord` já corresponda a exatamente um dia, sem precisar
 * agregar nós mesmos entre chamadas.
 *
 * Limite real de plano (não arbitrário): "Plano Pro tem limite de consulta dos
 * últimos 45 dias" (doc oficial) — `MAX_HISTORY_DAYS` é esse teto, aplicado
 * aqui dentro independente da janela que `run-sync.ts` pedir (mesmo espírito
 * do `MAX_ADS_ROWS` do conector Google Ads: cada conector protege seu próprio
 * limite, não herda o de outro).
 */
import { createHash } from "node:crypto";

import { addDays, maxDate } from "@/lib/dates";
import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { rdMarketingFetch } from "./http";
import { conversionAssetsResponseSchema } from "./schema";

/** Teto do plano Pro (ver cabeçalho do arquivo) — Advanced não tem teto, mas
 * esta conta é Pro; reconfirmar se um dia o plano mudar. */
export const MAX_HISTORY_DAYS = 45;

export async function* pull(args: PullArgs): AsyncIterable<RawRecord> {
  if (args.stream !== "conversion_assets_daily") {
    throw new Error(
      `Stream desconhecido no conector RD Station Marketing: ${args.stream}`,
    );
  }

  // Clamp ao teto do plano Pro — `since` pode vir de mais longe (o HISTORY_DAYS
  // genérico do run-sync é 180), mas este conector nunca consulta além dos
  // últimos 45 dias a partir de `until`.
  const earliestAllowed = addDays(args.until, -(MAX_HISTORY_DAYS - 1));
  const effectiveSince = maxDate(args.since, earliestAllowed);

  let cursor = effectiveSince;
  while (cursor <= args.until) {
    const day = cursor;
    const payload = await rdMarketingFetch(
      `/platform/analytics/conversions?start_date=${day}&end_date=${day}`,
      { method: "GET" },
      args.access.accessToken,
    );

    // Valida a forma aqui (fail-fast por dia) — o mapping confia nesse shape.
    conversionAssetsResponseSchema.parse(payload);

    yield {
      stream: "conversion_assets_daily",
      externalId: `rd_station_marketing:${day}`,
      occurredOn: day,
      payload,
      sourceHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    };

    cursor = addDays(cursor, 1);
  }
}
