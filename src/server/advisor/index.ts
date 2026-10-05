/**
 * Advisor V1 — a porta do servidor.
 *
 *   dados reais ─▶ AnalysisContext ─▶ motor determinístico ─▶ Cross-source
 *        ─▶ `insights` + `cross_source_insights` (persistidos)
 *        ─▶ buildAdvisorContext ─▶ AdvisorContext ─▶ AdvisorQuery ─▶ AdvisorModel
 *        ─▶ guard ─▶ AdvisorResponse
 *   AdvisorModel = o determinístico (sempre) ou um modelo de linguagem (`ADVISOR_LLM_ENABLED`),
 *   que recebe só uma projeção do contexto, sem PII, e cuja saída passa por schema + guard.
 *
 * A IA INTERPRETA; o SISTEMA CALCULA. O Advisor só lê saídas já calculadas e
 * persistidas, nunca recalcula uma métrica e nunca escreve em lugar nenhum.
 *
 * CLIENT COMPONENTS não importam daqui (este arquivo puxa o banco via `readers`):
 * eles usam só `./types` (tipos) e `./intents` (constantes puras).
 */
export { buildAdvisorContext, type AdvisorContextDeps } from "./context";
export { composeAdvisorContext, figuresOf, AdvisorContextError } from "./compose";
export { compareAdvisorContexts, COMPARABLE_METRICS } from "./comparison";
export { answerAdvisorQuery, deterministicModel, AdvisorInternalError, type AdvisorServiceDeps } from "./service";
export {
  DeterministicAdvisorModel,
  answerDeterministically,
  type DeterministicOptions,
} from "./deterministic-model";
export { parseAdvisorQuery, AdvisorQueryError } from "./query";
export {
  validateAdvisorResponse,
  validateLlmDraft,
  validateModelResponse,
  type GuardViolation,
  type GuardViolationCode,
} from "./guard";
export {
  ADVISOR_INTERPRETATION_RULES,
  ADVISOR_PROMPT_VERSION,
  buildAdvisorModelInput,
  type AdvisorPromptInput,
  type InterpretationRule,
} from "./llm-contract";
export { createAdvisorReaders, defaultReaders, type AdvisorReaders } from "./readers";
export { isAdvisorEnabled, isAdvisorLlmEnabled } from "./flag";
export {
  advisorLlmStatus,
  getConfiguredAdvisorModel,
  type AdvisorLlmEnv,
} from "./llm/config";
export { LlmAdvisorModel, UnconfiguredLlmModel } from "./llm/model";
export { AdvisorLlmError, type LlmTransport } from "./llm/transport";
export { logAdvisorEvent, type AdvisorLogEvent, type AdvisorLogSink } from "./log";
export type { ModelFailureReason } from "./limitations";
export { ADVISOR_INTENTS, ADVISOR_SUGGESTIONS, INTENT_LABEL } from "./intents";
export * from "./types";
