/**
 * Drizzle schema — camada de dados da V0 (bloco A1).
 *
 * 9 tabelas, conforme docs/v0-plan.md §5. Sem RLS, sem materialized view,
 * sem partição. Toda tabela de negócio carrega workspace_id (direta ou
 * indiretamente via connection) e será acessada por um helper que força o
 * escopo (bloco A2).
 *
 * Decisões registradas no relatório do A1:
 * - IDs uuid com gen_random_uuid(); timestamps timestamptz em UTC.
 * - Conjuntos fechados de valores -> pgEnum nativo. `provider` já com os 4
 *   (GA4 + 3 futuros) para não migrar enum depois.
 * - `workspace_members.role` é text (papéis são V1; evita ALTER TYPE).
 * - Tokens cifrados em coluna bytea (o módulo de cripto do B0 grava Buffer).
 * - date-only em modo string ('YYYY-MM-DD') para evitar bugs de fuso.
 * - FKs com onDelete cascade na direção "dono" (workspace / connection).
 * - jsonb tipado de forma frouxa aqui; shapes exatos entram no bloco C.
 */
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Coluna binária (Postgres `bytea`). Recebe/retorna Buffer. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ─────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────

// `rd_station` nunca foi usado (sempre foi um stub `implemented: false`, sem
// rota OAuth alcançável — nenhuma linha em nenhuma tabela referencia esse
// valor). No RD-1, RD Station virou dois produtos com OAuth/API totalmente
// diferentes (ver `connectors/rd_station_marketing` e `connectors/rd_station_crm`);
// em vez de renomear `rd_station` (Postgres não remove valor de enum sem
// recriar o tipo — mudança destrutiva, fora do que este bloco pede), ele fica
// como valor morto e inofensivo, e os dois nomes novos são adicionados ao lado.
export const providerEnum = pgEnum("provider", [
  "ga4",
  "google_ads",
  "meta_ads",
  "rd_station",
  "rd_station_marketing",
  "rd_station_crm",
]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "connected",
  "reauth_required",
  "error",
]);

export const syncTriggerEnum = pgEnum("sync_trigger", ["manual", "initial"]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "partial",
  "failed",
]);

export const insightKindEnum = pgEnum("insight_kind", [
  "problem",
  "opportunity",
  "data_quality",
]);

export const insightSeverityEnum = pgEnum("insight_severity", [
  "critical",
  "attention",
]);

export const insightStatusEnum = pgEnum("insight_status", [
  "open",
  "acknowledged",
  "dismissed",
]);

export const insightConfidenceEnum = pgEnum("insight_confidence", [
  "alta",
  "media",
]);

// ─────────────────────────────────────────────────────────────────────
// Identidade
// ─────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role")
      .$type<"owner" | "admin" | "analyst" | "viewer">()
      .notNull()
      .default("owner"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("workspace_members_workspace_user_uq").on(
      t.workspaceId,
      t.userId,
    ),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Conexão com fonte externa
// ─────────────────────────────────────────────────────────────────────

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    status: connectionStatusEnum("status").notNull().default("connected"),
    externalAccountEmail: text("external_account_email"),
    accessTokenEnc: bytea("access_token_enc"),
    refreshTokenEnc: bytea("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    keyVersion: integer("key_version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [
    index("connections_workspace_idx").on(t.workspaceId),
    uniqueIndex("connections_workspace_provider_uq").on(
      t.workspaceId,
      t.provider,
    ),
  ],
);

export const connectionProperties = pgTable(
  "connection_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // "properties/123456789"
    displayName: text("display_name").notNull(),
    timezone: text("timezone"),
    currency: text("currency"),
    isSelected: boolean("is_selected").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("connection_properties_connection_idx").on(t.connectionId),
    uniqueIndex("connection_properties_conn_external_uq").on(
      t.connectionId,
      t.externalId,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Sincronização
// ─────────────────────────────────────────────────────────────────────

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    trigger: syncTriggerEnum("trigger").notNull(),
    status: syncStatusEnum("status").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    rowsIn: integer("rows_in"),
    rowsWritten: integer("rows_written"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_connection_idx").on(t.connectionId, t.startedAt)],
);

// ─────────────────────────────────────────────────────────────────────
// RAW (imutável, replayável)
// ─────────────────────────────────────────────────────────────────────

export const rawRecords = pgTable(
  "raw_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    stream: text("stream").notNull(), // ex.: "report_daily"
    occurredOn: date("occurred_on"),
    payload: jsonb("payload").notNull(),
    sourceHash: text("source_hash").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("raw_records_conn_stream_date_idx").on(
      t.connectionId,
      t.stream,
      t.occurredOn,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Canônico (agnóstico de fonte)
// ─────────────────────────────────────────────────────────────────────

export const factTrafficDaily = pgTable(
  "fact_traffic_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    // Fonte-de-forma-web-analytics (G1). Hoje só 'ga4'; entra na chave natural
    // para que fontes futuras GA4-like não colidam. Ver docs/v1-architecture.md §6.2.
    platform: text("platform").notNull().default("ga4"),
    date: date("date").notNull(),
    // channel/source/medium/campaign: NOT NULL DEFAULT '' para o índice UNIQUE
    // abaixo funcionar no upsert idempotente (Postgres trata NULL como distinto).
    channel: text("channel").notNull().default(""), // sessionDefaultChannelGroup
    source: text("source").notNull().default(""),
    medium: text("medium").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    sessions: bigint("sessions", { mode: "number" }).notNull().default(0),
    totalUsers: bigint("total_users", { mode: "number" }).notNull().default(0),
    newUsers: bigint("new_users", { mode: "number" }).notNull().default(0),
    engagedSessions: bigint("engaged_sessions", { mode: "number" })
      .notNull()
      .default(0),
    avgEngagementTime: numeric("avg_engagement_time", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    keyEvents: numeric("key_events", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    conversionValue: numeric("conversion_value", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    dims: jsonb("dims"), // landing_page/device (V1) sem migração
    sourceHash: text("source_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("fact_traffic_daily_natural_uq").on(
      t.connectionId,
      t.platform,
      t.date,
      t.channel,
      t.source,
      t.medium,
      t.campaign,
    ),
    index("fact_traffic_daily_workspace_date_idx").on(t.workspaceId, t.date),
  ],
);

export const factAdPerformanceDaily = pgTable(
  "fact_ad_performance_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    // Forma "ad-performance" (leilão/investimento por campanha/dia). Google Ads
    // hoje ('google_ads'); Meta Ads no futuro. Ver docs/v1-architecture.md §6.3.
    platform: text("platform").notNull().default("google_ads"),
    date: date("date").notNull(), // segments.date, no fuso da conta (§18)
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name").notNull().default(""),
    campaignStatus: text("campaign_status").notNull().default(""),
    // '' = linha não segmentada por rede (total da campanha no dia). A GAQL do
    // V1 não usa segments.ad_network_type (§10.3); a chave natural já acomoda
    // segmentação por rede se um bloco futuro promover isso.
    adNetwork: text("ad_network").notNull().default(""),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    // Dinheiro sempre numeric — nunca float. cost = metrics.cost_micros / 1e6
    // (arredondado deterministicamente para 4 casas). Ver §6.3 / §17 (moeda da
    // conta, sem conversão cambial) — a moeda fica em `currency`.
    cost: numeric("cost", { precision: 18, scale: 4, mode: "number" }).notNull(),
    conversions: numeric("conversions", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    conversionValue: numeric("conversion_value", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    // Impression share 0..1 — nullable: a API não retorna para todo tipo de
    // campanha / volume. Ausência é `null`, NÃO 0 (§12).
    impressionShare: numeric("impression_share", {
      precision: 9,
      scale: 6,
      mode: "number",
    }),
    budgetLostIs: numeric("budget_lost_is", {
      precision: 9,
      scale: 6,
      mode: "number",
    }),
    rankLostIs: numeric("rank_lost_is", {
      precision: 9,
      scale: 6,
      mode: "number",
    }),
    currency: text("currency"), // customer.currency_code (ISO-4217)
    dims: jsonb("dims"), // advertising_channel_type, budget — não promovidos a coluna no V1
    sourceHash: text("source_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Chave natural (§6.3): re-sync do mesmo período não duplica; upsert por
    // source_hash só grava quando algo muda.
    uniqueIndex("fact_ad_performance_daily_natural_uq").on(
      t.connectionId,
      t.platform,
      t.date,
      t.campaignId,
      t.adNetwork,
    ),
    index("fact_ad_performance_daily_workspace_date_idx").on(
      t.workspaceId,
      t.date,
    ),
  ],
);

/**
 * RD Station Marketing — Estatísticas dos Ativos de Conversão (bloco RD-1).
 * `GET /platform/analytics/conversions`, disponível nos planos Pro e Advanced
 * (a Estatísticas do Funil de Vendas, ricas em lead/oportunidade/venda, exige
 * Advanced — fora do alcance desta conta piloto; ver docs/v1-architecture.md).
 *
 * Grão: dia × ativo (landing page / formulário / pop-up) — a própria API não
 * devolve série diária nesse endpoint (sem `reference_day`); cada chamada é
 * `start_date=end_date=<dia>`, então UMA chamada já corresponde a UM dia sem
 * agregação nossa (ver `rd_station_marketing/extract.ts`).
 *
 * Sem PII: nenhum dado de contato/lead individual — só contagens por ativo.
 */
export const factConversionAssetsDaily = pgTable(
  "fact_conversion_assets_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("rd_station_marketing"),
    date: date("date").notNull(),
    assetId: text("asset_id").notNull(),
    assetIdentifier: text("asset_identifier").notNull().default(""),
    assetType: text("asset_type").notNull().default(""), // LandingPage | Popup | Forms
    visits: bigint("visits", { mode: "number" }).notNull().default(0),
    conversions: bigint("conversions", { mode: "number" }).notNull().default(0),
    // 0..1; nullable — mesma regra de "ausência ≠ zero" do impression_share em
    // fact_ad_performance_daily, mesmo que a API hoje sempre devolva o campo.
    conversionRate: numeric("conversion_rate", {
      precision: 9,
      scale: 6,
      mode: "number",
    }),
    dims: jsonb("dims"),
    sourceHash: text("source_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("fact_conversion_assets_daily_natural_uq").on(
      t.connectionId,
      t.platform,
      t.date,
      t.assetId,
    ),
    index("fact_conversion_assets_daily_workspace_date_idx").on(
      t.workspaceId,
      t.date,
    ),
  ],
);

/**
 * RD Station CRM — negociações (`deals`, bloco RD-1). `GET /crm/v2/deals`.
 *
 * Grão: UMA LINHA POR NEGOCIAÇÃO (natural key = `deal_id`), não por dia — igual
 * em espírito a `fact_ad_performance_daily` ser uma linha por (campanha, dia):
 * aqui o grão nativo da API é o deal, e `deals` NÃO vem pré-agregado por dia
 * como o GAQL do Ads ou os relatórios do GA4 vêm. Agregar por dia nós mesmos
 * (ex.: somar por `deal_created_at`) teria que lidar com negociações cortadas
 * entre páginas de paginações diferentes colidindo na mesma chave natural e se
 * sobrescrevendo (upsert substitui, não soma) — guardando uma linha por deal,
 * cada página faz upsert independente pelo próprio `deal_id`, sem colisão
 * possível. Agregação por dia/pipeline/status acontece em `context.ts`, em
 * tempo de leitura (mesmo papel do `adsSum`/`adsAvg` do G5 sobre
 * `fact_ad_performance_daily`).
 *
 * `deal_created_at` / `deal_closed_at` são a DATA DO FATO (quando a negociação
 * foi aberta / fechada). `deal_updated_at` é só controle de sincronização
 * (usado por `extract.ts` para saber o que re-buscar via RDQL) — nunca usar
 * `deal_updated_at` como data de um fato; um deal aberto há 300 dias pode ter
 * `updated_at` de hoje porque acabou de fechar.
 *
 * Sem PII: nem nome da negociação, nem `contact_ids`, nem dados do contato são
 * promovidos a coluna — só IDs técnicos e números (ver relatório RD-1).
 */
export const factDeals = pgTable(
  "fact_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("rd_station_crm"),
    dealId: text("deal_id").notNull(),
    status: text("status").notNull().default(""), // won | lost | ongoing | paused
    totalPrice: numeric("total_price", { precision: 18, scale: 4, mode: "number" })
      .notNull()
      .default(0),
    pipelineId: text("pipeline_id").notNull().default(""),
    stageId: text("stage_id").notNull().default(""),
    sourceId: text("source_id").notNull().default(""),
    campaignId: text("campaign_id").notNull().default(""),
    lostReasonId: text("lost_reason_id").notNull().default(""),
    dealCreatedAt: date("deal_created_at").notNull(),
    dealUpdatedAt: timestamp("deal_updated_at", { withTimezone: true }).notNull(),
    dealClosedAt: date("deal_closed_at"), // null enquanto ongoing/paused
    dims: jsonb("dims"),
    sourceHash: text("source_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("fact_deals_natural_uq").on(
      t.connectionId,
      t.platform,
      t.dealId,
    ),
    index("fact_deals_workspace_created_idx").on(
      t.workspaceId,
      t.dealCreatedAt,
    ),
    index("fact_deals_workspace_closed_idx").on(t.workspaceId, t.dealClosedAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Inteligência (saída do produto)
// ─────────────────────────────────────────────────────────────────────

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    detector: text("detector").notNull(),
    kind: insightKindEnum("kind").notNull(),
    severity: insightSeverityEnum("severity").notNull(),
    status: insightStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    impactJson: jsonb("impact_json"), // { value, unit, basis, isEstimate }
    explanation: text("explanation").notNull(), // o QUE
    hypothesis: text("hypothesis").notNull(), // o PORQUÊ
    evidenceJson: jsonb("evidence_json").notNull(), // { current, previous, baseline, deltaPct, ... }
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    comparedTo: text("compared_to"),
    responsibleDimensionJson: jsonb("responsible_dimension_json"), // { name, value, share }
    confidence: insightConfidenceEnum("confidence").notNull(),
    confidenceBasisJson: jsonb("confidence_basis_json").notNull(),
    recommendedAction: text("recommended_action").notNull(), // o QUE FAZER
    priorityScore: doublePrecision("priority_score").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    rating: smallint("rating"), // +1 / -1 / null
    gateTraceJson: jsonb("gate_trace_json"), // G0..G4 medidos (auditável)
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("insights_workspace_dedupe_uq").on(t.workspaceId, t.dedupeKey),
    index("insights_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Cross-source (V1.1) — resultado PERSISTIDO da camada `analysis/cross-source/`.
//
// Tabela PRÓPRIA, separada de `insights` de propósito: `insights` guarda
// problemas de um detector (kind/severity/confidence são pgEnum, evidência com
// `deltaPct`, priorityScore) e alimenta o /diagnostico; os insights do
// Cross-source são observações e limitações sem variação nem nota, e não aparecem
// em nenhuma tela. Mesmos padrões das tabelas vizinhas: identidade estável
// (`insights`: workspace + dedupe_key) e hash do conteúdo (fact tables:
// source_hash).
//
// Um "conjunto" é `(workspace_id, period_start, period_end)`: regenerar substitui
// o conjunto inteiro (upsert do que foi produzido + remoção do que deixou de ser).
// `type`/`category` são text, não pgEnum: os tipos vão crescer e o projeto já
// evitou ALTER TYPE assim (ver `workspace_members.role`). Os shapes exatos de
// `sources_json`/`statements_json`/`evidence_json` estão em
// `analysis/cross-source/types.ts` e são versionados por `schema_version`.
// ─────────────────────────────────────────────────────────────────────

export const crossSourceInsights = pgTable(
  "cross_source_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // período ANALISADO — a chave do conjunto
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dedupeKey: text("dedupe_key").notNull(), // "cross-source:<type>"
    type: text("type").notNull(),
    category: text("category").notNull(),
    position: smallint("position").notNull(), // ordem canônica dentro do conjunto
    title: text("title").notNull(),
    // período em que ESTE insight vale (= o analisado, salvo fontes desalinhadas)
    insightPeriodStart: date("insight_period_start").notNull(),
    insightPeriodEnd: date("insight_period_end").notNull(),
    sourcesJson: jsonb("sources_json").notNull(), // CrossSourceSource[]
    statementsJson: jsonb("statements_json").notNull(), // fatos / relações / hipóteses / limitações
    evidenceJson: jsonb("evidence_json").notNull(), // pontos de evidência estruturados
    contentHash: text("content_hash").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    // quando a geração que escreveu/confirmou esta linha rodou (igual para o conjunto todo)
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("cross_source_insights_workspace_period_key_uq").on(
      t.workspaceId,
      t.periodStart,
      t.periodEnd,
      t.dedupeKey,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Tipos inferidos (usados a partir do bloco A2)
// ─────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionProperty = typeof connectionProperties.$inferSelect;
export type NewConnectionProperty = typeof connectionProperties.$inferInsert;
export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
export type RawRecord = typeof rawRecords.$inferSelect;
export type NewRawRecord = typeof rawRecords.$inferInsert;
export type FactTrafficDaily = typeof factTrafficDaily.$inferSelect;
export type NewFactTrafficDaily = typeof factTrafficDaily.$inferInsert;
export type FactAdPerformanceDaily = typeof factAdPerformanceDaily.$inferSelect;
export type NewFactAdPerformanceDaily =
  typeof factAdPerformanceDaily.$inferInsert;
export type FactConversionAssetsDaily =
  typeof factConversionAssetsDaily.$inferSelect;
export type NewFactConversionAssetsDaily =
  typeof factConversionAssetsDaily.$inferInsert;
export type FactDeals = typeof factDeals.$inferSelect;
export type NewFactDeals = typeof factDeals.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;
export type CrossSourceInsightRow = typeof crossSourceInsights.$inferSelect;
export type NewCrossSourceInsightRow = typeof crossSourceInsights.$inferInsert;
