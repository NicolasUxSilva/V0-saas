/**
 * Chaves de liga/desliga do Advisor — separadas de propósito (INV-8: o produto funciona
 * 100% com tudo desligado).
 *
 *  - `ADVISOR_ENABLED` (padrão `true`): a tela e o server action do Advisor. Desligado,
 *    a tela mostra o estado "desativado" e o action recusa — `/diagnostico` e o resto
 *    do produto não dependem dele em nada.
 *  - `ADVISOR_LLM_ENABLED` (padrão `false`): o modelo de linguagem. Ligar o Advisor NÃO
 *    liga o LLM. Desligado, o Advisor responde só com o modelo determinístico. A
 *    decisão de qual `AdvisorModel` usar fica em `llm/config.ts`.
 */
import { env } from "@/env";

export function isAdvisorEnabled(): boolean {
  return env.ADVISOR_ENABLED;
}

export function isAdvisorLlmEnabled(): boolean {
  return env.ADVISOR_LLM_ENABLED;
}
