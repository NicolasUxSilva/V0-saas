/**
 * Intenções do Advisor — o que o usuário está pedindo — e as sugestões da tela.
 *
 * Puro e sem dependências: a UI (client component) importa daqui, então este
 * arquivo NÃO pode puxar banco, env nem nada do servidor.
 */
export const ADVISOR_INTENTS = [
  "period_summary",
  "closing_report",
  "problems",
  "diagnostic_explanation",
  "acquisition_analysis",
  "commercial_analysis",
  "opportunities",
  "comparison",
  "free_question",
] as const;

export type AdvisorIntent = (typeof ADVISOR_INTENTS)[number];

export const INTENT_LABEL: Record<AdvisorIntent, string> = {
  period_summary: "Resumo do período",
  closing_report: "Fechamento do período",
  problems: "Problemas encontrados",
  diagnostic_explanation: "O que aconteceu",
  acquisition_analysis: "Performance de aquisição",
  commercial_analysis: "Performance comercial",
  opportunities: "Oportunidades",
  comparison: "Comparativo entre períodos",
  free_question: "Pergunta livre",
};

export interface AdvisorSuggestion {
  intent: AdvisorIntent;
  /** rótulo do botão */
  label: string;
  /** uma linha sobre o que a resposta traz */
  hint: string;
}

/**
 * Os botões da tela. `free_question` não está aqui: é o campo de texto, e só ganha
 * uma resposta de verdade quando houver um modelo de linguagem conectado.
 */
export const ADVISOR_SUGGESTIONS: readonly AdvisorSuggestion[] = [
  {
    intent: "closing_report",
    label: "Fechamento do período",
    hint: "Aquisição, comercial, ganhos e perdas, cobertura e limitações.",
  },
  {
    intent: "period_summary",
    label: "Resumo executivo",
    hint: "Todos os dados disponíveis do período, por fonte.",
  },
  {
    intent: "acquisition_analysis",
    label: "Performance de aquisição",
    hint: "GA4 e RD Marketing lado a lado, sem taxa conjunta.",
  },
  {
    intent: "commercial_analysis",
    label: "Performance comercial",
    hint: "Negócios criados, ganhos, perdidos, valores e origem.",
  },
  {
    intent: "comparison",
    label: "Comparativo mensal",
    hint: "Só responde quando os dois períodos são comparáveis.",
  },
  {
    intent: "problems",
    label: "Principais problemas",
    hint: "Insights do diagnóstico e limitações que pedem atenção.",
  },
  {
    intent: "opportunities",
    label: "Oportunidades",
    hint: "Hipóteses a investigar, sempre marcadas como hipótese.",
  },
  {
    intent: "diagnostic_explanation",
    label: "O que aconteceu?",
    hint: "Só o que os dados e os insights sustentam, sem causa inventada.",
  },
];
