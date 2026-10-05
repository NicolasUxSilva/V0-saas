/**
 * Registry de conectores (bloco B0).
 *
 * Ponto único de resolução `provider -> Connector`. O ETL e a UI pedem daqui;
 * nunca importam um conector diretamente. Adicionar/ativar uma fonte = trocar
 * uma linha em `REGISTRY`.
 */
import { ga4Connector } from "./ga4";
import { googleAdsConnector } from "./google_ads";
import { rdStationCrmConnector } from "./rd_station_crm";
import { rdStationMarketingConnector } from "./rd_station_marketing";
import { metaAdsStub, rdStationStub } from "./stubs";
import type { Connector, ConnectorMeta, Provider } from "./types";

interface RegistryEntry {
  connector: Connector;
  /** true quando é o conector real (não um esboço). */
  implemented: boolean;
}

const REGISTRY: Record<Provider, RegistryEntry> = {
  ga4: { connector: ga4Connector, implemented: true },
  google_ads: { connector: googleAdsConnector, implemented: true },
  meta_ads: { connector: metaAdsStub, implemented: false },
  // Valor morto — nunca implementado, nunca alcançável (ver `stubs.ts`).
  rd_station: { connector: rdStationStub, implemented: false },
  // RD-1: dois produtos reais, dois conectores reais.
  rd_station_marketing: { connector: rdStationMarketingConnector, implemented: true },
  rd_station_crm: { connector: rdStationCrmConnector, implemented: true },
};

export const PROVIDERS = Object.keys(REGISTRY) as Provider[];

export function getConnector(provider: Provider): Connector {
  return REGISTRY[provider].connector;
}

export function isImplemented(provider: Provider): boolean {
  return REGISTRY[provider].implemented;
}

/** Metadados dos conectores para a UI (tela Conexões). */
export function listConnectors(): {
  provider: Provider;
  meta: ConnectorMeta;
  implemented: boolean;
}[] {
  return PROVIDERS.map((provider) => ({
    provider,
    meta: REGISTRY[provider].connector.meta,
    implemented: REGISTRY[provider].implemented,
  }));
}
