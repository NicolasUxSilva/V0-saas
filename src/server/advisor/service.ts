/**
 * `answerAdvisorQuery` — o serviço do Advisor.
 *
 *   pedido ─▶ parseAdvisorQuery ─▶ buildAdvisorContext ─▶ AdvisorModel.generate
 *          ─▶ guard (INV-6/7/21) ─▶ completa o que o modelo NÃO controla ─▶ AdvisorResponse
 *
 * O modelo (o determinístico, ou um modelo de linguagem) devolve só o texto e a
 * estrutura das seções. O serviço completa o resto de forma DETERMINÍSTICA — figuras
 * copiadas do contexto, evidências, TODAS as limitações, proveniência — para que um
 * modelo nunca consiga omitir uma limitação nem alterar um número.
 *
 * A resposta de qualquer modelo que não seja o determinístico passa pela validação
 * ESTRITA (`validateLlmDraft`). Se ela é recusada, ou o modelo falha (erro, timeout,
 * credencial ausente, saída inválida), entra a resposta determinística e isso fica
 * registrado na proveniência e numa limitação — nunca em silêncio. O serviço depende
 * só da INTERFACE `AdvisorModel`: não importa SDK, provedor nem adaptador algum.
 *
 * Quando não há o que interpretar (sem Cross-source gerado; comparação não
 * computável) o modelo de linguagem nem é chamado: a resposta determinística já é a
 * correta, e não há por que gastar uma chamada nem abrir espaço para invenção.
 *
 * Somente leitura: nenhuma escrita em lugar nenhum, nenhum sync, nenhuma geração de
 * Cross-source. A única chamada externa possível é a do modelo de linguagem, e ela
 * mora atrás de `AdvisorModel`.
 */
import { buildAdvisorContext, type AdvisorContextDeps } from "./context";
import { DeterministicAdvisorModel, answerDeterministically } from "./deterministic-model";
import {
  validateAdvisorResponse,
  validateLlmDraft,
  validateModelResponse,
  type GuardViolation,
} from "./guard";
import { bySeverity, modelFailed, modelFailureReasonOf, modelOutputRejected } from "./limitations";
import type { AdvisorIntent } from "./intents";
import { logAdvisorEvent, type AdvisorAnswerLogEvent, type AdvisorLogSink } from "./log";
import { parseAdvisorQuery } from "./query";
import {
  ADVISOR_SCHEMA_VERSION,
  type AdvisorContext,
  type AdvisorEvidence,
  type AdvisorInsightRef,
  type AdvisorLimitation,
  type AdvisorModel,
  type AdvisorModelResponse,
  type AdvisorQuery,
  type AdvisorResponse,
} from "./types";

/** Nem a resposta determinística passou no guard: é um bug do Advisor, nunca um problema do pedido. */
export class AdvisorInternalError extends Error {
  readonly violations: GuardViolation[];
  constructor(message: string, violations: GuardViolation[]) {
    super(message);
    this.name = "AdvisorInternalError";
    this.violations = violations;
  }
}

/**
 * O modelo do sistema (e o estado de entrega: `ADVISOR_LLM_ENABLED=false`). Uma pergunta
 * livre não fica sem resposta: recebe o resumo determinístico do período, dito como tal.
 */
export const deterministicModel: AdvisorModel = new DeterministicAdvisorModel({
  freeQuestion: "period_summary_llm_off",
});

export interface AdvisorServiceDeps extends AdvisorContextDeps {
  /** padrão: o modelo determinístico */
  model?: AdvisorModel;
  /** destino do log de METADADOS (padrão: log do servidor) */
  log?: AdvisorLogSink;
}

/** Não há o que um modelo de linguagem interpretar: a resposta determinística é a correta. */
function nothingToInterpret(
  context: AdvisorContext,
  query: AdvisorQuery,
): "no_data" | "comparison_not_computable" | null {
  if (query.intent === "comparison") {
    return context.comparison?.status === "computed" ? null : "comparison_not_computable";
  }
  return context.crossSource.status === "generated" ? null : "no_data";
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

export async function answerAdvisorQuery(
  rawQuery: unknown,
  deps: AdvisorServiceDeps = {},
): Promise<AdvisorResponse> {
  const started = performance.now();
  const query = parseAdvisorQuery(rawQuery);
  const model = deps.model ?? deterministicModel;
  const isSystemModel = model.id === deterministicModel.id;

  const context = await buildAdvisorContext(
    query.workspaceId,
    query.period,
    { comparePeriod: query.comparePeriod },
    deps,
  );

  const notes: AdvisorLimitation[] = [];
  let draft: AdvisorModelResponse | null = null;
  let producer = model.id;
  let promptVersion = model.promptVersion;
  let fellBack = false;
  let outcome: AdvisorAnswerLogEvent["outcome"] = "answered";
  let skippedReason: AdvisorAnswerLogEvent["skippedReason"];
  let violationCodes: string[] | undefined;

  const skip = isSystemModel ? null : nothingToInterpret(context, query);
  if (skip) {
    draft = answerDeterministically(context, query, { freeQuestion: "period_summary" });
    producer = deterministicModel.id;
    promptVersion = undefined;
    outcome = "skipped";
    skippedReason = skip;
  } else {
    try {
      const candidate = await model.generate({ context, query });
      const violations = isSystemModel
        ? validateModelResponse(candidate, context)
        : validateLlmDraft(candidate, context);
      if (violations.length === 0) {
        draft = candidate;
      } else if (isSystemModel) {
        throw new AdvisorInternalError(
          "A resposta determinística do Advisor foi recusada pela própria validação.",
          violations,
        );
      } else {
        notes.push(modelOutputRejected(model.id, violations.map((v) => v.code)));
        violationCodes = unique(violations.map((v) => v.code));
        outcome = "fallback_rejected";
      }
    } catch (error) {
      if (error instanceof AdvisorInternalError) throw error;
      // um modelo que falha (erro, timeout, credencial ausente) não derruba a pergunta
      if (isSystemModel) throw error;
      notes.push(modelFailed(model.id, modelFailureReasonOf(error)));
      outcome = "fallback_failed";
    }
  }

  if (!draft) {
    // só chega aqui um modelo que NÃO é o determinístico e não entregou uma resposta utilizável
    draft = answerDeterministically(context, query, { freeQuestion: "period_summary" });
    const violations = validateModelResponse(draft, context);
    if (violations.length > 0) {
      throw new AdvisorInternalError(
        "A resposta determinística do Advisor foi recusada pela própria validação.",
        violations,
      );
    }
    producer = deterministicModel.id;
    promptVersion = undefined;
    fellBack = true;
  }

  const response = finalize(draft, context, query.intent, producer, fellBack, notes, promptVersion);
  const violations = validateAdvisorResponse(response, context);
  if (violations.length > 0) {
    throw new AdvisorInternalError(
      "A resposta final do Advisor foi recusada pela validação.",
      violations,
    );
  }

  try {
    (deps.log ?? logAdvisorEvent)({
      event: "advisor.answer",
      workspaceId: query.workspaceId,
      intent: query.intent,
      period: { start: query.period.startDate, end: query.period.endDate },
      producer,
      status: response.status,
      outcome,
      ...(skippedReason ? { skippedReason } : {}),
      fellBack,
      ...(violationCodes ? { violationCodes } : {}),
      latencyMs: Math.round(performance.now() - started),
    });
  } catch {
    // o log nunca derruba uma resposta
  }
  return response;
}

/**
 * Completa o rascunho de um modelo com o que só o sistema pode garantir. Figuras e
 * evidências são CÓPIAS do contexto; as limitações são TODAS as do contexto.
 */
function finalize(
  draft: AdvisorModelResponse,
  context: AdvisorContext,
  intent: AdvisorIntent,
  producer: string,
  fellBack: boolean,
  notes: AdvisorLimitation[],
  promptVersion: string | undefined,
): AdvisorResponse {
  const comparison = context.comparison;
  const byRef = new Map<string, AdvisorEvidence>(
    [...context.evidence, ...(comparison?.baselineEvidence ?? [])].map((e) => [e.ref, e] as const),
  );
  const resolve = (refs: string[]): AdvisorEvidence[] =>
    refs.flatMap((ref) => {
      const e = byRef.get(ref);
      return e ? [e] : [];
    });

  const sections = draft.sections.map((s) => ({
    id: s.id,
    title: s.title,
    content: s.content,
    figures: resolve([...new Set(s.figureRefs)]),
    items: s.items,
  }));

  // todas as limitações do contexto + as da comparação + as do modelo/serviço, uma vez cada, da mais grave à menos
  const seen = new Set<string>();
  const limitations = bySeverity(
    [
      ...context.limitations,
      ...(comparison?.reasons ?? []),
      ...(draft.extraLimitations ?? []),
      ...notes,
    ].filter((l) => {
      const key = `${l.code}\u0000${l.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );

  // evidências citadas em qualquer lugar da resposta: ela é autocontida (todo `ref` resolve aqui)
  const citedRefs = [
    ...sections.flatMap((s) => [...s.figures.map((f) => f.ref), ...s.items.flatMap((i) => i.evidenceRefs)]),
    ...limitations.flatMap((l) => l.evidenceRefs),
  ];
  const evidence = resolve([...new Set(citedRefs)]);

  const insights = draft.insightRefs.flatMap((ref): AdvisorInsightRef[] => {
    if (ref.origin === "diagnostics") {
      const d = context.diagnostics.items.find((x) => x.dedupeKey === ref.key);
      return d
        ? [{ origin: "diagnostics", key: d.dedupeKey, title: d.title, kind: d.kind, severity: d.severity }]
        : [];
    }
    const i = context.crossSource.insights.find((x) => x.type === ref.key);
    return i ? [{ origin: "cross_source", key: i.type, title: i.title }] : [];
  });

  return {
    schemaVersion: ADVISOR_SCHEMA_VERSION,
    intent,
    status: draft.status,
    title: draft.title,
    summary: draft.summary,
    period: context.period,
    ...(comparison ? { comparePeriod: comparison.baselinePeriod, comparison } : {}),
    sections,
    insights,
    limitations,
    evidence,
    followUps: draft.followUps,
    provenance: {
      producer,
      ...(promptVersion ? { promptVersion } : {}),
      contextSchemaVersion: context.schemaVersion,
      contextGeneratedAt: context.generatedAt,
      crossSource: {
        status: context.crossSource.status,
        generatedAt: context.crossSource.generatedAt,
      },
      diagnostics: {
        status: context.diagnostics.status,
        alignedWithPeriod: context.diagnostics.alignedWithPeriod,
      },
      fellBack,
    },
  };
}
