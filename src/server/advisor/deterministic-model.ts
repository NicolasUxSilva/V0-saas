/**
 * `DeterministicAdvisorModel` — o Advisor SEM LLM.
 *
 * Responde às intenções do produto organizando, em seções, o que o `AdvisorContext`
 * já contém: figuras e frases do Cross-source, insights do diagnóstico, hipóteses e
 * limitações. NÃO interpreta, NÃO calcula e NÃO escreve número algum: todo número
 * que aparece é o `display` de uma evidência do contexto (ou `period.days`, ou um
 * item da comparação já calculada). Os textos do Cross-source entram SEM reescrita.
 *
 * Por que existe, além de funcionar sem LLM: é o piso e o gabarito. Um modelo
 * futuro devolve o MESMO contrato (`AdvisorModelResponse`); se ele for recusado
 * pelo guard (número fora do contexto, evidência inventada…), o serviço volta
 * para esta resposta, que é correta por construção.
 *
 * Pura: sem banco, rede, env, relógio nem aleatoriedade.
 */
import { COVERAGE_METRICS } from "./compose";
import { count, periodText, plural } from "./format";
import { INTENT_LABEL, type AdvisorIntent } from "./intents";
import { bySeverity, comparisonNotComputable, llmNotConnected } from "./limitations";
import type {
  AdvisorContext,
  AdvisorDiagnosticItem,
  AdvisorDraftSection,
  AdvisorEvidence,
  AdvisorFollowUp,
  AdvisorHypothesis,
  AdvisorItem,
  AdvisorLimitation,
  AdvisorModel,
  AdvisorModelInput,
  AdvisorModelResponse,
  AdvisorQuery,
  AdvisorResponseStatus,
  AdvisorSource,
  AdvisorStatement,
} from "./types";
import type { CrossSourceInsightType } from "../analysis/cross-source";

export class DeterministicAdvisorModel implements AdvisorModel {
  readonly id = "deterministic";
  constructor(private readonly options: DeterministicOptions = {}) {}
  async generate({ context, query }: AdvisorModelInput): Promise<AdvisorModelResponse> {
    return answerDeterministically(context, query, this.options);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Peças reaproveitadas por todas as intenções
// ─────────────────────────────────────────────────────────────────────

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const periodLabel = (c: AdvisorContext) =>
  periodText({ start: c.period.startDate, end: c.period.endDate });
const limitationKey = (l: Pick<AdvisorLimitation, "code" | "message">) =>
  `${l.code}\u0000${l.message}`;

/** O que já foi mostrado numa resposta: nada aparece duas vezes em seções diferentes. */
interface Shown {
  texts: Set<string>;
  limitations: Set<string>;
  figures: Set<string>;
}
const newShown = (): Shown => ({ texts: new Set(), limitations: new Set(), figures: new Set() });

const factItem = (s: AdvisorStatement): AdvisorItem => ({
  layer: "fact",
  text: s.text,
  evidenceRefs: s.evidenceRefs,
});
const relationItem = (s: AdvisorStatement): AdvisorItem => ({
  layer: "observable_relationship",
  text: s.text,
  evidenceRefs: s.evidenceRefs,
});
const hypothesisItem = (h: AdvisorHypothesis): AdvisorItem => ({
  layer: "hypothesis",
  text: h.text,
  evidenceRefs: h.evidenceRefs,
});
const limitationItem = (l: AdvisorLimitation): AdvisorItem => ({
  layer: "limitation",
  text: l.message,
  evidenceRefs: l.evidenceRefs,
  code: l.code,
  severity: l.severity,
});

const types =
  (...wanted: CrossSourceInsightType[]) =>
  (x: { insightType?: CrossSourceInsightType }): boolean =>
    x.insightType !== undefined && wanted.includes(x.insightType);

/** Métricas de valor do CRM — a "história do dinheiro", separada das contagens. */
const VALUE_METRICS: ReadonlySet<string> = new Set([
  "won_value",
  "won_deals_with_value",
  "average_ticket",
  "lost_value",
  "lost_deals_with_value",
]);
const VALUE_LIMITATION_CODES: ReadonlySet<string> = new Set([
  "won_value_partial",
  "lost_value_partial",
  "currency_not_informed",
]);
const isAttributionMetric = (e: AdvisorEvidence) =>
  e.source === "rd_crm" && /source_id|campaign_id/.test(e.metric);

// ─────────────────────────────────────────────────────────────────────
// Seções por tema
// ─────────────────────────────────────────────────────────────────────

interface TopicSpec {
  id: string;
  title: string;
  /** enquadramento — sem números */
  content: string;
  facts?: (s: AdvisorStatement) => boolean;
  relations?: (s: AdvisorStatement) => boolean;
  limitations?: (l: AdvisorLimitation) => boolean;
  /** quais das evidências citadas pelas frases do tema viram figuras DESTA seção */
  figures?: (e: AdvisorEvidence) => boolean;
}

function buildTopic(
  context: AdvisorContext,
  spec: TopicSpec,
  shown: Shown,
): AdvisorDraftSection | null {
  const byRef = new Map(context.evidence.map((e) => [e.ref, e] as const));

  const facts = context.facts.filter(spec.facts ?? (() => false));
  const relations = context.observations.filter(spec.relations ?? (() => false));
  const limitations = bySeverity(context.limitations.filter(spec.limitations ?? (() => false)));

  const items: AdvisorItem[] = [];
  const push = (item: AdvisorItem) => {
    const key = `${item.layer}\u0000${item.text}`;
    if (shown.texts.has(key)) return;
    shown.texts.add(key);
    items.push(item);
  };
  facts.forEach((s) => push(factItem(s)));
  relations.forEach((s) => push(relationItem(s)));
  for (const l of limitations) {
    if (shown.limitations.has(limitationKey(l))) continue;
    shown.limitations.add(limitationKey(l));
    items.push(limitationItem(l));
  }

  const refs = unique([...facts, ...relations, ...limitations].flatMap((x) => x.evidenceRefs));
  const figureRefs = refs.filter((ref) => {
    const e = byRef.get(ref);
    if (!e || shown.figures.has(ref) || !(spec.figures?.(e) ?? false)) return false;
    shown.figures.add(ref);
    return true;
  });

  if (items.length === 0 && figureRefs.length === 0) return null;
  return { id: spec.id, title: spec.title, content: spec.content, figureRefs, items };
}

/** A frase cita uma métrica de valor do CRM? (decide se ela é de "Valores" ou de "Negócios") */
function citesValue(context: AdvisorContext, s: AdvisorStatement): boolean {
  const byRef = new Map(context.evidence.map((e) => [e.ref, e] as const));
  return s.evidenceRefs.some((ref) => {
    const e = byRef.get(ref);
    return e !== undefined && e.source === "rd_crm" && VALUE_METRICS.has(e.metric);
  });
}

type TopicId =
  | "coverage"
  | "acquisition"
  | "commercial"
  | "values"
  | "attribution"
  | "relationships"
  | "populations"
  | "metrics"
  | "cannotClaim";

function topics(context: AdvisorContext): Record<TopicId, TopicSpec> {
  const hasTraffic = context.crossSource.insights.some((i) => i.type === "traffic-and-rd-conversions");
  // GA4 × RD Marketing lado a lado só existe quando as duas fontes cobrem o período;
  // sem isso a seção usa a cobertura de aquisição de cada uma
  const acquisitionType: CrossSourceInsightType = hasTraffic
    ? "traffic-and-rd-conversions"
    : "acquisition-coverage";

  return {
    coverage: {
      id: "coverage",
      title: "Período e cobertura dos dados",
      content: "Quantos dias cada fonte cobre do período pedido e se as fontes cobrem o mesmo período.",
      facts: types("data-coverage", "source-unavailable", "partial-period", "period-mismatch"),
      relations: types("data-coverage"),
      limitations: (l) =>
        types("source-unavailable", "partial-period", "period-mismatch")(l) ||
        (l.origin === "advisor" &&
          (l.code === "cross_source_not_generated" || l.code === "evidence_conflict")),
      figures: (e) => COVERAGE_METRICS.has(e.metric),
    },
    acquisition: {
      id: "acquisition",
      title: "Aquisição — GA4 e RD Marketing",
      content:
        "Tráfego do GA4 e visitas e conversões do RD Marketing. São medidas de fontes diferentes, mostradas lado a lado e nunca combinadas numa taxa.",
      facts: types(acquisitionType),
      relations: types(acquisitionType),
      limitations: types("acquisition-coverage", "traffic-and-rd-conversions"),
      figures: (e) => (e.source === "ga4" || e.source === "rd_marketing") && !COVERAGE_METRICS.has(e.metric),
    },
    commercial: {
      id: "commercial",
      title: "Comercial — RD CRM",
      content: "Negócios criados, ganhos e perdidos no período, pela data de cada evento.",
      facts: (s) => types("commercial-activity")(s) && !citesValue(context, s),
      limitations: (l) => types("commercial-activity")(l) && !VALUE_LIMITATION_CODES.has(l.code),
      figures: (e) =>
        e.source === "rd_crm" &&
        !COVERAGE_METRICS.has(e.metric) &&
        !isAttributionMetric(e) &&
        !VALUE_METRICS.has(e.metric),
    },
    values: {
      id: "values",
      title: "Valores dos negócios",
      content:
        "Valores registrados no CRM. O CRM não informa a moeda e nem todo negócio tem valor — leia cada número junto das limitações.",
      facts: (s) => types("commercial-activity")(s) && citesValue(context, s),
      limitations: (l) => types("commercial-activity")(l) && VALUE_LIMITATION_CODES.has(l.code),
      figures: (e) => e.source === "rd_crm" && VALUE_METRICS.has(e.metric),
    },
    attribution: {
      id: "attribution",
      title: "Origem dos negócios (atribuição)",
      content:
        "Quanto da origem dos negócios está preenchida no CRM — e por que isso, sozinho, não prova atribuição a uma fonte de aquisição.",
      facts: types("attribution-quality"),
      limitations: types("attribution-quality"),
      figures: isAttributionMetric,
    },
    relationships: {
      id: "relationships",
      title: "Observações entre fontes",
      content: "Coexistência de sinais de fontes diferentes no mesmo período. Coexistir no tempo não é causa.",
      relations: types("commercial-vs-acquisition"),
      limitations: types("commercial-vs-acquisition"),
    },
    populations: {
      id: "populations",
      title: "O que o sistema não calcula entre as fontes",
      content:
        "Sessões do GA4, visitas do RD Marketing e negócios do CRM são populações diferentes. Estas relações não foram calculadas por falta de prova nos dados.",
      limitations: types("population-not-comparable"),
    },
    metrics: {
      id: "metrics",
      title: "Métricas não calculáveis no período",
      content: "Métricas do CRM que não puderam ser calculadas com segurança — ausência de dado, não zero.",
      limitations: types("metric-not-computable"),
      figures: (e) => e.value === null,
    },
    cannotClaim: {
      id: "cannot_claim",
      title: "O que os dados não permitem afirmar",
      content:
        "Limites analíticos dos dados: sem chave de ligação entre as fontes não há causa, atribuição, taxa entre fontes, CAC nem ROAS.",
      limitations: types(
        "population-not-comparable",
        "attribution-quality",
        "commercial-vs-acquisition",
        "metric-not-computable",
      ),
    },
  };
}

// ── diagnóstico do motor ────────────────────────────────────────────

function kindLabel(d: AdvisorDiagnosticItem): string {
  if (d.kind === "data_quality") return "Qualidade dos dados";
  if (d.kind === "opportunity") return "Oportunidade";
  return d.severity === "critical" ? "Problema crítico" : "Ponto de atenção";
}

function diagnosticsSection(
  context: AdvisorContext,
  shown: Shown,
  filter: (d: AdvisorDiagnosticItem) => boolean = () => true,
  title = "Diagnóstico do motor",
): { section: AdvisorDraftSection; keys: string[] } {
  const chosen = context.diagnostics.items.filter(filter);
  const items: AdvisorItem[] = [];

  for (const d of chosen) {
    items.push({
      layer: "diagnostic",
      text: `${kindLabel(d)} — ${d.title}${d.explanation.trim() ? `: ${d.explanation}` : ""}`,
      evidenceRefs: [],
    });
    if (d.recommendedAction.trim()) {
      items.push({
        layer: "diagnostic",
        text: `Ação sugerida pelo motor: ${d.recommendedAction}`,
        evidenceRefs: [],
      });
    }
  }

  // o motor analisa a janela padrão: quando ela não é a do período pedido, isso vem junto
  // (só quando há insight desta seção para ele qualificar)
  if (chosen.length > 0) {
    for (const l of context.limitations) {
      if (l.code !== "diagnostics_period_differs" || shown.limitations.has(limitationKey(l))) continue;
      shown.limitations.add(limitationKey(l));
      items.push(limitationItem(l));
    }
  }

  const windows = unique(chosen.map((d) => periodText(d.period)));
  const content =
    chosen.length === 0
      ? "O motor de diagnóstico não tem insights abertos ou reconhecidos para este workspace."
      : context.diagnostics.alignedWithPeriod === true
        ? "Insights do motor determinístico de diagnóstico para o período pedido."
        : `Insights do motor determinístico de diagnóstico. Janela analisada pelo motor: ${windows.join("; ")}.`;

  return {
    section: { id: "diagnostics", title, content, figureRefs: [], items },
    keys: chosen.map((d) => d.dedupeKey),
  };
}

function hypothesesSection(
  context: AdvisorContext,
  shown: Shown,
): { section: AdvisorDraftSection | null; diagnosticKeys: string[] } {
  const seen = new Set<string>();
  const items: AdvisorItem[] = [];
  const diagnosticKeys: string[] = [];
  for (const h of context.hypotheses) {
    if (seen.has(h.text)) continue;
    seen.add(h.text);
    items.push(hypothesisItem(h));
    if (h.origin === "diagnostics") diagnosticKeys.push(h.from);
  }
  if (items.length === 0) return { section: null, diagnosticKeys };

  // hipótese do motor vale para a janela DO MOTOR: a limitação de janela diferente vai junto
  if (diagnosticKeys.length > 0) {
    for (const l of context.limitations) {
      if (l.code !== "diagnostics_period_differs" || shown.limitations.has(limitationKey(l))) continue;
      shown.limitations.add(limitationKey(l));
      items.push(limitationItem(l));
    }
  }
  return {
    section: {
      id: "hypotheses",
      title: "Hipóteses a investigar",
      content: "Hipóteses são pontos a investigar, não conclusões: nenhuma causa foi comprovada pelos dados.",
      figureRefs: [],
      items,
    },
    diagnosticKeys,
  };
}

function attentionSection(context: AdvisorContext, shown: Shown): AdvisorDraftSection | null {
  const items: AdvisorItem[] = [];
  for (const l of bySeverity(context.limitations.filter((x) => x.severity !== "info"))) {
    if (shown.limitations.has(limitationKey(l))) continue;
    shown.limitations.add(limitationKey(l));
    items.push(limitationItem(l));
  }
  if (items.length === 0) return null;
  return {
    id: "attention",
    title: "Limitações que pedem atenção",
    content: "Pontos em que os dados estão incompletos, parciais ou indisponíveis para o período.",
    figureRefs: [],
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Resumo (uma frase com os números de cabeçalho — só `display`s do contexto)
// ─────────────────────────────────────────────────────────────────────

function headline(context: AdvisorContext): string[] {
  const by = (id: string) => context.evidence.find((e) => `${e.source}.${e.metric}` === id);
  const status = (s: AdvisorSource) => context.sources.find((x) => x.source === s);
  const out: string[] = [];

  const sessions = by("ga4.sessions");
  if (sessions) {
    if (sessions.value === null) {
      out.push("GA4: sem dados no período (ausência de dado, não zero sessões)");
    } else {
      const g = status("ga4");
      const days =
        g && g.daysWithData !== null && g.periodDays !== null
          ? ` em ${count(g.daysWithData)} de ${count(g.periodDays)} dias`
          : "";
      out.push(`GA4: ${sessions.display} ${plural(sessions.value, "sessão", "sessões")}${days}`);
    }
  }

  const visits = by("rd_marketing.visits");
  const conversions = by("rd_marketing.conversions");
  if (visits && conversions && visits.value !== null && conversions.value !== null) {
    const m = status("rd_marketing");
    const days =
      m && m.daysWithData !== null && m.periodDays !== null
        ? ` em ${count(m.daysWithData)} de ${count(m.periodDays)} dias`
        : "";
    out.push(
      `RD Marketing: ${visits.display} ${plural(visits.value, "visita", "visitas")} e ${conversions.display} ${plural(conversions.value, "conversão", "conversões")}${days}`,
    );
  } else if (status("rd_marketing")?.status === "unavailable") {
    out.push("RD Marketing: sem dados no período");
  }

  const created = by("rd_crm.created_deals");
  const won = by("rd_crm.won_deals");
  const lost = by("rd_crm.lost_deals");
  if (created && won && lost && created.value !== null && won.value !== null && lost.value !== null) {
    out.push(
      `RD CRM: ${created.display} ${plural(created.value, "negócio criado", "negócios criados")}, ${won.display} ${plural(won.value, "ganho", "ganhos")} e ${lost.display} ${plural(lost.value, "perdido", "perdidos")}`,
    );
    const wonValue = by("rd_crm.won_value");
    const withValue = by("rd_crm.won_deals_with_value");
    if (wonValue && wonValue.value !== null && wonValue.display !== null) {
      const basis =
        withValue && withValue.display !== null
          ? ` (soma de ${withValue.display} de ${won.display} ${plural(won.value, "ganho", "ganhos")} com valor registrado${wonValue.currency ? "" : "; moeda não informada pelo CRM"})`
          : "";
      out.push(`valor dos ganhos ${wonValue.display}${basis}`);
    }
  } else if (status("rd_crm")?.status === "unavailable") {
    out.push("RD CRM: sem negócios criados ou fechados no período");
  }

  return out;
}

function summaryText(context: AdvisorContext): string {
  const days = context.period.days;
  const head = `Período ${periodLabel(context)} (${count(days)} ${plural(days, "dia", "dias")}).`;
  const clauses = headline(context);
  return clauses.length > 0 ? `${head} ${clauses.join("; ")}.` : head;
}

// ─────────────────────────────────────────────────────────────────────
// Status, acompanhamentos, referências
// ─────────────────────────────────────────────────────────────────────

/** `partial` quando alguma fonte não cobre o período inteiro ou há limitação bloqueante. */
export function completeness(context: AdvisorContext): AdvisorResponseStatus {
  const incomplete =
    context.sources.some((s) => s.status !== "covered") ||
    context.limitations.some((l) => l.severity === "blocking");
  return incomplete ? "partial" : "answered";
}

const FOLLOW_UP_POOL: readonly AdvisorIntent[] = [
  "closing_report",
  "problems",
  "acquisition_analysis",
  "commercial_analysis",
  "opportunities",
  "period_summary",
];

export function followUps(intent: AdvisorIntent): AdvisorFollowUp[] {
  return FOLLOW_UP_POOL.filter((i) => i !== intent)
    .slice(0, 4)
    .map((i) => ({ intent: i, label: INTENT_LABEL[i] }));
}

/** Tipos de insight do Cross-source cujas frases/limitações aparecem nas seções. */
function crossSourceRefs(context: AdvisorContext, sections: AdvisorDraftSection[]) {
  const shownTexts = new Set(sections.flatMap((s) => s.items.map((i) => i.text)));
  const used = new Set<string>();
  for (const s of [...context.facts, ...context.observations]) {
    if (shownTexts.has(s.text)) used.add(s.insightType);
  }
  for (const l of context.limitations) {
    if (l.insightType && shownTexts.has(l.message)) used.add(l.insightType);
  }
  return context.crossSource.insights
    .filter((i) => used.has(i.type))
    .map((i) => ({ origin: "cross_source" as const, key: i.type }));
}

interface Assembled {
  status: AdvisorResponseStatus;
  title: string;
  summary: string;
  sections: (AdvisorDraftSection | null)[];
  diagnosticKeys?: string[];
  extraLimitations?: AdvisorLimitation[];
}

function assemble(context: AdvisorContext, intent: AdvisorIntent, a: Assembled): AdvisorModelResponse {
  const sections = a.sections.filter((s): s is AdvisorDraftSection => s !== null);
  return {
    status: a.status,
    title: a.title,
    summary: a.summary,
    sections,
    insightRefs: [
      ...(a.diagnosticKeys ?? []).map((key) => ({ origin: "diagnostics" as const, key })),
      ...crossSourceRefs(context, sections),
    ],
    followUps: followUps(intent),
    ...(a.extraLimitations ? { extraLimitations: a.extraLimitations } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// As intenções
// ─────────────────────────────────────────────────────────────────────

/** Intenções que precisam do Cross-source gerado para ter fatos. */
const NEEDS_CROSS_SOURCE: ReadonlySet<AdvisorIntent> = new Set([
  "period_summary",
  "closing_report",
  "diagnostic_explanation",
  "acquisition_analysis",
  "commercial_analysis",
]);

export interface DeterministicOptions {
  /**
   * O que responder a uma `free_question`:
   *  - `needs_model` (padrão da função pura): diz que a pergunta livre precisa do modelo
   *    de linguagem, que não está ativo neste ambiente, e oferece as análises sugeridas.
   *    O serviço não o produz mais — o contrato (`needs_model`) permanece;
   *  - `period_summary`: há (ou houve) um modelo de linguagem, mas ele não pôde
   *    responder (falhou ou foi recusado) ou não há o que interpretar — entrega o
   *    resumo determinístico do período, dizendo isso. Útil e honesto: o usuário
   *    não fica sem resposta e nada é inventado;
   *  - `period_summary_llm_off`: o modelo de linguagem está DESLIGADO neste ambiente
   *    (`ADVISOR_LLM_ENABLED=false`, o estado de entrega) — o mesmo resumo
   *    determinístico, dizendo que a camada de linguagem não está ativa e com a
   *    limitação `llm_not_connected`. É a política do serviço (`deterministicModel`).
   */
  freeQuestion?: "needs_model" | "period_summary" | "period_summary_llm_off";
}

export function answerDeterministically(
  context: AdvisorContext,
  query: AdvisorQuery,
  options: DeterministicOptions = {},
): AdvisorModelResponse {
  const { intent } = query;
  const P = periodLabel(context);
  const shown = newShown();
  const t = topics(context);

  if (intent === "free_question") {
    return options.freeQuestion === "period_summary" || options.freeQuestion === "period_summary_llm_off"
      ? freeQuestionAsSummary(context, query, options.freeQuestion === "period_summary_llm_off")
      : freeQuestion();
  }
  if (intent === "comparison") return comparisonAnswer(context, query);

  // sem Cross-source gerado não há fatos: o Advisor diz isso, mostra o que existe e não inventa
  if (NEEDS_CROSS_SOURCE.has(intent) && context.crossSource.status === "not_generated") {
    const diag =
      intent === "closing_report" || intent === "diagnostic_explanation"
        ? diagnosticsSection(context, shown)
        : null;
    return assemble(context, intent, {
      status: "no_data",
      title: `${INTENT_LABEL[intent]} — sem dados para ${P}`,
      summary: `Não há Cross-source gerado para o período ${P}, então não há fatos de GA4, RD Marketing nem RD CRM para apresentar. Nenhum número foi inventado.`,
      sections: [
        buildTopic(context, t.coverage, shown),
        diag && diag.section.items.length > 0 ? diag.section : null,
      ],
      diagnosticKeys: diag?.keys,
    });
  }

  switch (intent) {
    case "period_summary":
      return assemble(context, intent, {
        status: completeness(context),
        title: `Resumo do período ${P}`,
        summary: summaryText(context),
        sections: [
          buildTopic(context, t.coverage, shown),
          buildTopic(context, t.acquisition, shown),
          buildTopic(context, t.commercial, shown),
          buildTopic(context, t.values, shown),
        ],
      });

    case "closing_report": {
      const diag = diagnosticsSection(context, shown);
      const hypotheses = hypothesesSection(context, shown);
      return assemble(context, intent, {
        status: completeness(context),
        title: `Fechamento do período ${P}`,
        summary: summaryText(context),
        sections: [
          buildTopic(context, t.coverage, shown),
          buildTopic(context, t.acquisition, shown),
          buildTopic(context, t.commercial, shown),
          buildTopic(context, t.values, shown),
          buildTopic(context, t.attribution, shown),
          diag.section,
          buildTopic(context, t.relationships, shown),
          hypotheses.section,
          buildTopic(context, t.populations, shown),
          buildTopic(context, t.metrics, shown),
        ],
        diagnosticKeys: unique([...diag.keys, ...hypotheses.diagnosticKeys]),
      });
    }

    case "acquisition_analysis":
      return assemble(context, intent, {
        status: completeness(context),
        title: `Aquisição no período ${P}`,
        summary: summaryText(context),
        sections: [
          buildTopic(context, t.coverage, shown),
          buildTopic(context, t.acquisition, shown),
          buildTopic(context, t.populations, shown),
        ],
      });

    case "commercial_analysis":
      return assemble(context, intent, {
        status: completeness(context),
        title: `Comercial no período ${P}`,
        summary: summaryText(context),
        sections: [
          buildTopic(context, t.coverage, shown),
          buildTopic(context, t.commercial, shown),
          buildTopic(context, t.values, shown),
          buildTopic(context, t.attribution, shown),
          buildTopic(context, t.populations, shown),
          buildTopic(context, t.metrics, shown),
        ],
      });

    case "diagnostic_explanation": {
      const diag = diagnosticsSection(context, shown);
      return assemble(context, intent, {
        status: completeness(context),
        title: `O que os dados sustentam sobre ${P}`,
        summary: `${summaryText(context)} Abaixo, só o que os dados e os insights sustentam; nenhuma causa é afirmada.`,
        sections: [
          buildTopic(context, t.coverage, shown),
          buildTopic(context, t.acquisition, shown),
          buildTopic(context, t.commercial, shown),
          diag.section,
          buildTopic(context, t.relationships, shown),
          buildTopic(context, t.cannotClaim, shown),
        ],
        diagnosticKeys: diag.keys,
      });
    }

    case "problems": {
      const diag = diagnosticsSection(
        context,
        shown,
        (d) => d.kind !== "opportunity",
        "Problemas do diagnóstico",
      );
      const attention = attentionSection(context, shown);
      return assemble(context, intent, {
        status: "answered",
        title: "Problemas encontrados",
        summary:
          diag.keys.length > 0
            ? "O motor de diagnóstico registrou insights abertos, listados abaixo com a janela que ele analisou, e os dados têm as limitações descritas em seguida."
            : "O motor de diagnóstico não tem problemas abertos ou reconhecidos. Isso não prova que não há problemas: leia as limitações dos dados abaixo.",
        sections: [diag.section, attention],
        diagnosticKeys: diag.keys,
      });
    }

    case "opportunities": {
      const diag = diagnosticsSection(
        context,
        shown,
        (d) => d.kind === "opportunity",
        "Oportunidades do diagnóstico",
      );
      const hypotheses = hypothesesSection(context, shown);
      const none = diag.keys.length === 0 && hypotheses.section === null;
      return assemble(context, intent, {
        status: "answered",
        title: "Hipóteses e oportunidades a investigar",
        summary: none
          ? "Não há oportunidades do diagnóstico nem hipóteses registradas para este período. Nada foi inventado."
          : "Estas são hipóteses e oportunidades a investigar, não conclusões: os dados não comprovam causa nem atribuição.",
        sections: [diag.keys.length > 0 ? diag.section : null, hypotheses.section],
        diagnosticKeys: unique([...diag.keys, ...hypotheses.diagnosticKeys]),
      });
    }
  }
}

// ── pergunta livre ──────────────────────────────────────────────────

function freeQuestion(): AdvisorModelResponse {
  return {
    status: "needs_model",
    title: "Pergunta livre",
    summary:
      "Esta pergunta exige o modelo de linguagem do Advisor, que não está ativo neste ambiente, e nenhuma resposta foi inventada. Escolha uma das análises abaixo: o sistema as calcula e responde de forma determinística.",
    sections: [],
    insightRefs: [],
    followUps: [
      { intent: "closing_report", label: INTENT_LABEL.closing_report },
      { intent: "period_summary", label: INTENT_LABEL.period_summary },
      { intent: "problems", label: INTENT_LABEL.problems },
      { intent: "acquisition_analysis", label: INTENT_LABEL.acquisition_analysis },
      { intent: "commercial_analysis", label: INTENT_LABEL.commercial_analysis },
    ],
    extraLimitations: [llmNotConnected()],
  };
}

/**
 * Sem modelo utilizável para a pergunta livre: o resumo determinístico do período, dito
 * como tal. `llmOff`: o modelo está desligado neste ambiente (não é uma falha) — a frase
 * diz isso e a limitação `llm_not_connected` acompanha a resposta.
 */
function freeQuestionAsSummary(context: AdvisorContext, query: AdvisorQuery, llmOff: boolean): AdvisorModelResponse {
  const base = answerDeterministically(context, { ...query, intent: "period_summary" });
  const lead = llmOff
    ? "O modelo de linguagem do Advisor não está ativo neste ambiente, então a pergunta livre não foi interpretada; segue o resumo determinístico do período, calculado pelo sistema."
    : "Não foi possível responder à pergunta livre com o modelo de linguagem; segue o resumo determinístico do período, calculado pelo sistema.";
  return {
    ...base,
    title: `Pergunta livre — ${base.title}`,
    summary: `${lead} ${base.summary}`,
    ...(llmOff ? { extraLimitations: [...(base.extraLimitations ?? []), llmNotConnected()] } : {}),
  };
}

// ── comparação ──────────────────────────────────────────────────────

function comparisonAnswer(context: AdvisorContext, query: AdvisorQuery): AdvisorModelResponse {
  const comparison = context.comparison;
  const P = periodLabel(context);

  if (!comparison) {
    return {
      status: "not_computable",
      title: "Comparação entre períodos",
      summary: "Não há período de comparação: não foi possível comparar.",
      sections: [],
      insightRefs: [],
      followUps: followUps(query.intent),
      extraLimitations: [
        comparisonNotComputable("missing_compare_period", "Nenhum período de comparação foi informado."),
      ],
    };
  }

  const base = periodText({
    start: comparison.baselinePeriod.startDate,
    end: comparison.baselinePeriod.endDate,
  });

  if (comparison.status === "not_computable") {
    return {
      status: "not_computable",
      title: `Comparação não computável: ${P} × ${base}`,
      summary: `Os períodos ${P} e ${base} não são comparáveis com os dados disponíveis, então nenhuma comparação foi feita. O motivo está nas limitações abaixo.`,
      sections: [
        {
          id: "comparison_reasons",
          title: "Por que não é computável",
          content: "Cada motivo abaixo impede uma comparação segura entre os dois períodos.",
          figureRefs: [],
          items: comparison.reasons.map(limitationItem),
        },
      ],
      insightRefs: [],
      followUps: followUps(query.intent),
    };
  }

  const items: AdvisorItem[] = comparison.items.map((i) => ({
    layer: "comparison",
    text: `${i.label}: ${i.currentDisplay} em ${P} e ${i.baselineDisplay} em ${base} (${i.deltaDisplay}${
      i.deltaPctDisplay !== null ? `, ${i.deltaPctDisplay}` : "; variação percentual não calculável, a base é zero"
    }).`,
    evidenceRefs: [i.currentRef, i.baselineRef],
  }));

  const sections: AdvisorDraftSection[] = [
    {
      id: "comparison",
      title: "Variação entre os períodos",
      content: `Período atual ${P} contra o período de comparação ${base}, com a mesma duração. Diferenças e variações foram calculadas pelo sistema, não pelo Advisor.`,
      figureRefs: comparison.items.flatMap((i) => [i.currentRef, i.baselineRef]),
      items,
    },
  ];
  if (comparison.skipped.length > 0) {
    sections.push({
      id: "comparison_skipped",
      title: "Não comparado",
      content: "Métricas que existem nos dados, mas que não puderam ser comparadas com segurança.",
      figureRefs: [],
      items: comparison.skipped.map((s) => ({
        layer: "comparison" as const,
        text: `${s.label}: ${s.reason}`,
        evidenceRefs: [],
      })),
    });
  }

  return {
    status: "answered",
    title: `Comparação entre ${P} e ${base}`,
    summary: `Comparação entre ${P} e ${base}, períodos de ${count(context.period.days)} ${plural(context.period.days, "dia", "dias")} cada, com diferenças e variações calculadas pelo sistema.`,
    sections,
    insightRefs: [],
    followUps: followUps(query.intent),
  };
}
