/**
 * Tipos do diagnóstico de campanhas consumidos pela UI. Montados no servidor
 * (`src/server/campaigns/diagnostics/`), de forma determinística, a partir dos mesmos
 * agregados da área Campanhas; a tela só formata.
 *
 * Três naturezas, nunca misturadas:
 *  - `finding`      — há evidência suficiente para afirmar o que mudou;
 *  - `inconclusive` — a mudança é grande, mas a evidência é fraca (pouco volume);
 *  - `limitation`   — os dados não permitem analisar (importação, cobertura, moeda…).
 *
 * SEVERIDADE (quanto importa, se for verdade) e CONFIANÇA (quanto a evidência sustenta)
 * são eixos separados.
 */
import type { AdPlatform, DateWindow, MetricComparison } from "@/lib/campaigns";

export type DiagnosticType =
  | "cost_without_results"
  | "cost_per_result_increase"
  | "ctr_drop"
  | "cpc_increase"
  | "results_drop"
  | "cost_per_result_improvement"
  | "spend_without_results_share"
  | "spend_concentration"
  | "data_limitation";

export type DiagnosticKind = "finding" | "inconclusive" | "limitation";
export type DiagnosticSeverity = "high" | "medium" | "low" | "info";
export type DiagnosticConfidence = "high" | "medium" | "low";
export type DiagnosticLevel = "platform" | "campaign" | "ad_group" | "ad";

/** Motivos estáveis das limitações (para filtro e testes). */
export type LimitationReason =
  | "source_unavailable"
  | "import_incomplete"
  | "stale_data"
  | "comparison_unavailable"
  | "comparison_off"
  | "low_volume"
  | "currency_mixed"
  | "result_undefined"
  | "result_definition_changed"
  | "detail_unavailable"
  | "recent_data_unsettled"
  | "no_results_anywhere";

export interface DiagnosticEntity {
  campaignId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  adId: string | null;
  adName: string | null;
  /** página da entidade na área Campanhas (com o mesmo período) */
  href: string | null;
}

/** Um número da evidência que não é uma métrica comparada (ex.: resultados esperados). */
export interface EvidenceFact {
  label: string;
  value: number;
  format: "money" | "count" | "decimal" | "rate";
}

/** Uma entidade de nível inferior onde o mesmo sinal também aparece. */
export interface RelatedEntity {
  level: DiagnosticLevel;
  name: string;
  href: string | null;
  /** variação da métrica principal nessa entidade (quando há) */
  deltaPct: number | null;
}

export interface CampaignDiagnostic {
  /** estável entre execuções: tipo + plataforma + nível + caminho da entidade (+ motivo) */
  id: string;
  type: DiagnosticType;
  kind: DiagnosticKind;
  platform: AdPlatform;
  platformLabel: string;
  level: DiagnosticLevel;
  /** "Campanha" · "Grupo de anúncios" · "Conjunto de anúncios" · "Anúncio" · "Plataforma" */
  levelLabel: string;
  entity: DiagnosticEntity;
  title: string;
  description: string;
  /** métricas atual × anterior que sustentam o diagnóstico */
  evidence: MetricComparison[];
  facts: EvidenceFact[];
  currency: string | null;
  period: { current: DateWindow; previous: DateWindow | null };
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  /** por que a conclusão é limitada (dados insuficientes, período recente…); `null` = nada */
  limitation: string | null;
  limitationReason: LimitationReason | null;
  /** o que verificar a seguir — específico da regra e da plataforma */
  nextCheck: string;
  /** métricas usadas pela regra */
  metrics: string[];
  related: RelatedEntity[];
  /** ordenação: maior primeiro */
  priority: number;
}

export interface DiagnosticFilters {
  severity: DiagnosticSeverity | null;
  type: DiagnosticType | null;
  level: DiagnosticLevel | null;
  campaignId: string | null;
}

export interface DiagnosticsView {
  findings: CampaignDiagnostic[];
  inconclusive: CampaignDiagnostic[];
  limitations: CampaignDiagnostic[];
  /** contagens ANTES dos filtros de diagnóstico (para o resumo) */
  totals: { findings: number; high: number; inconclusive: number; limitations: number };
  campaignOptions: { platform: AdPlatform; id: string; name: string }[];
}
