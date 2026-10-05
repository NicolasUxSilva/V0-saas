/**
 * Privacidade da entrada do modelo de linguagem — PURO.
 *
 * Duas garantias, ambas estruturais (não só testadas):
 *
 *  1. PROJEÇÃO EXPLÍCITA. O que sai para o provedor não é "o `AdvisorContext` menos
 *     alguns campos" (uma lista de exclusão, que deixaria vazar qualquer campo novo),
 *     e sim uma visão montada campo a campo (`projectContextForModel`): só entra o
 *     que está escrito aqui. Ficam de fora o `workspaceId`, o instante de montagem do
 *     contexto, os ids técnicos (`metric`, `ref`, `insightType`…), o valor numérico
 *     cru das evidências (o modelo copia o `display`, nunca calcula sobre o número) e
 *     a `supportingEvidence` do Google Ads. As evidências viram ids curtos (E1, E2…):
 *     o modelo cita o id e o sistema traduz de volta para a referência real.
 *
 *  2. VARREDURA FAIL-CLOSED. Antes de qualquer envio, `scanForPii` procura nas
 *     strings do payload (inclusive a pergunta digitada) e-mail, telefone, CPF/CNPJ,
 *     UUID, URL e sequências longas de dígitos. Achou algo: o envio é bloqueado e o
 *     Advisor responde de forma determinística — sem mandar nada ao provedor.
 *
 * O contexto de hoje não tem PII (auditado: o Cross-source só carrega contagens e
 * coberturas; `fact_deals` já nasce sem nome de negócio nem contatos). A varredura
 * existe para o dia em que alguma dimensão externa (nome de canal, de campanha) ou a
 * pergunta do usuário trouxer um dado pessoal.
 */
import { brDate, count, pct } from "../format";
import type {
  AdvisorContext,
  AdvisorLimitation,
  AdvisorLimitationSeverity,
  AdvisorSource,
  AdvisorSourceStatus,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// A visão que o modelo recebe
// ─────────────────────────────────────────────────────────────────────

export interface LlmEvidenceView {
  /** id curto (E1, E2…) — é o que o modelo cita */
  id: string;
  source: AdvisorSource;
  label: string;
  /** o número já formatado em pt-BR; `null` = sem dado (ausência, nunca zero) */
  display: string | null;
  /** datas dd/mm/aaaa */
  period: { start: string; end: string };
  note?: string;
  /** só em valores monetários; `null` = a fonte não informa a moeda */
  currency?: string | null;
}

export interface LlmLimitationView {
  code: string;
  severity: AdvisorLimitationSeverity;
  origin: AdvisorLimitation["origin"];
  sources: AdvisorSource[];
  message: string;
  evidenceIds: string[];
}

export interface LlmStatementView {
  text: string;
  evidenceIds: string[];
}

export interface LlmDiagnosticView {
  key: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  explanation: string;
  hypothesis: string;
  recommendedAction: string;
  confidence: string;
  confidenceBasis: string;
  /** a janela do MOTOR — pode não ser a do período pedido */
  window: { start: string; end: string };
  comparedTo: string | null;
  metric: {
    label: string;
    current: string;
    previous: string;
    baseline: string | null;
    deltaPct: string;
  };
  breakdown: { label: string; share: string; detail: string | null }[];
  impact: { value: string; unit: string; basis: string; isEstimate: boolean } | null;
}

export interface LlmComparisonView {
  status: "computed" | "not_computable";
  baselinePeriod: { start: string; end: string; days: number };
  reasons: LlmLimitationView[];
  items: {
    label: string;
    source: AdvisorSource;
    currentEvidenceId: string | null;
    baselineEvidenceId: string | null;
    current: string;
    baseline: string;
    delta: string;
    deltaPct: string | null;
  }[];
  skipped: { label: string; reason: string }[];
}

export interface LlmContextView {
  period: { start: string; end: string; days: number };
  crossSource: {
    status: "generated" | "not_generated";
    /** só a data (dd/mm/aaaa): o frescor do conjunto persistido */
    generatedOn: string | null;
    insights: { type: string; title: string; sources: AdvisorSource[] }[];
  };
  sources: {
    source: AdvisorSource;
    label: string;
    status: AdvisorSourceStatus;
    daysWithData: number | null;
    periodDays: number | null;
    limitationCodes: string[];
    evidenceIds: string[];
  }[];
  facts: LlmStatementView[];
  observations: LlmStatementView[];
  hypotheses: (LlmStatementView & { origin: "cross_source" | "diagnostics" })[];
  limitations: LlmLimitationView[];
  evidence: LlmEvidenceView[];
  diagnostics: {
    status: "available" | "none";
    alignedWithPeriod: boolean | null;
    items: LlmDiagnosticView[];
  };
  comparison: LlmComparisonView | null;
}

export interface LlmProjection {
  view: LlmContextView;
  /** id curto → referência real da evidência (para traduzir a resposta de volta) */
  aliasToRef: ReadonlyMap<string, string>;
}

/**
 * Lista de campos de primeiro nível da visão — e a única que o provedor conhece. Um
 * teste trava esta lista contra o `AdvisorContext`: um campo novo do contexto NÃO
 * chega ao provedor até alguém decidir, aqui, que ele deve chegar.
 */
export const LLM_VIEW_FIELDS = [
  "period",
  "crossSource",
  "sources",
  "facts",
  "observations",
  "hypotheses",
  "limitations",
  "evidence",
  "diagnostics",
  "comparison",
] as const;

/** Campos do `AdvisorContext` que a visão deliberadamente NÃO leva ao provedor. */
export const CONTEXT_FIELDS_NOT_SENT = ["schemaVersion", "workspaceId", "generatedAt"] as const;

const range = (start: string, end: string) => ({ start: brDate(start), end: brDate(end) });

export function projectContextForModel(context: AdvisorContext): LlmProjection {
  const comparison = context.comparison;

  // ids curtos para TODA evidência citável (as do período e as do período-base)
  const registry = [...context.evidence, ...(comparison?.baselineEvidence ?? [])];
  const aliasByRef = new Map<string, string>();
  const aliasToRef = new Map<string, string>();
  for (const e of registry) {
    if (aliasByRef.has(e.ref)) continue;
    const id = `E${aliasByRef.size + 1}`;
    aliasByRef.set(e.ref, id);
    aliasToRef.set(id, e.ref);
  }
  const ids = (refs: string[]): string[] =>
    refs.flatMap((ref) => {
      const id = aliasByRef.get(ref);
      return id ? [id] : [];
    });

  const evidence: LlmEvidenceView[] = [];
  const seen = new Set<string>();
  for (const e of registry) {
    if (seen.has(e.ref)) continue;
    seen.add(e.ref);
    evidence.push({
      id: aliasByRef.get(e.ref)!,
      source: e.source,
      label: e.label,
      display: e.display,
      period: range(e.period.start, e.period.end),
      ...(e.note ? { note: e.note } : {}),
      ...(e.format === "currency" ? { currency: e.currency ?? null } : {}),
    });
  }

  const limitation = (l: AdvisorLimitation): LlmLimitationView => ({
    code: l.code,
    severity: l.severity,
    origin: l.origin,
    sources: l.sources,
    message: l.message,
    evidenceIds: ids(l.evidenceRefs),
  });

  const view: LlmContextView = {
    period: { ...range(context.period.startDate, context.period.endDate), days: context.period.days },
    crossSource: {
      status: context.crossSource.status,
      generatedOn: context.crossSource.generatedAt ? brDate(context.crossSource.generatedAt.slice(0, 10)) : null,
      insights: context.crossSource.insights.map((i) => ({ type: i.type, title: i.title, sources: i.sources })),
    },
    sources: context.sources.map((s) => ({
      source: s.source,
      label: s.label,
      status: s.status,
      daysWithData: s.daysWithData,
      periodDays: s.periodDays,
      limitationCodes: s.limitationCodes,
      evidenceIds: ids(s.evidenceRefs),
    })),
    facts: context.facts.map((s) => ({ text: s.text, evidenceIds: ids(s.evidenceRefs) })),
    observations: context.observations.map((s) => ({ text: s.text, evidenceIds: ids(s.evidenceRefs) })),
    hypotheses: context.hypotheses.map((h) => ({
      origin: h.origin,
      text: h.text,
      evidenceIds: ids(h.evidenceRefs),
    })),
    limitations: context.limitations.map(limitation),
    evidence,
    diagnostics: {
      status: context.diagnostics.status,
      alignedWithPeriod: context.diagnostics.alignedWithPeriod,
      items: context.diagnostics.items.map((d) => ({
        key: d.dedupeKey,
        kind: d.kind,
        severity: d.severity,
        status: d.status,
        title: d.title,
        explanation: d.explanation,
        hypothesis: d.hypothesis,
        recommendedAction: d.recommendedAction,
        confidence: d.confidence,
        confidenceBasis: d.confidenceBasis,
        window: range(d.period.start, d.period.end),
        comparedTo: d.comparedTo,
        // os MESMOS formatadores com que o guard monta os números permitidos do diagnóstico
        metric: {
          label: d.evidence.metricLabel,
          current: count(d.evidence.current),
          previous: count(d.evidence.previous),
          baseline: d.evidence.baseline === null ? null : count(d.evidence.baseline),
          deltaPct: pct(d.evidence.deltaPct),
        },
        breakdown: d.evidence.breakdown.map((row) => ({
          label: row.label,
          share: pct(row.contributionPct),
          detail: row.detail,
        })),
        impact: d.impact
          ? { value: count(d.impact.value), unit: d.impact.unit, basis: d.impact.basis, isEstimate: d.impact.isEstimate }
          : null,
      })),
    },
    comparison: comparison
      ? {
          status: comparison.status,
          baselinePeriod: {
            ...range(comparison.baselinePeriod.startDate, comparison.baselinePeriod.endDate),
            days: comparison.baselinePeriod.days,
          },
          reasons: comparison.reasons.map(limitation),
          items: comparison.items.map((i) => ({
            label: i.label,
            source: i.source,
            currentEvidenceId: aliasByRef.get(i.currentRef) ?? null,
            baselineEvidenceId: aliasByRef.get(i.baselineRef) ?? null,
            current: i.currentDisplay,
            baseline: i.baselineDisplay,
            delta: i.deltaDisplay,
            deltaPct: i.deltaPctDisplay,
          })),
          skipped: comparison.skipped.map((s) => ({ label: s.label, reason: s.reason })),
        }
      : null,
  };

  return { view, aliasToRef };
}

// ─────────────────────────────────────────────────────────────────────
// Varredura de PII
// ─────────────────────────────────────────────────────────────────────

export type PiiKind = "email" | "url" | "uuid" | "document_number" | "phone" | "long_digits";

export interface PiiFinding {
  kind: PiiKind;
  /** caminho no payload (`query.question`, `context.limitations[2].message`…) — nunca o valor */
  where: string;
}

const PII_PATTERNS: readonly { kind: PiiKind; pattern: RegExp }[] = [
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  { kind: "url", pattern: /https?:\/\/\S+|\bwww\.[A-Za-z0-9-]+\.\S+/i },
  { kind: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  // CPF e CNPJ formatados (as contagens do contexto saem com ponto de milhar, nunca nesse formato)
  { kind: "document_number", pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/ },
  // telefone brasileiro, com ou sem DDI/DDD/9: "(11) 98765-4321", "11 3456-7890", "+55 11 98765 4321"
  { kind: "phone", pattern: /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/ },
  // qualquer sequência longa de dígitos colados: id pessoal, CPF/CNPJ/telefone sem pontuação
  { kind: "long_digits", pattern: /\d{9,}/ },
];

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectStrings(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/** Procura PII em todas as strings de `payload`. Devolve tipo e caminho — nunca o valor achado. */
export function scanForPii(payload: unknown, rootPath = "payload"): PiiFinding[] {
  const strings: { path: string; text: string }[] = [];
  collectStrings(payload, rootPath, strings);
  const findings: PiiFinding[] = [];
  for (const { path, text } of strings) {
    for (const { kind, pattern } of PII_PATTERNS) {
      if (pattern.test(text)) findings.push({ kind, where: path });
    }
  }
  return findings;
}
