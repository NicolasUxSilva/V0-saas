/**
 * Tipos da área Campanhas consumidos pela UI. Montados no servidor
 * (`src/server/campaigns/`); a tela só formata — não calcula nem decide estado.
 *
 * Regras que estes tipos carregam:
 *  - ausência ≠ zero: `null` = não há dado importado; `0` = zero registrado;
 *  - cada número é de UMA plataforma, na moeda da conta dela: nada aqui soma Google
 *    com Meta, nem moedas diferentes;
 *  - variação só existe quando os dois períodos são comparáveis (`comparable`), e a
 *    percentual só quando a base é diferente de zero.
 */
import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import type { SourceStatus } from "@/lib/insight";

export type AdPlatform = "google_ads" | "meta_ads";
export type PlatformFilter = "all" | AdPlatform;

export type SortKey =
  | "cost"
  | "cost_delta"
  | "results"
  | "cost_per_result"
  | "cost_per_result_delta"
  | "name";

export interface DateWindow {
  start: string; // "YYYY-MM-DD" (inclusive)
  end: string; // "YYYY-MM-DD" (inclusive)
}

export interface CampaignFilters {
  platform: PlatformFilter;
  /** dias do período ou "custom" */
  preset: number | "custom";
  current: DateWindow;
  /** período anterior equivalente; `null` = comparação desligada */
  previous: DateWindow | null;
  /** status bruto da plataforma (ex.: ENABLED); `null` = todos */
  status: string | null;
  /** só campanhas com investimento e zero resultado (onde "resultado" está definido) */
  onlyCostWithoutResult: boolean;
  sort: SortKey;
  page: number;
}

/** Quanto do período foi de fato importado para uma conta. */
export interface WindowCoverage {
  days: number;
  /** dias importados depois de terminados (dado fechado) */
  completeDays: number;
  /** dias importados enquanto ainda estavam em curso (dia parcial) */
  partialDays: string[];
  /** dias que nenhuma importação concluída cobriu */
  missingDays: number;
  state: "complete" | "partial" | "none";
}

export type MetricKey =
  | "cost"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "results"
  | "cost_per_result"
  | "conversion_value";

export type MetricFormatKind = "money" | "count" | "decimal" | "rate";

export interface MetricComparison {
  key: MetricKey;
  label: string;
  format: MetricFormatKind;
  /** `null` = sem dado (nada importado, ou razão com denominador zero) */
  current: number | null;
  previous: number | null;
  /** só quando os períodos são comparáveis e os dois valores existem */
  deltaAbs: number | null;
  /** só com `deltaAbs` e base diferente de zero */
  deltaPct: number | null;
  /** cair é bom? (custos); `null` = não há leitura de melhor/pior (ex.: investimento) */
  lowerIsBetter: boolean | null;
  /** por que o valor ou a variação não existem — para o título/tooltip */
  note: string | null;
}

/** O que "resultado" significa numa campanha (depende da plataforma e do objetivo). */
export interface ResultDefinition {
  key: "google_conversions" | "meta_lead" | "meta_purchase";
  /** rótulo curto da coluna */
  label: string;
  /** definição completa, mostrada ao usuário */
  description: string;
}

export interface CampaignRow {
  platform: AdPlatform;
  platformLabel: string;
  campaignId: string;
  name: string;
  status: string | null;
  statusLabel: string | null;
  /** objetivo (Meta) ou tipo de canal (Google), já rotulado */
  kindLabel: string | null;
  currency: string | null;
  /** a campanha tem linhas em mais de uma moeda (troca de conta): totais não somados */
  mixedCurrency: boolean;
  result: ResultDefinition | null;
  cost: MetricComparison;
  results: MetricComparison;
  costPerResult: MetricComparison;
  clicks: MetricComparison;
  ctr: MetricComparison;
  /** rótulos curtos de estado (ex.: "Sem veiculação no período") */
  flags: string[];
  href: string;
}

export interface SyncState {
  lastSyncedAt: string | null; // ISO
  lastRun: {
    status: "running" | "success" | "partial" | "failed";
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
  /** há uma importação em curso agora (iniciada há pouco e sem fim registrado) */
  running: boolean;
  /** importação marcada como "em curso" há tempo demais: provavelmente interrompida */
  stalled: boolean;
  /** a última importação trouxe a campanha, mas falhou no detalhe por grupo/anúncio */
  detailError: string | null;
}

export interface PlatformTotals {
  currency: string | null;
  metrics: MetricComparison[];
}

export interface PlatformPanel {
  platform: AdPlatform;
  label: string;
  /** estado real da fonte (mesma regra do Diagnóstico) */
  source: SourceStatus;
  account: {
    name: string;
    externalId: string;
    timezone: string | null;
    currency: string | null;
  } | null;
  sync: SyncState;
  coverage: { current: WindowCoverage; previous: WindowCoverage | null } | null;
  comparable: boolean;
  /** por que não dá para comparar (quando a comparação foi pedida) */
  comparabilityNote: string | null;
  /** frases objetivas sobre os dados do período (parcial, sem dado, fuso…) */
  notes: string[];
  totals: PlatformTotals[];
  campaignCount: number;
  /** dias recentes que a plataforma ainda pode reprocessar */
  restatementDays: number;
}

export interface CampaignsOverview {
  filters: CampaignFilters;
  /** avisos sobre os filtros pedidos (ex.: datas inválidas substituídas) */
  filterWarnings: string[];
  /** "hoje" de referência (America/Sao_Paulo) */
  today: string;
  panels: PlatformPanel[];
  rows: CampaignRow[];
  totalRows: number;
  pageCount: number;
  statusOptions: { value: string; label: string }[];
  /** campanhas sem status (Meta) ficam de fora quando há filtro de status */
  statusFilterExcludes: string | null;
  /** diagnóstico do período (Fase 2), calculado sobre os mesmos agregados */
  diagnostics: CampaignDiagnostic[];
}

export interface EntityRow {
  id: string;
  name: string;
  status: string | null;
  statusLabel: string | null;
  typeLabel: string | null;
  cost: MetricComparison;
  /** fatia do investimento do nível de cima no período (0..1); `null` sem base */
  costShare: number | null;
  impressions: MetricComparison;
  clicks: MetricComparison;
  ctr: MetricComparison;
  cpc: MetricComparison;
  results: MetricComparison;
  costPerResult: MetricComparison;
  href: string | null;
}

export interface EntityLevelView {
  level: "ad_group" | "ad";
  /** "Grupos de anúncios" · "Conjuntos de anúncios" · "Anúncios" */
  title: string;
  availability:
    | { state: "ready" }
    | { state: "migration_pending" | "not_imported" | "unsupported" | "no_rows"; message: string };
  /** limitações do detalhe neste período (cobertura menor que a da campanha etc.) */
  notes: string[];
  comparable: boolean;
  reconciliation: { childCost: number; parentCost: number; currency: string | null } | null;
  rows: EntityRow[];
  truncated: number;
}

export interface CampaignDetail {
  filters: CampaignFilters;
  filterWarnings: string[];
  panel: PlatformPanel;
  campaign: {
    id: string;
    name: string;
    status: string | null;
    statusLabel: string | null;
    kindLabel: string | null;
    currency: string | null;
    mixedCurrency: boolean;
  };
  result: ResultDefinition | null;
  metrics: MetricComparison[];
  /** Meta: eventos por tipo (lead, compra, cadastro), para auditar "resultados" */
  conversionBreakdown: MetricComparison[];
  /** o nível imediatamente abaixo (grupos/conjuntos na campanha; anúncios no grupo) */
  children: EntityLevelView;
  /** só na página do grupo/conjunto */
  group: { id: string; name: string; statusLabel: string | null; typeLabel: string | null } | null;
}
