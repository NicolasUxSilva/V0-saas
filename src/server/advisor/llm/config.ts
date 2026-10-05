/**
 * Configuração do modelo de linguagem do Advisor — a ÚNICA ponte entre o ambiente
 * (`@/env`) e o resto do módulo. Decide qual `AdvisorModel` o server action usa:
 *
 *   ADVISOR_LLM_ENABLED=false (padrão) ─▶ nenhum: o serviço usa o modelo determinístico
 *   habilitado, sem ANTHROPIC_API_KEY  ─▶ `UnconfiguredLlmModel`: determinístico + aviso honesto
 *   habilitado, com a chave            ─▶ `LlmAdvisorModel` sobre o adaptador da Anthropic
 *
 * A credencial é lida aqui, passada ao adaptador por parâmetro e nunca registrada.
 */
import { env } from "@/env";

import type { AdvisorLlmStatus, AdvisorModel } from "../types";

import { createAnthropicTransport } from "./anthropic";
import { LlmAdvisorModel, UnconfiguredLlmModel } from "./model";

/** O que a configuração precisa do ambiente — injetável nos testes. */
export interface AdvisorLlmEnv {
  ADVISOR_LLM_ENABLED: boolean;
  ANTHROPIC_API_KEY?: string | undefined;
  ADVISOR_LLM_MODEL: string;
  ADVISOR_LLM_EFFORT: "low" | "medium" | "high";
  ADVISOR_LLM_TIMEOUT_MS: number;
}

export function advisorLlmStatus(source: AdvisorLlmEnv = env): AdvisorLlmStatus {
  if (!source.ADVISOR_LLM_ENABLED) return "off";
  return source.ANTHROPIC_API_KEY ? "ready" : "not_configured";
}

/** `undefined` = LLM desligado: o serviço usa o modelo determinístico (comportamento da fundação). */
export function getConfiguredAdvisorModel(source: AdvisorLlmEnv = env): AdvisorModel | undefined {
  const status = advisorLlmStatus(source);
  if (status === "off") return undefined;
  if (status === "not_configured" || !source.ANTHROPIC_API_KEY) {
    return new UnconfiguredLlmModel("anthropic", source.ADVISOR_LLM_MODEL);
  }
  return new LlmAdvisorModel(
    createAnthropicTransport({
      apiKey: source.ANTHROPIC_API_KEY,
      model: source.ADVISOR_LLM_MODEL,
      effort: source.ADVISOR_LLM_EFFORT,
      timeoutMs: source.ADVISOR_LLM_TIMEOUT_MS,
    }),
  );
}
