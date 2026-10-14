/**
 * Conector Meta Ads (Marketing API): OAuth + descoberta de contas de anúncios + extração
 * de Insights + mapeamento canônico.
 *
 * Grão campanha × dia (INV-13). Escreve em `fact_ad_performance_daily`
 * (`platform = 'meta_ads'`) via `CanonicalBatch { target: "ad_performance" }` — a MESMA
 * tabela do Google Ads, separada pela plataforma. Somente leitura (`ads_read`).
 */
import type { Connector, ConnectorMeta, StreamDef } from "@/server/connectors/types";

import { listAccounts } from "./discovery";
import { pull } from "./extract";
import { mapToCanonical } from "./mapping";
import { META_ADS_SCOPES, buildAuthUrl, exchangeCode, refreshTokens } from "./oauth";
import { schemas } from "./schema";

const meta: ConnectorMeta = {
  provider: "meta_ads",
  name: "Meta Ads",
  authType: "oauth2",
  scopes: [...META_ADS_SCOPES],
  docsUrl: "https://developers.facebook.com/docs/marketing-apis",
  // A Meta retifica a atribuição por até 28 dias: syncs incrementais re-puxam esse tanto.
  restatementWindowDays: 28,
  rateLimit: { requestsPerSecond: 2, concurrency: 1 },
  // Token de longa duração (~60 dias), sem refresh token: expirou → reautorizar.
  refreshTokenRequired: false,
};

const streams: readonly StreamDef[] = [
  { id: "campaign_daily", label: "Desempenho de campanha por dia" },
];

export const metaAdsConnector: Connector = {
  meta,
  streams,
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
  listAccounts,
  pull,
  schemas,
  mapToCanonical,
};
