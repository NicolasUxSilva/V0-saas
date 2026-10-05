/**
 * Análise de contribuição determinística (bloco C3) — o "porquê".
 *
 * Decompõe uma variação de topo por segmento; opcionalmente separa efeito
 * volume vs efeito eficiência (para métricas de taxa); acha o onset por série
 * diária. Sem geração de texto — só números.
 */
import type { SegmentTotals } from "./types";
import { changePoint } from "./stats";

export interface SegmentContribution {
  key: string;
  current: number;
  previous: number;
  /** current − previous */
  delta: number;
  /** participação na variação total, aproximadamente em [−1, 1+] */
  share: number;
}

type MetricKey = keyof Pick<
  SegmentTotals,
  "sessions" | "totalUsers" | "newUsers" | "engagedSessions" | "keyEvents" | "conversionValue"
>;

/**
 * Decompõe a variação de `metric` entre `previous` e `current` por segmento.
 * `share` = delta_segmento / delta_total. Ordena por |delta| desc.
 */
export function decomposeBySegment(
  current: SegmentTotals[],
  previous: SegmentTotals[],
  metric: MetricKey,
): SegmentContribution[] {
  const prevMap = new Map(previous.map((s) => [s.key, s[metric]]));
  const curMap = new Map(current.map((s) => [s.key, s[metric]]));
  const keys = new Set([...prevMap.keys(), ...curMap.keys()]);

  let totalDelta = 0;
  const rows: Omit<SegmentContribution, "share">[] = [];
  for (const key of keys) {
    const cur = curMap.get(key) ?? 0;
    const prev = prevMap.get(key) ?? 0;
    const delta = cur - prev;
    totalDelta += delta;
    rows.push({ key, current: cur, previous: prev, delta });
  }

  return rows
    .map((r) => ({
      ...r,
      share: totalDelta !== 0 ? r.delta / totalDelta : 0,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * Contribuintes de topo que juntos explicam pelo menos `threshold` da variação
 * (contando só os que empurram na mesma direção da variação total).
 */
export function topContributors(
  contributions: SegmentContribution[],
  threshold = 0.7,
): SegmentContribution[] {
  const totalDelta = contributions.reduce((a, c) => a + c.delta, 0);
  if (totalDelta === 0) return [];
  const sameDirection = contributions.filter(
    (c) => Math.sign(c.delta) === Math.sign(totalDelta),
  );
  const out: SegmentContribution[] = [];
  let acc = 0;
  for (const c of sameDirection) {
    out.push(c);
    acc += c.share;
    if (acc >= threshold) break;
  }
  return out;
}

/**
 * Onset da variação numa série diária de um valor qualquer. Retorna a data da
 * quebra ou null (declínio gradual / sem quebra clara).
 */
export function detectOnset(
  daily: { date: string; value: number }[],
): { date: string; tStat: number } | null {
  const series = [...daily]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, value: d.value }));
  return changePoint(series, { minSegment: 5, minT: 3 });
}
