/**
 * Conector Meta Ads (Marketing API): OAuth + descoberta de contas de anúncios + extração
 * de Insights + mapeamento canônico.
 *
 * Grão campanha × dia → `fact_ad_performance_daily` (`platform = 'meta_ads'`, a MESMA
 * tabela do Google Ads, separada pela plataforma). Detalhe opcional (área Campanhas):
 * conjunto × dia e anúncio × dia → `fact_ad_entity_daily`. Somente leitura (`ads_read`).
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
  { id: "adset_daily", label: "Desempenho de conjunto de anúncios por dia", optional: true },
  { id: "ad_daily", label: "Desempenho de anúncio por dia", optional: true },
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
