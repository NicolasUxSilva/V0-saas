/**
 * Contratos do Advisor V1 (fundação — sem LLM).
 *
 *   AdvisorQuery ─▶ buildAdvisorContext ─▶ AdvisorContext ─▶ AdvisorModel ─▶ AdvisorResponse
 *
 * REGRA: a IA interpreta, o sistema calcula. O `AdvisorContext` é a ÚNICA entrada
 * oficial da camada de IA e é montado só a partir de saídas JÁ CALCULADAS e
 * persistidas — `insights` (o diagnóstico do motor) e `cross_source_insights`
 * (via `getCrossSourceInsights`). Nunca lê `fact_*`, `raw_records` nem o
 * `AnalysisContext` (INV-5) e nunca recalcula uma métrica (INV-6).
 *
 * As quatro camadas de afirmação do Cross-source continuam separadas aqui —
 * FATO · RELAÇÃO OBSERVÁVEL · HIPÓTESE · LIMITAÇÃO — e a EVIDÊNCIA é um registro à
 * parte, referenciado por `ref`. Nada se mistura.
 *
 * Tudo aqui é JSON puro (sem `Date`, sem `undefined` em campo obrigatório): o
 * contexto pode ser serializado para o modelo e a resposta pode atravessar a
 * fronteira do server action sem conversão.
 *
 * Este arquivo só tem TIPOS (e a constante da versão do formato) — a UI importa dele
 * (`import type`), então não pode puxar banco nem env.
 */
import type {
  InsightConfidence,
  InsightEvidence,
  InsightImpact,
  InsightKind,
  InsightSeverity,
  MetricFormat,
} from "../analysis/types";
import type {
  CrossSourceCategory,
  CrossSourceInsightType,
  CrossSourceSource,
  StatementLayer,
} from "../analysis/cross-source";

import type { AdvisorIntent } from "./intents";

export type { AdvisorIntent } from "./intents";
export type { StatementLayer } from "../analysis/cross-source";

/** Versão do formato do `AdvisorContext`/`AdvisorResponse` — sobe quando o shape muda. */
export const ADVISOR_SCHEMA_VERSION = 1 as const;

export type AdvisorSource = CrossSourceSource;

// ─────────────────────────────────────────────────────────────────────
// Período
// ─────────────────────────────────────────────────────────────────────

/** Período pedido: datas locais "YYYY-MM-DD", inclusivas nas duas pontas. */
export interface AdvisorPeriodInput {
  startDate: string;
  endDate: string;
}

export interface AdvisorPeriod extends AdvisorPeriodInput {
  /** dias do período (inclusivo): aritmética de calendário, não uma métrica */
  days: number;
}

// ─────────────────────────────────────────────────────────────────────
// Evidência
// ─────────────────────────────────────────────────────────────────────

/**
 * Um ponto de evidência exatamente como o Cross-source o persistiu, mais o valor já
 * formatado. É o formato de evidência que o projeto já tinha
 * (`CrossSourceEvidencePoint`) — só ganhou `ref` (único no contexto inteiro) e
 * `display`.
 */
export interface AdvisorEvidence {
  /** `<id do Cross-source>@<início>..<fim>` — único no contexto (o mesmo id pode valer em períodos diferentes) */
  ref: string;
  source: AdvisorSource;
  metric: string;
  /** rótulo legível (pt-BR) */
  label: string;
  /** período PRÓPRIO da fonte para este valor */
  period: { start: string; end: string };
  /** `null` = a métrica não existe/não é calculável — ausência de dado NUNCA vira 0 */
  value: number | null;
  /** `value` formatado em pt-BR (cópia determinística); `null` quando `value` é `null` */
  display: string | null;
  format: MetricFormat;
  /** só `format: "currency"`: `null` = a fonte não informa a moeda (nunca se assume BRL) */
  currency?: string | null;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Camadas de afirmação
// ─────────────────────────────────────────────────────────────────────

/** Uma frase do Cross-source, com o texto original e a evidência que a sustenta. */
export interface AdvisorStatement {
  /** `<tipo do insight>#<índice no insight>` — estável para um mesmo conjunto */
  ref: string;
  layer: StatementLayer;
  /** só em `limitation` */
  code?: string;
  /** texto original do Cross-source, sem reescrita */
  text: string;
  /** refs em `AdvisorContext.evidence` */
  evidenceRefs: string[];
  insightType: CrossSourceInsightType;
  category: CrossSourceCategory;
  sources: AdvisorSource[];
}

/**
 * Gravidade de uma limitação para quem lê os números:
 *  - `blocking` — uma fonte (ou a análise toda) NÃO está disponível: não há o que afirmar;
 *  - `warning`  — os números existem, mas incompletos, parciais ou sem comparação segura;
 *  - `info`     — definição/escopo permanente dos dados (não muda com o período).
 */
export type AdvisorLimitationSeverity = "blocking" | "warning" | "info";

export interface AdvisorLimitation {
  /** código estável: o consumidor reage sem parsear texto */
  code: string;
  message: string;
  /** de onde veio: o Cross-source, o diagnóstico do motor ou o próprio Advisor */
  origin: "cross_source" | "diagnostics" | "advisor";
  severity: AdvisorLimitationSeverity;
  /** fontes de dado a que a limitação se refere (vazio = a análise toda) */
  sources: AdvisorSource[];
  evidenceRefs: string[];
  insightType?: CrossSourceInsightType;
}

/** Hipótese — SEMPRE marcada como tal; nunca é um fato. */
export interface AdvisorHypothesis {
  ref: string;
  origin: "cross_source" | "diagnostics";
  text: string;
  evidenceRefs: string[];
  /** `cross_source`: o tipo do insight; `diagnostics`: o `dedupeKey` */
  from: string;
}

// ─────────────────────────────────────────────────────────────────────
// Cobertura por fonte
// ─────────────────────────────────────────────────────────────────────

/**
 *  - `covered`     — a fonte tem dado cobrindo o período inteiro;
 *  - `partial`     — tem dado, mas só parte do período (ou histórico importado parcial);
 *  - `unavailable` — nenhuma linha no período (ausência de dado);
 *  - `unknown`     — o Cross-source não foi gerado para o período: o Advisor não sabe.
 */
export type AdvisorSourceStatus = "covered" | "partial" | "unavailable" | "unknown";

export interface AdvisorSourceCoverage {
  source: AdvisorSource;
  label: string;
  status: AdvisorSourceStatus;
  /** `days_with_data` informado pelo Cross-source (fontes diárias); `null` quando não informou — nunca um 0 inventado */
  daysWithData: number | null;
  /** dias do período, presente junto com `daysWithData` */
  periodDays: number | null;
  /** códigos de limitação que explicam o status (vazio em `covered`) */
  limitationCodes: string[];
  evidenceRefs: string[];
}

export interface AdvisorCrossSourceState {
  /** `not_generated` = não há conjunto persistido para este período */
  status: "generated" | "not_generated";
  /** quando o conjunto foi gerado — o único sinal de frescor do persistido */
  generatedAt: string | null;
  schemaVersion: number | null;
  insights: {
    type: CrossSourceInsightType;
    title: string;
    category: CrossSourceCategory;
    sources: AdvisorSource[];
  }[];
}

// ─────────────────────────────────────────────────────────────────────
// Diagnóstico do motor
// ─────────────────────────────────────────────────────────────────────

/**
 * Um insight do diagnóstico (tabela `insights`), como o motor o gravou. O motor
 * analisa a janela padrão de 28 dias — `period` é a JANELA DELE, que pode não ser a
 * do período pedido (veja `AdvisorDiagnostics.alignedWithPeriod`).
 */
export interface AdvisorDiagnosticItem {
  dedupeKey: string;
  detector: string;
  kind: InsightKind;
  severity: InsightSeverity;
  status: "open" | "acknowledged";
  title: string;
  explanation: string;
  /** a hipótese do motor — continua sendo hipótese, nunca fato */
  hypothesis: string;
  recommendedAction: string;
  confidence: InsightConfidence;
  confidenceBasis: string;
  impact: InsightImpact | null;
  evidence: InsightEvidence;
  period: { start: string; end: string };
  comparedTo: string | null;
  priorityScore: number;
}

export interface AdvisorDiagnostics {
  status: "available" | "none";
  /**
   * `true` = todo insight é do período pedido; `false` = alguma janela do motor
   * difere (o diagnóstico NÃO descreve o período pedido); `null` = sem insights.
   */
  alignedWithPeriod: boolean | null;
  items: AdvisorDiagnosticItem[];
}

// ─────────────────────────────────────────────────────────────────────
// Comparação entre períodos (única aritmética do Advisor — determinística)
// ─────────────────────────────────────────────────────────────────────

export interface AdvisorComparisonItem {
  /** `<fonte>.<métrica>` */
  metricId: string;
  source: AdvisorSource;
  label: string;
  format: MetricFormat;
  currency?: string | null;
  /** valores copiados da evidência de cada período */
  current: number;
  baseline: number;
  currentRef: string;
  baselineRef: string;
  /** `current − baseline` */
  delta: number;
  /** `(current − baseline) ÷ baseline`; `null` quando `baseline` é 0 — nunca Infinity nem 0 */
  deltaPct: number | null;
  currentDisplay: string;
  baselineDisplay: string;
  deltaDisplay: string;
  deltaPctDisplay: string | null;
}

export interface AdvisorComparison {
  /** `computed` só quando os dois períodos são comparáveis */
  status: "computed" | "not_computable";
  baselinePeriod: AdvisorPeriod;
  /** por que não é computável (vazio quando `computed`) */
  reasons: AdvisorLimitation[];
  items: AdvisorComparisonItem[];
  /** métricas que existiam mas não foram comparadas, com o motivo */
  skipped: { metricId: string; label: string; reason: string }[];
  /** a evidência do período-base usada pelos itens (a do período atual está em `AdvisorContext.evidence`) */
  baselineEvidence: AdvisorEvidence[];
}

// ─────────────────────────────────────────────────────────────────────
// AdvisorContext — a entrada oficial da camada de IA
// ─────────────────────────────────────────────────────────────────────

export interface AdvisorContext {
  schemaVersion: typeof ADVISOR_SCHEMA_VERSION;
  workspaceId: string;
  period: AdvisorPeriod;
  /** instante em que ESTE contexto foi montado (ISO) */
  generatedAt: string;
  /** cobertura de cada fonte no período (sempre as três, na ordem ga4, rd_marketing, rd_crm) */
  sources: AdvisorSourceCoverage[];
  crossSource: AdvisorCrossSourceState;
  diagnostics: AdvisorDiagnostics;
  /** FATOS — frases `fact` do Cross-source */
  facts: AdvisorStatement[];
  /** RELAÇÕES OBSERVÁVEIS — coexistência no mesmo período; nunca causa */
  observations: AdvisorStatement[];
  /** HIPÓTESES — do Cross-source e do diagnóstico, sempre marcadas */
  hypotheses: AdvisorHypothesis[];
  /** LIMITAÇÕES — do Cross-source, do diagnóstico e do próprio Advisor, com gravidade */
  limitations: AdvisorLimitation[];
  /** EVIDÊNCIAS — o registro deduplicado; tudo acima aponta para cá por `ref` */
  evidence: AdvisorEvidence[];
  /** `null` fora do intento de comparação */
  comparison: AdvisorComparison | null;
}

// ─────────────────────────────────────────────────────────────────────
// AdvisorQuery
// ─────────────────────────────────────────────────────────────────────

export interface AdvisorQuery {
  /** na tela vem SEMPRE da sessão, nunca do cliente */
  workspaceId: string;
  period: AdvisorPeriodInput;
  /** só para `comparison`: o período-base */
  comparePeriod?: AdvisorPeriodInput;
  intent: AdvisorIntent;
  /** só para `free_question` */
  question?: string;
}

// ─────────────────────────────────────────────────────────────────────
// AdvisorResponse
// ─────────────────────────────────────────────────────────────────────

/**
 *  - `answered`       — respondeu com o que o contexto sustenta;
 *  - `partial`        — respondeu, mas faltam fontes/partes (as limitações dizem quais);
 *  - `not_computable` — a pergunta não é computável com estes dados (ex.: períodos não comparáveis);
 *  - `no_data`        — não há dado para o período (ex.: Cross-source não gerado);
 *  - `needs_model`    — exige o modelo de linguagem, que não está ativo neste ambiente.
 */
export type AdvisorResponseStatus =
  | "answered"
  | "partial"
  | "not_computable"
  | "no_data"
  | "needs_model";

/** A camada de cada item de uma seção — o mesmo vocabulário do Cross-source, mais diagnóstico e comparação. */
export type AdvisorItemLayer = StatementLayer | "diagnostic" | "comparison";

export interface AdvisorItem {
  layer: AdvisorItemLayer;
  text: string;
  evidenceRefs: string[];
  /** só em `limitation` */
  code?: string;
  /** só em `limitation` */
  severity?: AdvisorLimitationSeverity;
}

export interface AdvisorSection {
  id: string;
  title: string;
  /** uma ou duas frases de enquadramento */
  content: string;
  /** números estruturados — copiados do contexto, nunca digitados */
  figures: AdvisorEvidence[];
  items: AdvisorItem[];
}

export interface AdvisorFollowUp {
  intent: AdvisorIntent;
  label: string;
}

export interface AdvisorInsightRef {
  origin: "diagnostics" | "cross_source";
  /** `diagnostics`: o `dedupeKey`; `cross_source`: o tipo */
  key: string;
  title: string;
  kind?: InsightKind;
  severity?: InsightSeverity;
}

export interface AdvisorProvenance {
  /** `deterministic` ou o id do modelo que escreveu a resposta */
  producer: string;
  /** versão do prompt — só quando quem escreveu a resposta foi um modelo de linguagem (reproduzir/auditar) */
  promptVersion?: string;
  contextSchemaVersion: typeof ADVISOR_SCHEMA_VERSION;
  contextGeneratedAt: string;
  crossSource: { status: AdvisorCrossSourceState["status"]; generatedAt: string | null };
  diagnostics: { status: AdvisorDiagnostics["status"]; alignedWithPeriod: boolean | null };
  /** `true` quando a resposta de um modelo foi recusada pelo guard e trocada pela determinística */
  fellBack: boolean;
}

export interface AdvisorResponse {
  schemaVersion: typeof ADVISOR_SCHEMA_VERSION;
  intent: AdvisorIntent;
  status: AdvisorResponseStatus;
  title: string;
  /** o resumo executivo — só números que estão no contexto */
  summary: string;
  period: AdvisorPeriod;
  comparePeriod?: AdvisorPeriod;
  sections: AdvisorSection[];
  /** a comparação do contexto, copiada sem alteração — a tela monta a tabela a partir dela */
  comparison?: AdvisorComparison;
  insights: AdvisorInsightRef[];
  /** TODAS as limitações do contexto — um modelo nunca consegue tirar uma */
  limitations: AdvisorLimitation[];
  /** as evidências citadas na resposta (subconjunto do contexto) */
  evidence: AdvisorEvidence[];
  followUps: AdvisorFollowUp[];
  provenance: AdvisorProvenance;
}

// ─────────────────────────────────────────────────────────────────────
// AdvisorModel — a interface para plugar um LLM depois
// ─────────────────────────────────────────────────────────────────────

/** Seção como um modelo a devolve: números por REFERÊNCIA (`figureRefs`), nunca digitados. */
export interface AdvisorDraftSection {
  id: string;
  title: string;
  content: string;
  figureRefs: string[];
  items: AdvisorItem[];
}

/**
 * O que um modelo devolve. O serviço completa o resto de forma determinística —
 * figuras, evidência, limitações e proveniência — para que um modelo nunca consiga
 * omitir uma limitação nem alterar um número.
 */
export interface AdvisorModelResponse {
  status: AdvisorResponseStatus;
  title: string;
  summary: string;
  sections: AdvisorDraftSection[];
  insightRefs: { origin: "diagnostics" | "cross_source"; key: string }[];
  followUps: AdvisorFollowUp[];
  /** limitações do PRÓPRIO modelo/serviço (ex.: LLM não conectado); sempre `origin: "advisor"` */
  extraLimitations?: AdvisorLimitation[];
}

export interface AdvisorModelInput {
  context: AdvisorContext;
  query: AdvisorQuery;
}

export interface AdvisorModel {
  /** identifica o produtor em `provenance.producer` */
  readonly id: string;
  /** versão do prompt de um modelo de linguagem; vai para `provenance.promptVersion` */
  readonly promptVersion?: string;
  generate(input: AdvisorModelInput): Promise<AdvisorModelResponse>;
}

/**
 * Estado do modelo de linguagem neste ambiente (o que a tela precisa saber):
 *  - `off`            — `ADVISOR_LLM_ENABLED=false`: só o modelo determinístico;
 *  - `ready`          — habilitado e com credencial;
 *  - `not_configured` — habilitado, mas sem credencial: o Advisor responde de forma
 *                       determinística e diz isso.
 */
export type AdvisorLlmStatus = "off" | "ready" | "not_configured";
