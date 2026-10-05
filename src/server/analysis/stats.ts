/**
 * Estatística determinística (bloco C0). Funções puras, sem dependências.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

/** Median Absolute Deviation. */
export function mad(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Desvio-padrão robusto: 1.4826 · MAD (consistente com σ para dados normais). */
export function robustSigma(xs: number[]): number {
  return 1.4826 * mad(xs);
}

/** CDF da normal padrão Φ(z), via aproximação de erf (Abramowitz & Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function twoTailedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/**
 * Teste z de duas proporções. x = sucessos, n = total. Retorna z (positivo se
 * p1 > p2) e o p-valor bicaudal.
 */
export function twoProportionZTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { z: number; p: number; p1: number; p2: number } {
  const p1 = n1 > 0 ? x1 / n1 : 0;
  const p2 = n2 > 0 ? x2 / n2 : 0;
  if (n1 === 0 || n2 === 0) return { z: 0, p: 1, p1, p2 };
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (p1 - p2) / se : 0;
  return { z, p: twoTailedP(z), p1, p2 };
}

/**
 * z robusto da MÉDIA de `sample` contra a distribuição diária de `baseline`.
 * σ vem do MAD do baseline; erro-padrão da média = σ / √n.
 */
export function robustZOfMean(
  sample: number[],
  baseline: number[],
): { z: number; sampleMean: number; baselineMedian: number; sigma: number } {
  const sampleMean = mean(sample);
  const baselineMedian = median(baseline);
  const sigma = robustSigma(baseline);
  if (sigma === 0 || sample.length === 0) {
    return { z: 0, sampleMean, baselineMedian, sigma };
  }
  const se = sigma / Math.sqrt(sample.length);
  return { z: (sampleMean - baselineMedian) / se, sampleMean, baselineMedian, sigma };
}

// ─────────────────────────────────────────────────────────────────────
// Sazonalidade semanal (bloco D1 #4)
// ─────────────────────────────────────────────────────────────────────

function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Dom .. 6=Sáb
}

/**
 * Perfil de sazonalidade semanal a partir de uma série diária.
 * `factor[dow]` (0=Dom..6=Sáb) = mediana(valores nesse dia da semana) /
 * mediana(todos). Dias com menos de `minSamples` amostras ficam com fator 1.
 * O fator é limitado a [0,1; 5] para evitar amplificação patológica.
 */
export function weekdayProfile(
  series: { date: string; value: number }[],
  minSamples = 4,
): number[] {
  const overall = median(series.map((p) => p.value));
  const buckets: number[][] = [[], [], [], [], [], [], []];
  for (const p of series) {
    const b = buckets[dayOfWeek(p.date)];
    if (b) b.push(p.value);
  }
  return buckets.map((vals) => {
    if (overall <= 0 || vals.length < minSamples) return 1;
    const m = median(vals);
    if (m <= 0) return 1;
    return Math.min(Math.max(m / overall, 0.1), 5);
  });
}

/** Divide cada valor pelo fator do seu dia da semana (remove a sazonalidade). */
export function deseasonalize(
  series: { date: string; value: number }[],
  profile: number[],
): { date: string; value: number }[] {
  return series.map((p) => {
    const f = profile[dayOfWeek(p.date)] ?? 1;
    return { date: p.date, value: f > 0 ? p.value / f : p.value };
  });
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
}

/** Remove a tendência linear (mínimos quadrados) da série — sobram os resíduos. */
function detrend(values: number[]): number[] {
  const n = values.length;
  if (n < 3) return values.slice();
  const mx = (n - 1) / 2;
  const my = mean(values);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * ((values[i] ?? 0) - my);
    sxx += (i - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  return values.map((v, i) => v - (intercept + slope * i));
}

/**
 * Detecção simples de ponto de quebra (DEGRAU, não tendência).
 *
 * Remove a tendência linear e roda um max-t sobre os resíduos: para cada split
 * candidato calcula a estatística t entre antes/depois e devolve o de maior |t|.
 * Se |t| < `minT`, devolve null (declínio gradual ou sem quebra clara — usa-se
 * "no período" nesse caso).
 */
export function changePoint(
  series: { date: string; value: number }[],
  opts: { minSegment?: number; minT?: number } = {},
): { date: string; tStat: number } | null {
  const minSegment = opts.minSegment ?? 5;
  const minT = opts.minT ?? 4;
  if (series.length < minSegment * 2) return null;

  const residuals = detrend(series.map((p) => p.value));

  let best: { date: string; tStat: number } | null = null;
  for (let k = minSegment; k <= residuals.length - minSegment; k++) {
    const a = residuals.slice(0, k);
    const b = residuals.slice(k);
    const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length) || 1e-9;
    const t = Math.abs((mean(a) - mean(b)) / se);
    if (!best || t > best.tStat) {
      best = { date: series[k]?.date ?? "", tStat: t };
    }
  }
  if (!best || best.tStat < minT) return null;
  return best;
}
