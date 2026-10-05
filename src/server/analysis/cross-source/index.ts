/**
 * Cross-source — camada determinística que relaciona GA4 + RD Marketing +
 * RD CRM a partir do `AnalysisContext` já construído.
 *
 *   DB → fatos canônicos → `buildAnalysisContext(workspace, período?)` →
 *   (esta camada) → insights estruturados → `cross_source_insights` →
 *   (futuro) Advisor
 *
 * Garantias (travadas por teste em `__tests__/cross-source*.test.ts`):
 *  - PURA: recebe só o contexto; não importa banco, rede, env, conectores nem o
 *    engine; não usa relógio nem aleatoriedade. Mesmo contexto ⇒ mesma saída
 *    (byte a byte) e o contexto nunca é mutado. A persistência fica em
 *    `../cross-source-store.ts` — esta pasta continua sem acesso a banco;
 *  - NÃO inventa métrica: toda razão é `null` (nunca 0/NaN) quando o denominador
 *    é 0, e GA4 × RD × CRM nunca viram taxa, CAC, ROAS nem atribuição. Dia sem
 *    dado nunca vira zero;
 *  - NÃO afirma causalidade: cada texto separa fato, relação observável (só
 *    coexistência no mesmo período), hipótese (condicional, sem número) e
 *    limitação;
 *  - NÃO está ligada ao engine: não cria, altera, ordena nem persiste nenhum
 *    insight dos detectores (INV-4).
 *
 * O período analisado é `ctx.period` — o SOLICITADO. Cada fonte traz o período que
 * de fato cobre (`ctx.coverage.inPeriod`, `rdMarketing.coverage`,
 * `rdCrm.coverage`), e as comparações "no mesmo período" só valem entre fontes que
 * cobrem exatamente o período solicitado; do contrário saem os insights de período
 * parcial / não equivalente em vez de uma comparação enganosa.
 */
import type { AnalysisContext } from "../types";

import {
  attributionQuality,
  commercialActivity,
  commercialVsAcquisition,
} from "./commercial";
import { acquisitionCoverage, dataCoverage, trafficAndRdConversions } from "./coverage";
import { extractSourceFacts } from "./facts";
import {
  metricNotComputable,
  partialPeriod,
  periodMismatch,
  populationNotComparable,
  sourceUnavailable,
} from "./integrity";
import type { CrossSourceInsight } from "./types";

export { MIN_ATTRIBUTION_COVERAGE } from "./commercial";
export {
  CROSS_SOURCE_SCHEMA_VERSION,
  canonicalJson,
  contentHash,
  fromStoredRows,
  planReplace,
  summarizePlan,
  toStoredRows,
  type ReplacePlan,
  type ReplaceSummary,
  type StoredCrossSourceRow,
} from "./storage";
export type {
  CrossSourceCategory,
  CrossSourceEvidencePoint,
  CrossSourceInsight,
  CrossSourceInsightType,
  CrossSourcePeriod,
  CrossSourceSource,
  CrossSourceStatement,
  StatementLayer,
} from "./types";

export function buildCrossSourceInsights(ctx: AnalysisContext): CrossSourceInsight[] {
  const facts = extractSourceFacts(ctx);

  // Ordem fixa — é parte do contrato determinístico da saída.
  const candidates: (CrossSourceInsight | null)[] = [
    dataCoverage(facts),
    acquisitionCoverage(facts),
    trafficAndRdConversions(facts),
    commercialActivity(facts),
    commercialVsAcquisition(facts),
    attributionQuality(facts),
    sourceUnavailable(facts),
    partialPeriod(facts),
    periodMismatch(facts),
    populationNotComparable(facts),
    metricNotComputable(facts),
  ];

  return candidates.filter((i): i is CrossSourceInsight => i !== null);
}
