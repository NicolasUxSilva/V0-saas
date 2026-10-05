/**
 * Conectores-esboço (bloco B0).
 *
 * Satisfazem o contrato `Connector` para o registry ficar completo, mas toda
 * operação lança `NotImplementedError`. Google Ads / Meta Ads / RD Station
 * permanecem assim nesta V0; o esboço de `ga4` é substituído pelo conector real
 * no bloco B1.
 */
import {
  type Connector,
  type ConnectorMeta,
  NotImplementedError,
  type Provider,
} from "./types";

const STUB_META: Record<Provider, ConnectorMeta> = {
  ga4: {
    provider: "ga4",
    name: "Google Analytics 4",
    authType: "oauth2",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    docsUrl:
      "https://developers.google.com/analytics/devguides/reporting/data/v1",
    restatementWindowDays: 3,
    rateLimit: { requestsPerSecond: 5, concurrency: 2 },
  },
  google_ads: {
    provider: "google_ads",
    name: "Google Ads",
    authType: "oauth2",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    docsUrl: "https://developers.google.com/google-ads/api/docs/start",
    restatementWindowDays: 14,
    rateLimit: { requestsPerSecond: 2, concurrency: 1 },
  },
  meta_ads: {
    provider: "meta_ads",
    name: "Meta Ads",
    authType: "system_user",
    scopes: ["ads_read"],
    docsUrl: "https://developers.facebook.com/docs/marketing-apis",
    restatementWindowDays: 28,
    rateLimit: { requestsPerSecond: 2, concurrency: 1 },
  },
  // Valor morto — nunca implementado, nunca alcançável (ver comentário em
  // `db/schema.ts` sobre `providerEnum`). Precisa continuar aqui só porque
  // `STUB_META` é `Record<Provider, ConnectorMeta>` e `Provider` ainda lista
  // `rd_station` (não removido do enum do Postgres por ser destrutivo).
  rd_station: {
    provider: "rd_station",
    name: "RD Station (obsoleto — ver rd_station_marketing / rd_station_crm)",
    authType: "oauth2",
    scopes: [],
    docsUrl: "https://developers.rdstation.com",
    restatementWindowDays: 7,
    rateLimit: { requestsPerSecond: 2, concurrency: 1 },
  },
  // rd_station_marketing / rd_station_crm são conectores REAIS desde o RD-1
  // (`./rd_station_marketing`, `./rd_station_crm`) — não usam este stub. As
  // entradas abaixo existem só para `STUB_META` cobrir todo `Provider`;
  // `createStubConnector` nunca é chamado com estes dois valores.
  rd_station_marketing: {
    provider: "rd_station_marketing",
    name: "RD Station Marketing",
    authType: "oauth2",
    scopes: [],
    docsUrl: "https://developers.rdstation.com/marketing",
    restatementWindowDays: 3,
    rateLimit: { requestsPerSecond: 1, concurrency: 1 },
  },
  rd_station_crm: {
    provider: "rd_station_crm",
    name: "RD Station CRM",
    authType: "oauth2",
    scopes: [],
    docsUrl: "https://developers.rdstation.com/crm",
    restatementWindowDays: 1,
    rateLimit: { requestsPerSecond: 2, concurrency: 1 },
  },
};

/**
 * Cria um conector-esboço para `provider`: expõe `meta`, mas qualquer chamada de
 * auth / discovery / pull / mapping lança `NotImplementedError`.
 */
export function createStubConnector(
  provider: Provider,
  detail?: string,
): Connector {
  const fail = (): never => {
    throw new NotImplementedError(provider, detail);
  };
  return {
    meta: STUB_META[provider],
    streams: [],
    buildAuthUrl: fail,
    exchangeCode: fail,
    refreshTokens: fail,
    listAccounts: fail,
    pull: fail,
    schemas: {},
    mapToCanonical: fail,
  };
}

export const googleAdsStub = createStubConnector(
  "google_ads",
  "planejado para pós-V0",
);
export const metaAdsStub = createStubConnector(
  "meta_ads",
  "planejado para pós-V0",
);
export const rdStationStub = createStubConnector(
  "rd_station",
  "planejado para pós-V0",
);
