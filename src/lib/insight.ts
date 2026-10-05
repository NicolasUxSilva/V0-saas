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
