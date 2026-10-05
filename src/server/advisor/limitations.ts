/**
 * Gravidade das limitações e as limitações que o PRÓPRIO Advisor acrescenta.
 *
 * Os códigos das limitações do Cross-source são estáveis (é para isso que existem):
 * a gravidade é uma tabela explícita por código, não uma heurística sobre o texto.
 * Um código novo do Cross-source que ainda não esteja aqui cai em `warning` — o
 * lado seguro: nunca é tratado como inofensivo — e o teste de completude
 * (`advisor-limitations.test.ts`) falha até alguém classificá-lo de propósito.
 *
 * O Advisor não decide o que é limitação: ele só preserva as do Cross-source e
 * descreve as do seu próprio caminho (Cross-source não gerado, janela do
 * diagnóstico diferente, comparação não computável…).
 */
import { brDate, periodText } from "./format";
import type {
  AdvisorContext,
  AdvisorLimitation,
  AdvisorLimitationSeverity,
  AdvisorPeriod,
  AdvisorSource,
} from "./types";

/** Códigos fixos do Cross-source → gravidade. */
export const LIMITATION_SEVERITY: Readonly<Record<string, AdvisorLimitationSeverity>> = {
  // fonte (ou toda a aquisição) sem dado: não há o que afirmar sobre ela
  ga4_unavailable: "blocking",
  rd_marketing_unavailable: "blocking",
  rd_crm_unavailable: "blocking",
  no_acquisition_data: "blocking",

  // há números, mas incompletos / parciais / sem comparação segura
  period_not_aligned: "warning",
  period_mismatch: "warning",
  ga4_partial_days: "warning",
  ga4_data_lag: "warning",
  rd_marketing_partial_days: "warning",
  rd_crm_partial_imported_history: "warning",
  rd_marketing_no_conversions: "warning",
  won_value_partial: "warning",
  lost_value_partial: "warning",
  currency_not_informed: "warning",
  campaign_id_insufficient: "warning",
  source_id_insufficient: "warning",

  // definição/escopo permanente dos dados
  rd_marketing_scope: "info",
  no_joint_rate: "info",
  win_rate_scope: "info",
  pipelines_aggregated: "info",
  deal_state_snapshot: "info",
  coexistence_only: "info",
  no_origin_mapping: "info",
  attribution_not_supported: "info",
  populations_differ: "info",
};

/** Famílias com sufixo variável: `not_computed:<relação>` e `metric_not_computable:<métrica>`. */
const SEVERITY_BY_PREFIX: readonly (readonly [string, AdvisorLimitationSeverity])[] = [
  ["not_computed:", "info"],
  ["metric_not_computable:", "warning"],
];

/** `true` quando o código foi classificado de propósito (tabela ou prefixo). */
export function isClassified(code: string): boolean {
  return (
    Object.hasOwn(LIMITATION_SEVERITY, code) ||
    SEVERITY_BY_PREFIX.some(([prefix]) => code.startsWith(prefix))
  );
}

export function severityOf(code: string): AdvisorLimitationSeverity {
  if (Object.hasOwn(LIMITATION_SEVERITY, code)) return LIMITATION_SEVERITY[code]!;
  for (const [prefix, severity] of SEVERITY_BY_PREFIX) {
    if (code.startsWith(prefix)) return severity;
  }
  return "warning";
}

const RANK: Record<AdvisorLimitationSeverity, number> = { blocking: 0, warning: 1, info: 2 };

/** Ordena do mais grave ao menos grave, mantendo a ordem original dentro de cada gravidade. */
export function bySeverity<T extends { severity: AdvisorLimitationSeverity }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.severity] - RANK[b.item.severity] || a.index - b.index)
    .map(({ item }) => item);
}

// ─────────────────────────────────────────────────────────────────────
// Limitações do próprio Advisor
// ─────────────────────────────────────────────────────────────────────

const advisor = (
  code: string,
  severity: AdvisorLimitationSeverity,
  message: string,
  extra: Partial<AdvisorLimitation> = {},
): AdvisorLimitation => ({
  code,
  message,
  origin: "advisor",
  severity,
  sources: [],
  evidenceRefs: [],
  ...extra,
});

/** Não há conjunto Cross-source persistido para o período. */
export function crossSourceNotGenerated(period: AdvisorPeriod): AdvisorLimitation {
  return advisor(
    "cross_source_not_generated",
    "blocking",
    `Não há Cross-source gerado para o período ${periodText({ start: period.startDate, end: period.endDate })}. O Advisor só interpreta resultados já calculados e persistidos; ele não gera dados. Sem esse conjunto não há fatos de GA4, RD Marketing nem RD CRM para este período.`,
  );
}

/** O diagnóstico do motor é de uma janela que não é a do período pedido. */
export function diagnosticsPeriodDiffers(
  period: AdvisorPeriod,
  windows: { start: string; end: string }[],
): AdvisorLimitation {
  const listed = windows.map((w) => periodText(w)).join("; ");
  return advisor(
    "diagnostics_period_differs",
    "warning",
    `O diagnóstico do motor refere-se a outra janela (${listed}), não ao período solicitado (${periodText({ start: period.startDate, end: period.endDate })}): os insights dele não descrevem o período pedido.`,
  );
}

/** Dois contextos com a mesma chave de evidência e valores diferentes — o primeiro vale. */
export function evidenceConflict(ref: string): AdvisorLimitation {
  return advisor(
    "evidence_conflict",
    "warning",
    `O conjunto Cross-source traz valores diferentes para a mesma evidência (${ref}); foi mantido o primeiro valor.`,
  );
}

/** A comparação não é computável — uma razão por precondição que falhou. */
export function comparisonNotComputable(
  code: string,
  message: string,
  sources: AdvisorSource[] = [],
): AdvisorLimitation {
  return advisor(`comparison_not_computable:${code}`, "blocking", message, { sources });
}

/** Pergunta livre sem modelo de linguagem ativo neste ambiente (`ADVISOR_LLM_ENABLED=false`). */
export function llmNotConnected(): AdvisorLimitation {
  return advisor(
    "llm_not_connected",
    "info",
    "Perguntas livres precisam do modelo de linguagem do Advisor, que não está ativo neste ambiente. Nenhuma resposta foi inventada.",
  );
}

/** A resposta de um modelo foi recusada pelo guard e trocada pela determinística. */
export function modelOutputRejected(modelId: string, violationCodes: string[]): AdvisorLimitation {
  return advisor(
    "model_output_rejected",
    "warning",
    `A resposta do modelo “${modelId}” foi recusada pela validação (${[...new Set(violationCodes)].join(", ")}) e substituída pela resposta determinística.`,
  );
}

/**
 * Por que um modelo de linguagem não entregou uma resposta utilizável. É o vocabulário
 * único de falha: o adaptador do provedor lança com um destes códigos e o serviço o
 * traduz aqui — nunca o texto do provedor, que pode ecoar o pedido.
 */
export type ModelFailureReason =
  | "not_configured"
  | "timeout"
  | "unavailable"
  | "rejected_by_provider"
  | "billing"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "privacy_blocked";

export const MODEL_FAILURE_TEXT: Record<ModelFailureReason, string> = {
  not_configured: "o modelo de linguagem está habilitado, mas não está configurado neste ambiente",
  timeout: "o modelo excedeu o tempo limite",
  unavailable: "o serviço do modelo está indisponível no momento",
  rejected_by_provider: "o provedor recusou o pedido",
  billing: "a conta do provedor do modelo está sem crédito ou atingiu o limite de gasto",
  refusal: "o modelo recusou responder",
  truncated: "a resposta do modelo veio incompleta",
  invalid_output: "a resposta do modelo não tinha o formato esperado",
  privacy_blocked: "a pergunta contém dado pessoal e não foi enviada ao modelo",
};

/** Um `code` de erro que é do vocabulário de falhas de modelo (qualquer `AdvisorModel` pode lançá-lo). */
export function modelFailureReasonOf(error: unknown): ModelFailureReason | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(MODEL_FAILURE_TEXT, code)
    ? (code as ModelFailureReason)
    : undefined;
}

/** O modelo falhou (erro/timeout/não configurado) e a resposta determinística foi usada. */
export function modelFailed(modelId: string, reason?: ModelFailureReason): AdvisorLimitation {
  const why = reason ? ` (${MODEL_FAILURE_TEXT[reason]})` : "";
  return advisor(
    "model_failed",
    "warning",
    `O modelo “${modelId}” não respondeu${why}; a resposta determinística foi usada no lugar.`,
  );
}

/** Texto curto de um período para mensagens. */
export const rangeText = (p: { start: string; end: string }): string =>
  `${brDate(p.start)} a ${brDate(p.end)}`;

/** A limitação do contexto com este código (as do contexto e as razões da comparação). */
export function findLimitation(
  context: Pick<AdvisorContext, "limitations" | "comparison">,
  code: string,
): AdvisorLimitation | undefined {
  return (
    context.limitations.find((l) => l.code === code) ??
    context.comparison?.reasons.find((l) => l.code === code)
  );
}
