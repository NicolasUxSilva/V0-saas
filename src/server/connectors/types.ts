/**
 * Contrato de conector (bloco B0).
 *
 * Toda fonte de dados (GA4 hoje; Google Ads / Meta Ads / RD Station no futuro)
 * implementa esta interface. O ETL e o motor de análise nunca conhecem um
 * conector pelo nome — pedem ao `registry`. Adicionar uma fonte = implementar
 * `Connector` + trocar a entrada no registry.
 */
import type { ZodType } from "zod";

// `rd_station` é um valor morto (nunca implementado, nunca alcançável por
// nenhuma rota) — ver comentário em `db/schema.ts` sobre `providerEnum`.
// RD Station virou dois produtos reais no RD-1: `rd_station_marketing` e
// `rd_station_crm` (OAuth, API e limites completamente diferentes entre si).
export type Provider =
  | "ga4"
  | "google_ads"
  | "meta_ads"
  | "rd_station"
  | "rd_station_marketing"
  | "rd_station_crm";

export type AuthType = "oauth2" | "api_key" | "system_user";

/** Tokens retornados pela troca de código / refresh OAuth. */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** instante de expiração do access token */
  expiresAt: Date;
  scopes: string[];
  /** id_token OIDC, quando o escopo `openid` foi pedido (null caso contrário) */
  idToken: string | null;
}

/** Credencial já resolvida (access token válido) passada a discovery / pull. */
export interface AccessContext {
  accessToken: string;
  /** metadados por-conexão que o conector precise (ex.: login-customer-id no futuro) */
  meta?: Record<string, unknown>;
}

/** Conta/propriedade descoberta na fonte (ex.: uma propriedade GA4). */
export interface DiscoveredAccount {
  externalId: string; // ex.: "properties/123456789"
  displayName: string;
  timezone: string | null;
  currency: string | null;
}

/** Conta/propriedade escolhida para sincronizar. */
export interface SelectedAccount {
  externalId: string;
  timezone: string | null;
  currency: string | null;
}

/** Registro cru, gravado em `raw_records` antes de qualquer transformação. */
export interface RawRecord {
  stream: string;
  externalId: string | null;
  occurredOn: string | null; // "YYYY-MM-DD"
  payload: unknown;
  sourceHash: string;
}

/**
 * Linha canônica de tráfego (web analytics). Destino: `fact_traffic_daily`
 * (o ETL adiciona workspace_id / connection_id / platform / updated_at).
 */
export interface CanonicalTrafficRow {
  date: string; // "YYYY-MM-DD" (no fuso da conta de origem)
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  avgEngagementTime: number; // segundos
  keyEvents: number;
  conversionValue: number;
  dims: Record<string, unknown> | null;
  /** hash da chave natural + valores, para upsert idempotente */
  sourceHash: string;
}

/**
 * Linha canônica de desempenho de anúncio (campanha × dia). Destino:
 * `fact_ad_performance_daily` (o ETL adiciona workspace_id / connection_id /
 * platform / updated_at). Google Ads no G3; Meta Ads no futuro. Grão campanha ×
 * dia — sem ad_group / keyword / query (INV-13).
 */
export interface CanonicalAdPerfRow {
  date: string; // "YYYY-MM-DD" no fuso da conta (segments.date)
  campaignId: string;
  campaignName: string;
  campaignStatus: string; // ENABLED / PAUSED / REMOVED / ...
  /** "" = linha não segmentada por rede (total da campanha no dia). */
  adNetwork: string;
  impressions: number; // inteiro
  clicks: number; // inteiro
  /** metrics.cost_micros ÷ 1e6 — sempre numeric, nunca micros crus como dinheiro. */
  cost: number;
  conversions: number;
  conversionValue: number;
  /** 0..1; `null` quando a fonte não reporta (não confundir com 0). */
  impressionShare: number | null;
  budgetLostIs: number | null;
  rankLostIs: number | null;
  /** moeda da conta (ISO-4217); sem conversão cambial. */
  currency: string | null;
  dims: Record<string, unknown> | null;
  /** hash da chave natural + valores, para upsert idempotente. */
  sourceHash: string;
}

/**
 * Linha canônica de ativo de conversão (RD Station Marketing, bloco RD-1).
 * Destino: `fact_conversion_assets_daily`. Grão dia × ativo (landing page /
 * formulário / pop-up) — `GET /platform/analytics/conversions`, disponível nos
 * planos Pro e Advanced (ver `connectors/rd_station_marketing`). Sem PII: só
 * contagens agregadas por ativo, nenhum dado de contato/lead individual.
 */
export interface CanonicalConversionAssetRow {
  date: string; // "YYYY-MM-DD" — UMA chamada da API já é UM dia (ver extract.ts)
  assetId: string;
  assetIdentifier: string;
  assetType: string; // "LandingPage" | "Popup" | "Forms"
  visits: number;
  conversions: number;
  /** 0..1; `null` quando a fonte não reporta (não confundir com 0). */
  conversionRate: number | null;
  dims: Record<string, unknown> | null;
  sourceHash: string;
}

/**
 * Linha canônica de negociação (RD Station CRM, bloco RD-1). Destino:
 * `fact_deals`. Grão: UMA linha por negociação (`GET /crm/v2/deals`) — a API
 * não agrega por dia, então o grão canônico é o próprio deal, não um bucket
 * diário (ver o comentário em `db/schema.ts` sobre `factDeals`).
 *
 * `dealCreatedAt`/`dealClosedAt` são a data do FATO; `dealUpdatedAt` é só
 * controle de sincronização (RDQL `updated_at`) — nunca usar `dealUpdatedAt`
 * como data de um fato (§ "RESTATEMENT / INCREMENTAL" da tarefa RD-1).
 *
 * Sem PII: nem `name` da negociação nem `contact_ids` são promovidos a
 * campo canônico — só IDs técnicos (pipeline/stage/source/campaign/lost
 * reason) e números. `ownerId` fica de fora por não ser necessário ainda.
 */
export interface CanonicalDealRow {
  dealId: string;
  status: string; // won | lost | ongoing | paused
  totalPrice: number;
  pipelineId: string;
  stageId: string;
  sourceId: string; // '' se a negociação não tem fonte definida
  campaignId: string; // '' se não tem campanha
  lostReasonId: string; // '' se não está perdida (ou perdida sem motivo)
  dealCreatedAt: string; // "YYYY-MM-DD" — data do fato "aberta"
  dealUpdatedAt: string; // ISO datetime — só bookkeeping de sync
  dealClosedAt: string | null; // "YYYY-MM-DD" — data do fato "fechada"; null = aberta
  dims: Record<string, unknown> | null;
  sourceHash: string;
}

/**
 * Lote canônico produzido por `mapToCanonical` — **nomeia a fact table destino**
 * (`normalize` roteia por `target`). `traffic` → `fact_traffic_daily` (GA4);
 * `ad_performance` → `fact_ad_performance_daily` (Google Ads, Meta Ads);
 * `conversion_assets` → `fact_conversion_assets_daily` (RD Station Marketing);
 * `opportunities` → `fact_deals` (RD Station CRM).
 */
export type CanonicalBatch =
  | { target: "traffic"; rows: CanonicalTrafficRow[] }
  | { target: "ad_performance"; rows: CanonicalAdPerfRow[] }
  | { target: "conversion_assets"; rows: CanonicalConversionAssetRow[] }
  | { target: "opportunities"; rows: CanonicalDealRow[] };

export interface StreamDef {
  id: string; // ex.: "report_daily"
  label: string;
}

export interface PullArgs {
  access: AccessContext;
  account: SelectedAccount;
  stream: string;
  since: string; // "YYYY-MM-DD" (inclusive)
  until: string; // "YYYY-MM-DD" (inclusive)
}

export interface ConnectorMeta {
  provider: Provider;
  name: string;
  authType: AuthType;
  scopes: string[];
  docsUrl: string;
  /** dias re-puxados a cada sync incremental (retificação de atribuição da fonte) */
  restatementWindowDays: number;
  rateLimit: { requestsPerSecond: number; concurrency: number };
}

export interface Connector {
  readonly meta: ConnectorMeta;
  readonly streams: readonly StreamDef[];

  // ── auth (OAuth 2.0) ──────────────────────────────────────────────
  /** monta a URL de consentimento */
  buildAuthUrl(params: { state: string; redirectUri: string }): string;
  /** troca o `code` do callback por tokens */
  exchangeCode(params: { code: string; redirectUri: string }): Promise<TokenSet>;
  /** renova o access token a partir do refresh token */
  refreshTokens(params: { refreshToken: string }): Promise<TokenSet>;

  // ── descoberta ────────────────────────────────────────────────────
  /** lista as contas/propriedades acessíveis pela credencial */
  listAccounts(access: AccessContext): Promise<DiscoveredAccount[]>;

  // ── extração ──────────────────────────────────────────────────────
  /** extrai registros crus de um stream numa janela (streaming / paginado) */
  pull(args: PullArgs): AsyncIterable<RawRecord>;

  // ── normalização ──────────────────────────────────────────────────
  /** schema Zod de validação por stream */
  readonly schemas: Readonly<Record<string, ZodType>>;
  /** valida + mapeia um registro cru para um lote canônico (com a tabela destino) */
  mapToCanonical(stream: string, raw: RawRecord): CanonicalBatch;
}

/** Lançado por qualquer operação de um conector ainda não implementado nesta V0. */
export class NotImplementedError extends Error {
  readonly provider: Provider;
  constructor(provider: Provider, detail?: string) {
    super(
      `Conector "${provider}" não implementado nesta V0` +
        (detail ? `: ${detail}` : "") +
        ".",
    );
    this.name = "NotImplementedError";
    this.provider = provider;
  }
}
