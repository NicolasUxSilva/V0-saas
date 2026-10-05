/**
 * Montador de insight Cross-source: garante, por construção, que cada afirmação
 * aponta para pontos de evidência que existem no mesmo insight, que os ids são
 * únicos e que a ordem é a de inserção (determinística).
 */
import type { MetricFormat } from "../types";
import type {
  CrossSourceCategory,
  CrossSourceEvidencePoint,
  CrossSourceInsight,
  CrossSourceInsightType,
  CrossSourcePeriod,
  CrossSourceSource,
  CrossSourceStatement,
  StatementLayer,
} from "./types";

export interface EvidenceInput {
  source: CrossSourceSource;
  metric: string;
  label: string;
  period: CrossSourcePeriod;
  value: number | null;
  format?: MetricFormat;
  /** só para `format: "currency"`; `null` = moeda não informada pela fonte */
  currency?: string | null;
  note?: string;
}

/** Ordem canônica das fontes em `CrossSourceInsight.sources`. */
const SOURCE_ORDER: readonly CrossSourceSource[] = ["ga4", "rd_marketing", "rd_crm"];

export function createInsight(head: {
  type: CrossSourceInsightType;
  category: CrossSourceCategory;
  title: string;
  period: CrossSourcePeriod;
}) {
  const evidence = new Map<string, CrossSourceEvidencePoint>();
  const statements: CrossSourceStatement[] = [];

  /** Registra um ponto de evidência (idempotente por id) e devolve o id para referenciar. */
  function ev(input: EvidenceInput): string {
    const id = `${input.source}.${input.metric}`;
    if (!evidence.has(id)) {
      evidence.set(id, {
        id,
        source: input.source,
        metric: input.metric,
        label: input.label,
        period: { start: input.period.start, end: input.period.end },
        value: input.value,
        format: input.format ?? "count",
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.note ? { note: input.note } : {}),
      });
    }
    return id;
  }

  function say(
    layer: StatementLayer,
    text: string,
    evidenceIds: string[],
    code?: string,
  ): void {
    statements.push({
      layer,
      ...(code ? { code } : {}),
      text,
      evidenceIds: [...new Set(evidenceIds)],
    });
  }

  return {
    ev,
    fact: (text: string, ids: string[]) => say("fact", text, ids),
    relation: (text: string, ids: string[]) => say("observable_relationship", text, ids),
    hypothesis: (text: string, ids: string[]) => say("hypothesis", text, ids),
    limit: (code: string, text: string, ids: string[] = []) =>
      say("limitation", text, ids, code),
    build(): CrossSourceInsight {
      const points = [...evidence.values()];
      return {
        dedupeKey: `cross-source:${head.type}`,
        type: head.type,
        category: head.category,
        title: head.title,
        periodStart: head.period.start,
        periodEnd: head.period.end,
        sources: SOURCE_ORDER.filter((s) => points.some((p) => p.source === s)),
        statements,
        evidence: points,
      };
    },
  };
}
