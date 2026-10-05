/**
 * Tipos da camada Cross-source V1.
 *
 * Por que NÃO é um `DetectorInsight`: aquele formato descreve um PROBLEMA com
 * variação (`severity` critical|attention, `evidence.previous`/`deltaPct`,
 * `comparedTo`, `priorityScore`). Os insights daqui descrevem o que as fontes
 * mostram lado a lado e o que elas NÃO permitem afirmar — não há "antes/depois",
 * nem alarme, nem nota. Encaixá-los no formato antigo exigiria inventar
 * severity, deltas e score. O que é reaproveitado: `MetricFormat`, a convenção
 * `dedupeKey` e os nomes `periodStart`/`periodEnd`.
 *
 * Por que a evidência é um formato próprio (`CrossSourceEvidencePoint`): o
 * `InsightEvidence` exige comparação (current/previous/deltaPct) e o
 * `CrossSourceEvidence` do G6 é um saco de métricas específico do Google Ads.
 * Nenhum dos dois expressa "esta fonte, neste período, tem este valor".
 *
 * Tudo aqui é JSON puro (sem `Date`, sem `undefined` em campos obrigatórios) para
 * poder ser persistido ou entregue ao Advisor sem conversão.
 */
import type { MetricFormat } from "../types";

export type CrossSourceSource = "ga4" | "rd_marketing" | "rd_crm";

export interface CrossSourcePeriod {
  /** "YYYY-MM-DD" */
  start: string;
  end: string;
}

/**
 * - `coverage`     — o que existe em cada fonte (período, dias, aquisição)
 * - `acquisition`  — sinais de aquisição lado a lado (GA4 × RD Marketing)
 * - `commercial`   — atividade comercial do CRM
 * - `relationship` — coexistência temporal entre aquisição e atividade comercial
 * - `attribution`  — qualidade dos campos de origem do CRM
 * - `integrity`    — limitações ANALÍTICAS (fonte ausente, período parcial, populações
 *                    não comparáveis, métrica não calculável). Não é erro técnico.
 */
export type CrossSourceCategory =
  | "coverage"
  | "acquisition"
  | "commercial"
  | "relationship"
  | "attribution"
  | "integrity";

export type CrossSourceInsightType =
  | "data-coverage"
  | "acquisition-coverage"
  | "traffic-and-rd-conversions"
  | "commercial-activity"
  | "commercial-vs-acquisition"
  | "attribution-quality"
  | "source-unavailable"
  | "partial-period"
  | "period-mismatch"
  | "population-not-comparable"
  | "metric-not-computable";

/**
 * As quatro camadas de afirmação — nunca misturadas no mesmo texto:
 *  - `fact`                    — o que UMA fonte registrou ("o CRM registrou 5 ganhos")
 *  - `observable_relationship` — coexistência de sinais de fontes diferentes no MESMO
 *                                período ("no mesmo período, o GA4 registrou X sessões").
 *                                Nunca causalidade.
 *  - `hypothesis`              — algo a investigar, sempre em linguagem condicional e
 *                                sem número próprio
 *  - `limitation`              — o que os dados NÃO permitem afirmar ou calcular
 */
export type StatementLayer =
  | "fact"
  | "observable_relationship"
  | "hypothesis"
  | "limitation";

export interface CrossSourceEvidencePoint {
  /** `<source>.<metric>` — único dentro do insight; é o que `statements[].evidenceIds` referencia */
  id: string;
  source: CrossSourceSource;
  metric: string;
  /** rótulo legível (pt-BR) */
  label: string;
  /** período PRÓPRIO da fonte para este valor — permite ao consumidor ver se dois pontos são comparáveis */
  period: CrossSourcePeriod;
  /** `null` = a métrica não é calculável com segurança (o porquê vai em `note`) */
  value: number | null;
  format: MetricFormat;
  /** só quando `format === "currency"`: `null` = a fonte não informa a moeda (nunca se assume BRL) */
  currency?: string | null;
  note?: string;
}

export interface CrossSourceStatement {
  layer: StatementLayer;
  /** código estável (só em `limitation`) — o consumidor reage sem parsear texto */
  code?: string;
  text: string;
  /** ids de `evidence` que sustentam o texto; vazio só quando a afirmação não tem número */
  evidenceIds: string[];
}

export interface CrossSourceInsight {
  /** identidade estável (mesma convenção do `dedupeKey` dos detectores): `cross-source:<type>` */
  dedupeKey: string;
  type: CrossSourceInsightType;
  category: CrossSourceCategory;
  title: string;
  /** período em que o insight vale — nunca mistura períodos diferentes */
  periodStart: string;
  periodEnd: string;
  /** fontes que aparecem na evidência (ordem fixa: ga4, rd_marketing, rd_crm) */
  sources: CrossSourceSource[];
  statements: CrossSourceStatement[];
  /** nunca vazio */
  evidence: CrossSourceEvidencePoint[];
}
