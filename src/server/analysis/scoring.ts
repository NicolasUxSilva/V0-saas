/**
 * Priorização determinística (bloco C4). 0..100.
 */
import type { DetectorInsight } from "./types";

const W_SEVERITY = 40;
const W_MAGNITUDE = 25;
const W_IMPACT = 20;
const W_CONFIDENCE = 10;
const W_RECENCY = 5;

function severityTerm(i: DetectorInsight): number {
  if (i.kind === "data_quality") return 0.9;
  if (i.severity === "critical") return 1;
  return 0.6; // attention
}

function magnitudeTerm(i: DetectorInsight): number {
  // 50% de variação satura o termo
  return Math.min(Math.abs(i.evidence.deltaPct) / 0.5, 1);
}

function impactTerm(i: DetectorInsight): number {
  if (!i.impact) return 0;
  if (i.impact.unit === "sessions") return Math.min(i.impact.value / 2000, 1);
  if (i.impact.unit === "conversions") return Math.min(i.impact.value / 50, 1);
  return Math.min(i.impact.value / 5000, 1); // BRL
}

function confidenceTerm(i: DetectorInsight): number {
  return i.confidence === "alta" ? 1 : 0.6;
}

function recencyTerm(i: DetectorInsight, onsetDate: string | null): number {
  if (!onsetDate) return 0.5;
  const days =
    (Date.parse(`${i.periodEnd}T00:00:00Z`) -
      Date.parse(`${onsetDate}T00:00:00Z`)) /
    86_400_000;
  if (days <= 7) return 1;
  if (days >= 28) return 0;
  return 1 - (days - 7) / 21;
}

export function priorityScore(
  i: DetectorInsight,
  onsetDate: string | null,
): number {
  const raw =
    W_SEVERITY * severityTerm(i) +
    W_MAGNITUDE * magnitudeTerm(i) +
    W_IMPACT * impactTerm(i) +
    W_CONFIDENCE * confidenceTerm(i) +
    W_RECENCY * recencyTerm(i, onsetDate);

  // piso para data_quality — precisa aparecer no topo (o que investigar primeiro)
  const floored = i.kind === "data_quality" ? Math.max(raw, 70) : raw;
  return Math.round(Math.min(floored, 100) * 10) / 10;
}
