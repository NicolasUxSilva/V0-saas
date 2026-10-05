/**
 * Extração do Google Ads via `GoogleAdsService.search` (bloco G3).
 *
 * GAQL campanha × dia (INV-13 — sem ad_group / keyword / query). Um `RawRecord`
 * = uma página de resultados (JSON inteiro), append-only em `raw_records` e
 * replayável. Paginação por `nextPageToken`; a janela e o customer vêm de quem
 * chama (`run-sync` → conta selecionada em `connection_properties`).
 *
 * O developer token é opcional/legado (ver `./http`): sem
 * `GOOGLE_ADS_DEVELOPER_TOKEN` a requisição segue normalmente, sem o header.
 */
import { createHash } from "node:crypto";

import type { PullArgs, RawRecord } from "@/server/connectors/types";

import { adsFetch } from "./http";
import { adsSearchPageSchema } from "./schema";

// Tamanho de página: fixo em 10.000 linhas pela própria API. NÃO enviar `pageSize`
// no corpo — o campo `page_size` está deprecado e a Google Ads API devolve
// `PAGE_SIZE_NOT_SUPPORTED` se ele vier no `SearchGoogleAdsRequest`.

/**
 * Teto de segurança **específico do Google Ads** (§11 da arquitetura V1). Uma
 * conta em grão campanha × dia por 180 dias não chega perto disto (uma conta
 * com 100 campanhas ≈ 18 mil linhas). Acima do teto o `pull` para — mesma
 * semântica de "parcial" do GA4, sem herdar o `MAX_TOTAL_ROWS` (500k) dele.
 */
export const MAX_ADS_ROWS = 2_000_000;

/** Campos da GAQL — campanha × dia. Ver docs/v1-architecture.md §10.3. */
const SELECT_FIELDS = [
  "customer.id",
  "customer.currency_code",
  "customer.time_zone",
  "campaign.id",
  "campaign.name",
  "campaign.status",
  "campaign.advertising_channel_type",
  "campaign_budget.amount_micros",
  "segments.date",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
  "metrics.search_impression_share",
  "metrics.search_budget_lost_impression_share",
  "metrics.search_rank_lost_impression_share",
].join(", ");

function buildQuery(since: string, until: string): string {
  // `since`/`until` são "YYYY-MM-DD" derivados no fuso da conta (run-sync);
  // não vêm de input do usuário.
  return (
    `SELECT ${SELECT_FIELDS} FROM campaign ` +
    `WHERE segments.date BETWEEN '${since}' AND '${until}' ` +
    `ORDER BY segments.date ASC, campaign.id ASC`
  );
}

/** "customers/123-456" | "customers/123456" → "123456". */
function customerIdFromExternalId(externalId: string): string {
  const digits = externalId.replace(/^customers\//, "").replace(/\D/g, "");
  if (!digits) {
    throw new Error(
      `Conta do Google Ads sem customer id numérico: "${externalId}". ` +
        "Selecione uma conta válida em Conexões antes de importar.",
    );
  }
  return digits;
}

export async function* pull(args: PullArgs): AsyncIterable<RawRecord> {
  if (args.stream !== "campaign_daily") {
    throw new Error(`Stream desconhecido no conector Google Ads: ${args.stream}`);
  }

  const customerId = customerIdFromExternalId(args.account.externalId);
  const loginCustomerId =
    typeof args.access.meta?.loginCustomerId === "string"
      ? args.access.meta.loginCustomerId
      : undefined;
  const query = buildQuery(args.since, args.until);

  let pageToken: string | undefined;
  let fetched = 0;
  let pageNo = 0;

  do {
    const payload = await adsFetch(
      `/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        body: JSON.stringify({
          query,
          ...(pageToken ? { pageToken } : {}),
        }),
      },
      args.access.accessToken,
      loginCustomerId,
    );

    const page = adsSearchPageSchema.parse(payload);
    fetched += page.results?.length ?? 0;

    yield {
      stream: "campaign_daily",
      externalId: `customers/${customerId}:${args.since}:${args.until}:${pageNo}`,
      occurredOn: null,
      payload,
      sourceHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
    };

    pageToken = page.nextPageToken;
    pageNo += 1;
  } while (pageToken && fetched < MAX_ADS_ROWS);
}
