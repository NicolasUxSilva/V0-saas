/**
 * Forma do objeto Insight como a UI consome (bloco A4).
 *
 * Espelha `docs/v0-plan.md` §5.6 (tabela `insights`). No bloco C o motor de
 * análise produz objetos com esta forma; por ora só o `src/mock.ts` os cria.
 */

export type InsightKind = "problem" | "opportunity" | "data_quality";
export type InsightSeverity = "critical" | "attention";
export type InsightStatus = "open" | "acknowledged" | "dismissed";
export type InsightConfidence = "alta" | "media";
export type InsightRating = 1 | -1 | null;

export type MetricFormat = "count" | "rate" | "currency";

export interface InsightImpact {
  value: number;
  unit: "conversions" | "sessions" | "BRL";
  /** frase curta que qualifica o número, ex.: "conversões perdidas nos 28 dias" */
  basis: string;
  isEstimate: boolean;
}

export interface EvidenceBreakdownRow {
  label: string; // ex.: "Organic Search"
  /** participação na variação total, -1..1 (ex.: 0.71 = 71% da queda) */
  contributionPct: number;
  detail?: string; // ex.: "taxa 3,4% → 2,1%"
}

export interface InsightEvidence {
  metricLabel: string; // ex.: "Conversões"
  current: number;
  previous: number;
  baseline?: number;
  /** variação relativa, -1..N (ex.: -0.27 = -27%) */
  deltaPct: number;
  format: MetricFormat;
  /** descrição do teste estatístico, ex.: "z de 2 proporções: z = −4,1 (p < 0,001)" */
  test?: string;
  breakdown?: EvidenceBreakdownRow[];
}

export interface ResponsibleDimension {
  name: string; // ex.: "canal"
  value: string; // ex.: "Organic Search"
  /** participação na variação, 0..1 */
  share: number;
}

export interface AnalysisWindow {
  start: string; // "YYYY-MM-DD"
  end: string; // "YYYY-MM-DD"
  comparedTo: string; // ex.: "28 dias anteriores"
}

export interface Insight {
  /** PK do banco. NÃO usar como identidade estável — pode mudar entre análises. */
  id: string;
  /** identidade estável do insight (mesma finding entre syncs). Chave do feedback. */
  dedupeKey: string;
  detector: string;
  kind: InsightKind;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  impact: InsightImpact | null;
  explanation: string; // o QUE aconteceu
  hypothesis: string; // o PORQUÊ provável
  evidence: InsightEvidence;
  window: AnalysisWindow;
  responsibleDimension: ResponsibleDimension | null;
  confidence: InsightConfidence;
  confidenceBasis: string; // ex.: "z = −4,1 · 12,4k sessões/período · 96% de completude"
  recommendedAction: string; // o QUE fazer agora
  priorityScore: number; // 0..100
  rating: InsightRating;
  detectedAt: string; // ISO
}

export interface SupportMetric {
  key: string;
  label: string;
  current: number;
  previous: number;
  deltaPct: number;
  format: MetricFormat;
  /** quando true, uma queda é ruim (usar cor negativa); default true */
  lowerIsWorse?: boolean;
}

/**
 * Metadados da análise real (bloco C5) — presentes só quando `USE_MOCK=false`.
 * Base para o "estado honesto": quando o motor não emite nenhum insight de
 * tendência, a tela mostra os números dos gates em vez de silêncio.
 */
export interface AnalysisMeta {
  /** data de corte da análise (D−2, limitada ao último dia com dados) */
  analysisEnd: string;
  /** dias distintos com dados na janela histórica (~180) */
  coverageDistinctDates: number;
  expectedDays: number;
  currentDaysWithData: number;
  previousDaysWithData: number;
  /** tamanho da janela de comparação (28) */
  windowDays: number;
  hasComparableWindows: boolean;
  /** famílias suprimidas pelos gates: "traffic" | "conversion" | "attribution" */
  suppressed: string[];
  /** soma de key events no intervalo (0 = sem dados de conversão) */
  totalKeyEvents: number;
}

export type SyncStatus = "running" | "success" | "partial" | "failed";

// ─────────────────────────────────────────────────────────────────────
// Estado da tela Diagnóstico: real × vazio × demonstração
// ─────────────────────────────────────────────────────────────────────

/**
 *  - `real`  — há dados reais do workspace (insights e/ou métricas do GA4);
 *  - `empty` — nada para analisar ainda: a tela explica o motivo e a ação recomendada;
 *  - `demo`  — dados FICTÍCIOS de demonstração (`USE_MOCK=true`), sempre com aviso
 *              inequívoco. Dado de demonstração nunca se passa por real.
 */
export type DiagnosticoMode = "real" | "empty" | "demo";

export type SourceKey =
  | "ga4"
  | "google_ads"
  | "meta_ads"
  | "rd_station_marketing"
  | "rd_station_crm";

/**
 *  - `not_connected` — nunca conectada;
 *  - `needs_reauth`  — o acesso expirou ou foi revogado;
 *  - `error`         — a conexão está em erro;
 *  - `no_account`    — conectada, mas sem conta/propriedade escolhida;
 *  - `sync_failed`   — a última importação falhou;
 *  - `never_synced`  — conectada e pronta, mas nunca importou;
 *  - `no_data`       — importou, mas não há linha nenhuma;
 *  - `synced`        — há dados importados.
 */
export type SourceHealth =
  | "not_connected"
  | "needs_reauth"
  | "error"
  | "no_account"
  | "sync_failed"
  | "never_synced"
  | "no_data"
  | "synced";

export interface SourceStatus {
  key: SourceKey;
  label: string;
  health: SourceHealth;
  /** frase curta do estado, em pt-BR */
  summary: string;
  /** aviso complementar (dados defasados, acesso perto de expirar); `null` = nada a avisar */
  notice: string | null;
  /** o que fazer a seguir; `null` quando está tudo certo */
  action: { label: string; href: string } | null;
  lastSyncedAt: string | null; // ISO
  /** período dos dados já importados; `null` = nenhum dado */
  coverage: { first: string; last: string } | null;
  /** o que esta fonte alimenta — mostra o que se perde sem ela */
  feeds: string;
}

export interface PaidMediaMetric {
  key: "cost" | "impressions" | "clicks" | "conversions";
  label: string;
  current: number;
  /** `null` = não há janela anterior com dados para comparar */
  previous: number | null;
  /** (atual − anterior) ÷ anterior; `null` com base zero ou sem janela anterior — nunca infinito */
  deltaPct: number | null;
  format: MetricFormat;
}

/** Mídia paga REAL de uma plataforma: os 28 dias de dados mais recentes e os 28 anteriores. */
export interface PaidMediaSnapshot {
  platform: "google_ads" | "meta_ads";
  label: string;
  /** moeda da conta; `null` = a fonte não informou (nunca se assume BRL) */
  currency: string | null;
  window: { start: string; end: string };
  comparedTo: { start: string; end: string } | null;
  daysWithData: number;
  metrics: PaidMediaMetric[];
}

export interface DiagnosticoEmpty {
  title: string;
  description: string;
  action: { label: string; href: string } | null;
}

/** O que a página Diagnóstico renderiza: o modo e tudo o que ele precisa. */
export interface DiagnosticoView {
  mode: DiagnosticoMode;
  /** `demo`: o conjunto fictício; `real`: dados do workspace; `empty`: vazio (sem insights nem métricas) */
  data: DiagnosticoData;
  /** estado REAL de cada fonte — também no modo demonstração */
  sources: SourceStatus[];
  /** mídia paga real (Google Ads / Meta Ads) com dados; vazio se nenhuma plataforma tem */
  paidMedia: PaidMediaSnapshot[];
  /** só no modo `empty`: por que está vazio e o que fazer */
  empty: DiagnosticoEmpty | null;
}

export interface DiagnosticoData {
  lastSyncedAt: string | null; // ISO
  /** status do sync mais recente — dispara o aviso de dados parciais (D0) */
  lastSyncStatus: SyncStatus | null;
  window: AnalysisWindow;
  insights: Insight[];
  supportMetrics: SupportMetric[];
  /** null no mock; preenchido com dados reais no bloco C5 */
  analysis: AnalysisMeta | null;
}
