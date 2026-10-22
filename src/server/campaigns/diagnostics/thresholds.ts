/**
 * Limiares do diagnóstico de campanhas — TODOS aqui, num lugar só.
 *
 * Nenhum destes números é uma "verdade universal" de mídia paga: são pontos de partida
 * conservadores para um primeiro sinal, escolhidos para errar do lado de NÃO alertar.
 * Cada regra combina três coisas, sempre separadas:
 *
 *  1. VOLUME MÍNIMO — abaixo dele a regra nem olha a variação (amostra pequena demais);
 *  2. MAGNITUDE — o tamanho da mudança que vale a pena mostrar; define a SEVERIDADE;
 *  3. EVIDÊNCIA ESTATÍSTICA — um z aproximado (Poisson/binomial) sobre as contagens que
 *     sustentam a métrica; define a CONFIANÇA. Mudança grande com evidência fraca vira
 *     "inconclusivo", nunca uma afirmação categórica.
 *
 * O peso financeiro (fatia do investimento da plataforma, na mesma moeda) ajusta a
 * severidade em um nível para cima ou para baixo — um problema em 1% do gasto não é
 * tão urgente quanto o mesmo problema em 40%.
 *
 * Mudar um valor aqui muda o comportamento: os testes em `__tests__/diagnostics*.test.ts`
 * travam os casos de borda de cada regra.
 */

/** z a partir do qual a evidência é "média" e "alta" (≈ p < 0,05 e p < 0,003, bilateral). */
export const Z_MEDIUM = 2;
export const Z_HIGH = 3;

/** Fatia do investimento da plataforma (mesma moeda) que sobe/desce a severidade. */
export const SHARE_RAISES_SEVERITY = 0.2;
export const SHARE_LOWERS_SEVERITY = 0.05;

/**
 * Cobertura: fração mínima de dias FECHADOS no período atual para as regras que olham
 * só o período atual (A, F). Abaixo disso, vira limitação. Comparações (B–E) exigem os
 * dois períodos 100% importados — a regra da Fase 1 (`comparability`).
 */
export const MIN_CLOSED_DAY_SHARE = 0.8;

/**
 * A — investimento sem resultados reportados.
 * "Resultados esperados" = investimento ÷ custo por resultado de referência (o do nível de
 * cima, ou o da plataforma na mesma moeda e definição). Com λ resultados esperados, a
 * chance de ver zero por acaso é e^−λ: λ=2 → 13,5%; λ=3 → 5%; λ=5 → 0,7%.
 */
export const A = {
  /** abaixo disto ainda é cedo para estranhar o zero: nada é emitido */
  MIN_EXPECTED: 2,
  /** de 2 a 3 resultados esperados: inconclusivo; a partir de 3: achado (confiança média) */
  EXPECTED_MEDIUM: 3,
  /** a partir de 5 resultados esperados: confiança alta */
  EXPECTED_HIGH: 5,
  /** severidade por resultados esperados não obtidos */
  SEVERITY_HIGH: 5,
  SEVERITY_MEDIUM: 3,
} as const;

/** B — custo por resultado subiu. */
export const B = {
  /** resultados mínimos em CADA período (custo por resultado com 1–4 resultados é ruído) */
  MIN_RESULTS: 5,
  /** alta mínima para mostrar (+25%) */
  MIN_INCREASE: 0.25,
  SEVERITY_MEDIUM: 0.35,
  SEVERITY_HIGH: 0.6,
} as const;

/** C — CTR caiu. */
export const C = {
  /** impressões mínimas em cada período */
  MIN_IMPRESSIONS: 1000,
  /** cliques mínimos no período anterior (a base da taxa) */
  MIN_PREVIOUS_CLICKS: 30,
  /** queda relativa mínima (−15%) */
  MIN_DROP: 0.15,
  SEVERITY_MEDIUM: 0.25,
  SEVERITY_HIGH: 0.4,
} as const;

/** D — CPC subiu. */
export const D = {
  /** cliques mínimos em cada período */
  MIN_CLICKS: 50,
  MIN_INCREASE: 0.2,
  SEVERITY_MEDIUM: 0.3,
  SEVERITY_HIGH: 0.5,
} as const;

/**
 * CPC × CTR: se o CPM variou menos que isto, a alta do CPC é explicada pela queda do CTR
 * (CPC = CPM ÷ (1000 × CTR)) e entra como consequência no alerta de CTR, não como outro.
 */
export const CPM_STABLE_BAND = 0.15;

/** E — resultados caíram. */
export const E = {
  /** resultados mínimos no período anterior */
  MIN_PREVIOUS_RESULTS: 10,
  MIN_DROP: 0.3,
  SEVERITY_MEDIUM: 0.45,
  SEVERITY_HIGH: 0.6,
  /**
   * Se o custo por resultado ficou dentro desta faixa (±15%), a queda acompanha a queda
   * do investimento: o texto diz isso e a severidade cai para "baixa".
   */
  STABLE_CPR_BAND: 0.15,
} as const;

/** Melhora do custo por resultado (sinal positivo, informativo). */
export const IMPROVEMENT = {
  MIN_RESULTS: 5,
  MIN_DECREASE: 0.25,
} as const;

/** F — distribuição do investimento entre os filhos de um nível. */
export const F = {
  /** fatia do investimento do pai em filhos com resultado definido e zero resultados */
  ZERO_RESULT_SHARE: 0.25,
  ZERO_RESULT_SHARE_MEDIUM: 0.35,
  ZERO_RESULT_SHARE_HIGH: 0.5,
  /** fatia de UM filho a partir da qual a concentração é mostrada (informativo) */
  CONCENTRATION_SHARE: 0.7,
  /** filhos com investimento mínimos para falar em distribuição */
  MIN_CHILDREN: 3,
} as const;
