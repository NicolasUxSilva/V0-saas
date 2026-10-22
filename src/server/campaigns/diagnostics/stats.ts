/**
 * Estatística mínima do diagnóstico — PURO. Aproximações normais clássicas sobre as
 * CONTAGENS que sustentam cada métrica (cliques, impressões, resultados). Servem para
 * dizer se uma mudança é maior que o ruído esperado para aquele volume — não são um
 * modelo da campanha. Entradas inválidas (zero, negativas) devolvem `null`: sem base,
 * sem evidência.
 */

/**
 * Duas proporções (ex.: CTR = cliques/impressões): z da diferença p1 − p2 com variância
 * agrupada. Positivo quando a 1ª proporção é maior.
 */
export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return null;
  return (x1 / n1 - x2 / n2) / se;
}

/**
 * Razão "custo por contagem" (CPC = custo/cliques; custo por resultado = custo/resultados)
 * entre dois períodos, tratando as contagens como Poisson e o custo como dado:
 * z = ln(r1/r2) / √(1/k1 + 1/k2). Positivo quando a razão do período 1 é maior.
 */
export function costPerCountZ(cost1: number, k1: number, cost2: number, k2: number): number | null {
  if (cost1 <= 0 || cost2 <= 0 || k1 <= 0 || k2 <= 0) return null;
  return Math.log(cost1 / k1 / (cost2 / k2)) / Math.sqrt(1 / k1 + 1 / k2);
}

/**
 * Duas contagens Poisson de períodos de MESMA duração: z = (k1 − k2) / √(k1 + k2).
 * Positivo quando o período 1 tem mais.
 */
export function poissonDiffZ(k1: number, k2: number): number | null {
  if (k1 < 0 || k2 < 0 || k1 + k2 === 0) return null;
  return (k1 - k2) / Math.sqrt(k1 + k2);
}
