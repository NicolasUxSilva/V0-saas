/**
 * Conector RD Station Marketing completo (bloco RD-1A auth+discovery · RD-1C
 * extract+mapping).
 *
 * Grão dia × ativo de conversão (landing page / formulário / pop-up). Escreve
 * em `fact_conversion_assets_daily` via `CanonicalBatch { target:
 * "conversion_assets" }`. Sem PII — ver `mapping.ts`.
 */
import type { Connector, ConnectorMeta, StreamDef } from "@/server/connectors/types";

import { listAccounts } from "./discovery";
import { MAX_HISTORY_DAYS, pull } from "./extract";
import { mapToCanonical } from "./mapping";
import { buildAuthUrl, exchangeCode, refreshTokens } from "./oauth";
import { schemas } from "./schema";

const meta: ConnectorMeta = {
  provider: "rd_station_marketing",
  name: "RD Station Marketing",
  authType: "oauth2",
  // RD Station Marketing não usa scopes por app (ver oauth.ts) — lista vazia,
  // não um placeholder inventado.
  scopes: [],
  docsUrl: "https://developers.rdstation.com/marketing",
  // Dado consolidado em até 24h (doc oficial) — margem pequena de reconsulta.
  restatementWindowDays: 3,
  rateLimit: { requestsPerSecond: 1, concurrency: 1 },
};

const streams: readonly StreamDef[] = [
  {
    id: "conversion_assets_daily",
    label: "Estatísticas dos Ativos de Conversão (Pro/Advanced)",
  },
];

export const rdStationMarketingConnector: Connector = {
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

// Reexportado para quem precisar do teto de histórico do plano Pro (testes,
// docs) sem importar `extract.ts` diretamente.
export { MAX_HISTORY_DAYS };
