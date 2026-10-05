/**
 * Log de METADADOS do Advisor — nunca de conteúdo.
 *
 * O que pode ser registrado: workspace, intenção, período, provedor, modelo, versão do
 * prompt, resultado (sucesso/falha/fallback), motivo, latência, contagem de tokens,
 * id da requisição do provedor e códigos de violação do guard.
 *
 * O que NUNCA é registrado: o prompt, o `AdvisorContext`, a pergunta do usuário, a
 * resposta do modelo, a credencial, texto de erro do provedor (que pode ecoar o
 * pedido) e qualquer dado do banco além de contagens. A garantia é dupla:
 *  1. o TIPO `AdvisorLogEvent` só tem campos de metadado (um campo de conteúdo não
 *     compila);
 *  2. a serialização usa uma LISTA DE CAMPOS PERMITIDOS (`JSON.stringify` com array
 *     de chaves) — um campo extra que escape do tipo (`as any`, objeto espalhado) é
 *     descartado em tempo de execução.
 */
import type { AdvisorIntent } from "./intents";
import type { ModelFailureReason } from "./limitations";
import type { AdvisorResponseStatus } from "./types";

interface Base {
  workspaceId: string;
  intent: AdvisorIntent;
  period: { start: string; end: string };
}

/** Uma chamada ao provedor (emitida pelo modelo de linguagem). */
export interface AdvisorLlmLogEvent extends Base {
  event: "advisor.llm";
  provider: string;
  model: string;
  promptVersion: string;
  outcome: "ok" | "failed";
  reason?: ModelFailureReason;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  httpStatus?: number;
  providerErrorType?: string;
  /** tipos de PII encontrados (nunca os valores) quando o envio foi bloqueado */
  piiKinds?: string[];
}

/** O desfecho de uma pergunta (emitida pelo serviço). */
export interface AdvisorAnswerLogEvent extends Base {
  event: "advisor.answer";
  producer: string;
  status: AdvisorResponseStatus;
  outcome: "answered" | "fallback_rejected" | "fallback_failed" | "skipped";
  skippedReason?: "no_data" | "comparison_not_computable";
  fellBack: boolean;
  /** códigos do guard que recusaram a resposta do modelo (nunca o texto) */
  violationCodes?: string[];
  latencyMs: number;
}

export type AdvisorLogEvent = AdvisorLlmLogEvent | AdvisorAnswerLogEvent;

/** As ÚNICAS chaves que chegam ao log, em qualquer nível. */
export const LOGGABLE_KEYS: readonly string[] = [
  "event",
  "workspaceId",
  "intent",
  "period",
  "start",
  "end",
  "provider",
  "model",
  "promptVersion",
  "outcome",
  "reason",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "requestId",
  "httpStatus",
  "providerErrorType",
  "piiKinds",
  "producer",
  "status",
  "skippedReason",
  "fellBack",
  "violationCodes",
];

/** A linha de log de um evento: JSON só com as chaves permitidas. */
export function serializeAdvisorEvent(event: AdvisorLogEvent): string {
  return JSON.stringify(event, LOGGABLE_KEYS as string[]);
}

export type AdvisorLogSink = (event: AdvisorLogEvent) => void;

/** O destino padrão: uma linha JSON no log do servidor (`warn` quando houve falha ou fallback). */
export const logAdvisorEvent: AdvisorLogSink = (event) => {
  const bad =
    (event.event === "advisor.llm" && event.outcome === "failed") ||
    (event.event === "advisor.answer" && event.fellBack);
  const line = `[advisor] ${serializeAdvisorEvent(event)}`;
  if (bad) console.warn(line);
  else console.info(line);
};
