/**
 * Conector RD Station CRM completo (bloco RD-1D auth+discovery · RD-1E
 * extract+mapping).
 *
 * Grão por negociação (não por dia — ver `db/schema.ts`). Escreve em
 * `fact_deals` via `CanonicalBatch { target: "opportunities" }`. Sem PII — ver
 * `mapping.ts`.
 */
import type { Connector, ConnectorMeta, StreamDef } from "@/server/connectors/types";

import { listAccounts } from "./discovery";
import { pull } from "./extract";
import { mapToCanonical } from "./mapping";
import { buildAuthUrl, exchangeCode, refreshTokens } from "./oauth";
import { schemas } from "./schema";

const meta: ConnectorMeta = {
  provider: "rd_station_crm",
  name: "RD Station CRM",
  authType: "oauth2",
  scopes: [], // RD Station CRM não usa scopes por app (ver oauth.ts)
  docsUrl: "https://developers.rdstation.com/crm",
  // A extração é por `updated_at` exato via RDQL (não uma janela aproximada
  // como o GA4) — a margem aqui é só segurança contra clock-skew/consistência
  // eventual da API, por isso pequena.
  restatementWindowDays: 1,
  rateLimit: { requestsPerSecond: 2, concurrency: 1 }, // 120 req/min, todos os planos
};

const streams: readonly StreamDef[] = [
  { id: "deals", label: "Negociações" },
];

export const rdStationCrmConnector: Connector = {
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
