/**
 * Conector Google Ads completo (G2 auth + discovery · G3 extract + mapping).
 *
 * Grão campanha × dia (INV-13). Escreve em `fact_ad_performance_daily` via
 * `CanonicalBatch { target: "ad_performance" }`.
 */
import type {
  Connector,
  ConnectorMeta,
  StreamDef,
} from "@/server/connectors/types";

import { GOOGLE_ADS_SCOPES, buildAuthUrl, exchangeCode, refreshTokens } from "./auth";
import { listAccounts } from "./discovery";
import { pull } from "./extract";
import { mapToCanonical } from "./mapping";
import { schemas } from "./schema";

const meta: ConnectorMeta = {
  provider: "google_ads",
  name: "Google Ads",
  authType: "oauth2",
  scopes: [...GOOGLE_ADS_SCOPES],
  docsUrl: "https://developers.google.com/google-ads/api/docs/start",
  // Retificação de atribuição da fonte: syncs incrementais re-puxam os últimos
  // 14 dias (docs/v1-architecture.md §5.6 / §10.3).
  restatementWindowDays: 14,
  rateLimit: { requestsPerSecond: 2, concurrency: 1 },
};

const streams: readonly StreamDef[] = [
  { id: "campaign_daily", label: "Desempenho de campanha por dia" },
];

export const googleAdsConnector: Connector = {
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
