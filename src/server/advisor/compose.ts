/**
 * Composição PURA do `AdvisorContext`.
 *
 * Recebe o que já está calculado e persistido — o conjunto Cross-source de um
 * período (`getCrossSourceInsights`) e os insights do diagnóstico (`insights`) — e
 * o reorganiza em camadas. NÃO calcula nenhuma métrica, NÃO consulta banco, NÃO usa
 * relógio nem env: mesma entrada ⇒ mesma saída, byte a byte, e a entrada nunca é
 * mutada.
 *
 * O que esta função FAZ, e só isto:
 *  - separa as frases do Cross-source por camada (fato · relação observável ·
 *    hipótese · limitação) sem reescrever nenhum texto;
 *  - deduplica a evidência num registro único e troca os ids locais de cada insight
 *    por `ref`s do contexto inteiro;
 *  - classifica a gravidade das limitações por CÓDIGO (tabela explícita);
 *  - traduz os códigos de limitação em cobertura por fonte (`covered`/`partial`/…);
 *  - marca se o diagnóstico do motor é da janela do período pedido.
 *
 * Ausência ≠ zero: o que o Cross-source persistiu como `null` continua `null`
 * (`display: null`); uma fonte sem linha vira `unavailable`, nunca "0"; sem conjunto
 * gerado a fonte é `unknown`, e nenhuma figura é inventada.
 */
import type { StoredCrossSourceInsights } from "../analysis/cross-source-store";
import { validateAnalysisPeriod } from "../analysis/period";

import { displayValue } from "./format";
import {
  crossSourceNotGenerated,
  diagnosticsPeriodDiffers,
  evidenceConflict,
  severityOf,
} from "./limitations";
import {
  ADVISOR_SCHEMA_VERSION,
  type AdvisorContext,
  type AdvisorDiagnosticItem,
  type AdvisorDiagnostics,
  type AdvisorEvidence,
  type AdvisorHypothesis,
  type AdvisorLimitation,
  type AdvisorPeriod,
  type AdvisorPeriodInput,
  type AdvisorSource,
  type AdvisorSourceCoverage,
  type AdvisorSourceStatus,
  type AdvisorStatement,
} from "./types";

/** Conjunto Cross-source persistido com forma inválida — falha alto em vez de montar meia verdade. */
export class AdvisorContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisorContextError";
  }
}

export const SOURCE_ORDER: readonly AdvisorSource[] = ["ga4", "rd_marketing", "rd_crm"];

export const SOURCE_LABEL: Record<AdvisorSource, string> = {
  ga4: "GA4",
  rd_marketing: "RD Marketing",
  rd_crm: "RD CRM",
};

/** Métricas de evidência que descrevem a COBERTURA de uma fonte (não a atividade dela). */
export const COVERAGE_METRICS: ReadonlySet<string> = new Set([
  "days_with_data",
  "history_distinct_dates",
  "pipelines_with_activity",
  "covered_days",
  "window_days",
  "data_lag_days",
]);

/** Códigos do Cross-source que dizem que uma fonte NÃO tem dado no período. */
const UNAVAILABLE_CODE: Record<AdvisorSource, string> = {
  ga4: "ga4_unavailable",
  rd_marketing: "rd_marketing_unavailable",
  rd_crm: "rd_crm_unavailable",
};

/** Códigos do Cross-source que dizem que a fonte tem dado, mas só parte do período. */
const PARTIAL_CODES: Record<AdvisorSource, readonly string[]> = {
  ga4: ["ga4_partial_days", "ga4_data_lag"],
  rd_marketing: ["rd_marketing_partial_days"],
  rd_crm: ["rd_crm_partial_imported_history"],
};

export interface ComposeInput {
  workspaceId: string;
  period: AdvisorPeriodInput;
  crossSource: StoredCrossSourceInsights;
  diagnostics: AdvisorDiagnosticItem[];
  /** instante da montagem (ISO) — entra como argumento porque esta função não olha o relógio */
  generatedAt: string;
}

export function periodOf(input: AdvisorPeriodInput): AdvisorPeriod {
  const { start, end, days } = validateAnalysisPeriod(input);
  return { startDate: start, endDate: end, days };
}

const refOf = (id: string, period: { start: string; end: string }) =>
  `${id}@${period.start}..${period.end}`;

const sourcesOf = (refs: string[], evidence: Map<string, AdvisorEvidence>, fallback: AdvisorSource[]) => {
  const found = new Set<AdvisorSource>();
  for (const ref of refs) {
    const e = evidence.get(ref);
    if (e) found.add(e.source);
  }
  const list = found.size > 0 ? [...found] : fallback;
  return SOURCE_ORDER.filter((s) => list.includes(s));
};

export function composeAdvisorContext(input: ComposeInput): AdvisorContext {
  const period = periodOf(input.period);
  const stored = input.crossSource;

  // um conjunto de outro workspace ou de outro período NUNCA entra: melhor falhar do que misturar
  if (stored.workspaceId !== input.workspaceId) {
    throw new AdvisorContextError(
      "O Cross-source lido pertence a outro workspace — o contexto não foi montado.",
    );
  }
  if (stored.period.start !== period.startDate || stored.period.end !== period.endDate) {
    throw new AdvisorContextError(
      `O Cross-source lido é do período ${stored.period.start} a ${stored.period.end}, não do pedido (${period.startDate} a ${period.endDate}).`,
    );
  }
  const generated = stored.insights.length > 0;

  // ── evidência: um registro deduplicado; o id local de cada insight vira um `ref` global ──
  const evidence = new Map<string, AdvisorEvidence>();
  const conflicts: AdvisorLimitation[] = [];

  const facts: AdvisorStatement[] = [];
  const observations: AdvisorStatement[] = [];
  const hypotheses: AdvisorHypothesis[] = [];
  const crossLimitations: AdvisorLimitation[] = [];

  for (const insight of stored.insights) {
    const refByLocalId = new Map<string, string>();

    for (const point of insight.evidence) {
      const ref = refOf(point.id, point.period);
      refByLocalId.set(point.id, ref);

      const candidate: AdvisorEvidence = {
        ref,
        source: point.source,
        metric: point.metric,
        label: point.label,
        period: { start: point.period.start, end: point.period.end },
        value: point.value,
        display: displayValue(point),
        format: point.format,
        ...(point.currency !== undefined ? { currency: point.currency } : {}),
        ...(point.note ? { note: point.note } : {}),
      };

      const existing = evidence.get(ref);
      if (!existing) {
        evidence.set(ref, candidate);
      } else if (
        existing.value !== candidate.value ||
        existing.format !== candidate.format ||
        existing.currency !== candidate.currency
      ) {
        // não acontece com um conjunto gerado de UM contexto, mas se acontecer o primeiro vale e isso fica dito
        if (!conflicts.some((c) => c.code === "evidence_conflict" && c.message.includes(ref))) {
          conflicts.push(evidenceConflict(ref));
        }
      }
    }

    const refsFor = (ids: string[], statementIndex: number): string[] =>
      ids.map((id) => {
        const ref = refByLocalId.get(id);
        if (!ref) {
          throw new AdvisorContextError(
            `Cross-source inconsistente: a afirmação ${insight.type}#${statementIndex} cita a evidência “${id}”, que não existe no insight.`,
          );
        }
        return ref;
      });

    insight.statements.forEach((statement, index) => {
      const statementRef = `${insight.type}#${index}`;
      const evidenceRefs = refsFor(statement.evidenceIds, index);
      const base = {
        ref: statementRef,
        text: statement.text,
        evidenceRefs,
        insightType: insight.type,
        category: insight.category,
      };

      switch (statement.layer) {
        case "fact":
        case "observable_relationship": {
          const row: AdvisorStatement = {
            ...base,
            layer: statement.layer,
            sources: sourcesOf(evidenceRefs, evidence, insight.sources),
          };
          (statement.layer === "fact" ? facts : observations).push(row);
          break;
        }
        case "hypothesis":
          hypotheses.push({
            ref: statementRef,
            origin: "cross_source",
            text: statement.text,
            evidenceRefs,
            from: insight.type,
          });
          break;
        case "limitation": {
          // limitação sem código não é classificável: o Cross-source sempre põe código
          const code = statement.code ?? `${insight.type}:sem_codigo`;
          crossLimitations.push({
            code,
            message: statement.text,
            origin: "cross_source",
            severity: severityOf(code),
            sources: sourcesOf(evidenceRefs, evidence, insight.sources),
            evidenceRefs,
            insightType: insight.type,
          });
          break;
        }
      }
    });
  }

  const evidenceList = [...evidence.values()];

  // ── cobertura por fonte (a partir dos CÓDIGOS das limitações — não de uma recontagem) ──
  const codes = new Set(crossLimitations.map((l) => l.code));
  const sources: AdvisorSourceCoverage[] = SOURCE_ORDER.map((source) => {
    const status: AdvisorSourceStatus = !generated
      ? "unknown"
      : codes.has(UNAVAILABLE_CODE[source])
        ? "unavailable"
        : PARTIAL_CODES[source].some((c) => codes.has(c))
          ? "partial"
          : "covered";

    const own = evidenceList.filter((e) => e.source === source && COVERAGE_METRICS.has(e.metric));
    const days = own.find((e) => e.metric === "days_with_data");
    const explaining = [UNAVAILABLE_CODE[source], ...PARTIAL_CODES[source]].filter((c) => codes.has(c));

    return {
      source,
      label: SOURCE_LABEL[source],
      status,
      daysWithData: days?.value ?? null,
      periodDays: days?.value != null ? period.days : null,
      limitationCodes: explaining,
      evidenceRefs: own.map((e) => e.ref),
    };
  });

  // ── diagnóstico do motor: a janela dele é a do período pedido? ──
  const windows = distinctWindows(input.diagnostics);
  const aligned =
    input.diagnostics.length === 0
      ? null
      : input.diagnostics.every(
          (d) => d.period.start === period.startDate && d.period.end === period.endDate,
        );
  const diagnostics: AdvisorDiagnostics = {
    status: input.diagnostics.length > 0 ? "available" : "none",
    alignedWithPeriod: aligned,
    items: input.diagnostics,
  };

  // hipóteses do motor entram marcadas como hipótese, ao lado das do Cross-source
  for (const d of input.diagnostics) {
    if (d.hypothesis.trim() === "") continue;
    hypotheses.push({
      ref: `diagnostic:${d.dedupeKey}#hypothesis`,
      origin: "diagnostics",
      text: d.hypothesis,
      evidenceRefs: [],
      from: d.dedupeKey,
    });
  }

  // ── limitações: as do próprio Advisor emolduram as do Cross-source ──
  const limitations: AdvisorLimitation[] = mergeDuplicates([
    ...(generated ? [] : [crossSourceNotGenerated(period)]),
    ...(aligned === false ? [diagnosticsPeriodDiffers(period, windows)] : []),
    ...conflicts,
    ...crossLimitations,
  ]);

  return {
    schemaVersion: ADVISOR_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    period,
    generatedAt: input.generatedAt,
    sources,
    crossSource: {
      status: generated ? "generated" : "not_generated",
      generatedAt: stored.generatedAt,
      schemaVersion: stored.schemaVersion,
      insights: stored.insights.map((i) => ({
        type: i.type,
        title: i.title,
        category: i.category,
        sources: [...i.sources],
      })),
    },
    diagnostics,
    facts,
    observations,
    hypotheses,
    limitations,
    evidence: evidenceList,
    comparison: null,
  };
}

/**
 * O Cross-source repete a MESMA limitação (mesmo código e mesmo texto) em insights
 * diferentes — ex.: histórico de CRM parcial em `partial-period` e em
 * `commercial-activity`. Aqui cada uma vira uma só, com as evidências e as fontes
 * das duas somadas; nenhum texto é alterado ou perdido.
 */
function mergeDuplicates(items: AdvisorLimitation[]): AdvisorLimitation[] {
  const byKey = new Map<string, AdvisorLimitation>();
  for (const item of items) {
    const key = `${item.code}\u0000${item.message}`;
    const first = byKey.get(key);
    if (!first) {
      byKey.set(key, { ...item, sources: [...item.sources], evidenceRefs: [...item.evidenceRefs] });
      continue;
    }
    for (const ref of item.evidenceRefs) {
      if (!first.evidenceRefs.includes(ref)) first.evidenceRefs.push(ref);
    }
    first.sources = SOURCE_ORDER.filter((s) => first.sources.includes(s) || item.sources.includes(s));
  }
  return [...byKey.values()];
}

/** Janelas distintas dos insights do diagnóstico, na ordem em que aparecem. */
function distinctWindows(items: AdvisorDiagnosticItem[]): { start: string; end: string }[] {
  const seen = new Set<string>();
  const out: { start: string; end: string }[] = [];
  for (const d of items) {
    const key = `${d.period.start}|${d.period.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ start: d.period.start, end: d.period.end });
  }
  return out;
}

/** As evidências do contexto que as FRASES de fato citam — as "figuras" executivas, na ordem de aparição. */
export function figuresOf(context: AdvisorContext, source?: AdvisorSource): AdvisorEvidence[] {
  const byRef = new Map(context.evidence.map((e) => [e.ref, e] as const));
  const seen = new Set<string>();
  const out: AdvisorEvidence[] = [];
  for (const statement of context.facts) {
    for (const ref of statement.evidenceRefs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const e = byRef.get(ref);
      if (e && (source === undefined || e.source === source)) out.push(e);
    }
  }
  return out;
}
