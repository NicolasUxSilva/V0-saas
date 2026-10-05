/**
 * Conector GA4 completo (bloco B3). Junta auth (B1) + discovery (B1) +
 * extract (B3) + mapping (B3) na interface `Connector`.
 */
import type {
  Connector,
  ConnectorMeta,
  StreamDef,
} from "@/server/connectors/types";

import {
  GA4_SCOPES,
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
} from "./auth";
import { listAccounts } from "./discovery";
import { pull } from "./extract";
import { mapToCanonical } from "./mapping";
import { schemas } from "./schema";

const meta: ConnectorMeta = {
  provider: "ga4",
  name: "Google Analytics 4",
  authType: "oauth2",
  scopes: [...GA4_SCOPES],
  docsUrl:
    "https://developers.google.com/analytics/devguides/reporting/data/v1",
  restatementWindowDays: 3,
  rateLimit: { requestsPerSecond: 5, concurrency: 2 },
};

const streams: StreamDef[] = [
  { id: "report_daily", label: "Relatório diário por canal / origem / campanha" },
];

export const ga4Connector: Connector = {
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
