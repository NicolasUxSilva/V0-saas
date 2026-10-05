/**
 * AdvisorModel — a interface para plugar um LLM depois, SEM conectar nenhum agora.
 *
 * O que estes testes provam: (1) um modelo qualquer que devolve `AdvisorModelResponse`
 * funciona de ponta a ponta; (2) o serviço completa de forma determinística o que o
 * modelo não controla (figuras, evidência, limitações, proveniência); (3) um modelo
 * que mente — número, data, moeda, evidência, limitação ou intenção inventados —
 * é recusado e substituído pela resposta determinística, com isso registrado;
 * (4) as regras do prompt futuro existem, são versionadas e a entrada é determinística.
 */
import { describe, expect, it } from "vitest";

import { buildAdvisorContext } from "../context";
import { answerDeterministically } from "../deterministic-model";
import { ADVISOR_INTENTS } from "../intents";
import {
  ADVISOR_INTERPRETATION_RULES,
  ADVISOR_PROMPT_VERSION,
  buildAdvisorModelInput,
} from "../llm-contract";
import { AdvisorInternalError, answerAdvisorQuery, deterministicModel } from "../service";
import type { AdvisorModel, AdvisorModelInput, AdvisorModelResponse, AdvisorQuery } from "../types";
import { OCT_PERIOD, WS, diagnosticItem, octoberContext, persist, sourcesFrom } from "./advisor-fixtures";

const QUERY: AdvisorQuery = { workspaceId: WS, period: OCT_PERIOD, intent: "period_summary" };

async function setup() {
  const memory = await persist(octoberContext(), OCT_PERIOD);
  const deps = sourcesFrom(memory, [diagnosticItem()]);
  const context = await buildAdvisorContext(WS, OCT_PERIOD, {}, deps);
  return { deps, context };
}

/** Um modelo de mentira: devolve o que a função mandar, a partir do que o contexto tem. */
const fakeModel = (
  id: string,
  respond: (input: AdvisorModelInput) => AdvisorModelResponse | Promise<AdvisorModelResponse>,
): AdvisorModel => ({ id, generate: async (input) => respond(input) });

/** Um rascunho honesto, no estilo de um LLM: frases próprias, números só por referência. */
function honestDraft({ context }: AdvisorModelInput): AdvisorModelResponse {
  const sessions = context.evidence.find((e) => e.metric === "sessions")!;
  const visits = context.evidence.find((e) => e.metric === "visits")!;
  return {
    status: "answered",
    title: "Panorama do período",
    summary: `No período, o GA4 registrou ${sessions.display} sessões e o RD Marketing registrou ${visits.display} visitas.`,
    sections: [
      {
        id: "panorama",
        title: "Aquisição",
        content: "Os dois sinais coexistem, sem relação de causa.",
        figureRefs: [sessions.ref, visits.ref],
        items: [
          { layer: "fact", text: `O GA4 registrou ${sessions.display} sessões.`, evidenceRefs: [sessions.ref] },
          { layer: "hypothesis", text: "Pode valer investigar o que atrai o tráfego do site.", evidenceRefs: [sessions.ref] },
        ],
      },
    ],
    insightRefs: [{ origin: "cross_source", key: "acquisition-coverage" }],
    followUps: [{ intent: "closing_report", label: "Fechamento do período" }],
  };
}

describe("um AdvisorModel qualquer funciona de ponta a ponta", () => {
  it("aceita a resposta honesta, completa figuras/evidência/limitações e registra o produtor", async () => {
    const { deps, context } = await setup();
    const response = await answerAdvisorQuery(QUERY, { ...deps, model: fakeModel("modelo-de-teste", honestDraft) });

    expect(response.provenance).toMatchObject({ producer: "modelo-de-teste", fellBack: false });
    expect(response.title).toBe("Panorama do período");
    expect(response.status).toBe("answered");

    // as figuras foram MATERIALIZADAS pelo serviço a partir do contexto: o modelo só deu as referências
    const figures = response.sections[0]!.figures;
    expect(figures.map((f) => [f.metric, f.display])).toEqual([["sessions", "487"], ["visits", "6"]]);
    expect(figures).toEqual(context.evidence.filter((e) => e.metric === "sessions" || e.metric === "visits"));

    // o modelo não escreveu NENHUMA limitação — e a resposta tem todas as do contexto
    expect(response.limitations.length).toBe(context.limitations.length);
    expect(response.limitations.map((l) => l.code)).toContain("currency_not_informed");

    // evidências citadas, insights resolvidos e acompanhamentos do modelo
    expect(response.evidence.map((e) => e.metric)).toEqual(expect.arrayContaining(["sessions", "visits"]));
    expect(response.insights).toEqual([
      { origin: "cross_source", key: "acquisition-coverage", title: "Cobertura de aquisição: tráfego (GA4) e conversões (RD Marketing)" },
    ]);
    expect(response.followUps).toEqual([{ intent: "closing_report", label: "Fechamento do período" }]);
  });

  it("o modelo recebe o contexto e o pedido — e só eles", async () => {
    const { deps } = await setup();
    let received: AdvisorModelInput | null = null;
    await answerAdvisorQuery(QUERY, {
      ...deps,
      model: fakeModel("espiao", (input) => {
        received = input;
        return answerDeterministically(input.context, input.query);
      }),
    });
    expect(Object.keys(received!).sort()).toEqual(["context", "query"]);
    expect(received!.query).toEqual(QUERY);
    expect(received!.context.schemaVersion).toBe(1);
    expect(received!.context.period.days).toBe(4);
  });

  it("uma limitação própria do modelo (origem 'advisor') é aceita e entra na resposta", async () => {
    const { deps } = await setup();
    const model = fakeModel("com-extra", (input) => ({
      ...honestDraft(input),
      extraLimitations: [{ code: "modelo_resumiu", message: "Esta resposta resume o contexto sem listar tudo.", origin: "advisor", severity: "info", sources: [], evidenceRefs: [] }],
    }));
    const response = await answerAdvisorQuery(QUERY, { ...deps, model });
    expect(response.limitations.map((l) => l.code)).toContain("modelo_resumiu");
    expect(response.provenance.fellBack).toBe(false);
  });
});

describe("um modelo que MENTE é recusado — e a resposta determinística entra no lugar", () => {
  async function rejected(lie: (draft: AdvisorModelResponse, input: AdvisorModelInput) => AdvisorModelResponse) {
    const { deps, context } = await setup();
    const model = fakeModel("mentiroso", (input) => lie(honestDraft(input), input));
    const response = await answerAdvisorQuery(QUERY, { ...deps, model });
    const expected = answerDeterministically(context, QUERY);
    return { response, expected, context };
  }

  const expectFallback = ({ response, expected }: Awaited<ReturnType<typeof rejected>>, violation: string) => {
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    // o texto que sai é o determinístico, não o do modelo
    expect(response.title).toBe(expected.title);
    expect(response.summary).toBe(expected.summary);
    // e a recusa fica registrada, com o motivo
    const note = response.limitations.find((l) => l.code === "model_output_rejected");
    expect(note).toBeDefined();
    expect(note?.severity).toBe("warning");
    expect(note?.origin).toBe("advisor");
    expect(note?.message).toContain("mentiroso");
    expect(note?.message).toContain(violation);
  };

  it("número inventado", async () => {
    expectFallback(await rejected((d) => ({ ...d, summary: `${d.summary} Foram 1.234 leads qualificados.` })), "number_not_in_context");
  });

  it("variação calculada por conta própria (o modelo não calcula)", async () => {
    expectFallback(await rejected((d) => ({ ...d, summary: `${d.summary} Isso é 12,5% acima do esperado.` })), "number_not_in_context");
  });

  it("data inventada", async () => {
    expectFallback(await rejected((d) => ({ ...d, summary: `${d.summary} Pico em 20/09/2026.` })), "date_not_in_context");
  });

  it("moeda assumida (R$) quando o CRM não informa moeda", async () => {
    expectFallback(await rejected((d) => ({ ...d, summary: "O valor ganho foi R$ 23.399,00." })), "currency_assumed");
  });

  it("evidência inexistente", async () => {
    expectFallback(
      await rejected((d) => ({ ...d, sections: [{ ...d.sections[0]!, figureRefs: ["rd_crm.cac@2026-10-01..2026-10-04"] }] })),
      "unknown_evidence_ref",
    );
  });

  it("fato sem evidência", async () => {
    expectFallback(
      await rejected((d) => ({ ...d, sections: [{ ...d.sections[0]!, items: [{ layer: "fact", text: "O site vai bem.", evidenceRefs: [] }] }] })),
      "fact_without_evidence",
    );
  });

  it("código de limitação inventado", async () => {
    expectFallback(
      await rejected((d) => ({ ...d, sections: [{ ...d.sections[0]!, items: [{ layer: "limitation", code: "tudo_ok", text: "Sem limitações.", evidenceRefs: [] }] }] })),
      "unknown_limitation_code",
    );
  });

  it("insight inventado", async () => {
    expectFallback(await rejected((d) => ({ ...d, insightRefs: [{ origin: "diagnostics", key: "traffic-volume-drop:Inventado" }] })), "unknown_insight_ref");
  });

  it("várias mentiras de uma vez: todos os motivos aparecem, sem repetir", async () => {
    const r = await rejected((d) => ({ ...d, summary: "R$ 99.999,00 em 01/01/2026.", followUps: [{ intent: "inventada" as never, label: "x" }] }));
    const message = r.response.limitations.find((l) => l.code === "model_output_rejected")!.message;
    for (const code of ["number_not_in_context", "currency_assumed", "date_not_in_context", "unknown_intent"]) expect(message).toContain(code);
  });

  it("a resposta do modelo recusada não deixa NENHUM vestígio na resposta final", async () => {
    const r = await rejected((d) => ({ ...d, title: "Título inventado 777", summary: "777 leads" }));
    expect(JSON.stringify(r.response)).not.toContain("777");
  });
});

describe("falhas do modelo nunca derrubam a pergunta", () => {
  it("modelo que lança erro: resposta determinística + limitação `model_failed`", async () => {
    const { deps, context } = await setup();
    const model = fakeModel("instavel", () => {
      throw new Error("timeout do provedor");
    });
    const response = await answerAdvisorQuery(QUERY, { ...deps, model });
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    expect(response.summary).toBe(answerDeterministically(context, QUERY).summary);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain("instavel");
    // o erro do provedor não vaza para o usuário
    expect(JSON.stringify(response)).not.toContain("timeout do provedor");
  });

  it("modelo que rejeita a promessa também cai no determinístico", async () => {
    const { deps } = await setup();
    const model: AdvisorModel = { id: "async-ruim", generate: () => Promise.reject(new Error("429")) };
    const response = await answerAdvisorQuery(QUERY, { ...deps, model });
    expect(response.provenance.fellBack).toBe(true);
  });

  it("um modelo SEM resposta usável não consegue esconder uma limitação bloqueante", async () => {
    const memory = await persist(octoberContext({ ga4Days: [] }), OCT_PERIOD);
    const deps = sourcesFrom(memory);
    const response = await answerAdvisorQuery(QUERY, { ...deps, model: fakeModel("calado", honestDraft) });
    expect(response.limitations.find((l) => l.code === "ga4_unavailable")?.severity).toBe("blocking");
  });

  it("se NEM a resposta determinística passa na validação, é um erro do Advisor (nunca silencioso)", async () => {
    const { deps } = await setup();
    // um "modelo" que se apresenta como o determinístico, mas devolve uma resposta inválida
    const impostor: AdvisorModel = {
      id: deterministicModel.id,
      generate: async (input) => ({ ...answerDeterministically(input.context, input.query), summary: "Foram 31337." }),
    };
    await expect(answerAdvisorQuery(QUERY, { ...deps, model: impostor })).rejects.toBeInstanceOf(AdvisorInternalError);
  });
});

describe("regras para o futuro LLM", () => {
  it("existem, têm id único e cobrem tudo o que o LLM não pode fazer", () => {
    const ids = ADVISOR_INTERPRETATION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mustNot = new Set(ADVISOR_INTERPRETATION_RULES.filter((r) => r.kind === "must_not").map((r) => r.id));
    for (const rule of [
      "must_not.recalculate", // recalcular métricas / alterar números
      "must_not.invent", // inventar dados
      "must_not.causality", // inferir causalidade como fato
      "must_not.create_evidence", // criar evidência
      "must_not.fill_missing", // preencher campos ausentes
      "must_not.null_to_zero", // transformar ausência em zero
      "must_not.mix_populations", // misturar GA4 sessions com RD contacts
      "must_not.attribution", // transformar source/campaign IDs em atribuição
      "must_not.hypothesis_as_fact",
      "must_not.assume_currency",
      "must_not.drop_limitations",
    ]) {
      expect(mustNot.has(rule), rule).toBe(true);
    }
    // e o que o LLM PODE fazer: resumir, explicar, organizar, comparar fatos já calculados, hipóteses marcadas
    const may = new Set(ADVISOR_INTERPRETATION_RULES.filter((r) => r.kind === "may").map((r) => r.id));
    for (const rule of ["may.interpret", "may.compare_precomputed", "may.explain_limitations", "may.hypothesize"]) {
      expect(may.has(rule), rule).toBe(true);
    }
  });

  it("toda regra é texto não vazio e diz se o guard a aplica mecanicamente", () => {
    for (const r of ADVISOR_INTERPRETATION_RULES) {
      expect(r.text.trim().length, r.id).toBeGreaterThan(20);
      expect(typeof r.enforced).toBe("boolean");
    }
    // as regras que o guard aplica de fato são exatamente as que ele consegue provar
    const enforced = ADVISOR_INTERPRETATION_RULES.filter((r) => r.enforced).map((r) => r.id).sort();
    // (advisor-llm-guard.test.ts prova, regra por regra, que uma violação de cada uma é recusada)
    expect(enforced).toEqual([
      "must.cite_evidence",
      "must.digits_as_displayed",
      "must.structured_output",
      "must_not.assume_currency",
      "must_not.comparison_without_data",
      "must_not.create_evidence",
      "must_not.drop_limitations",
      "must_not.invent",
      "must_not.recalculate",
      "must_not.unanchored_hypothesis",
      "must_not.unknown_entities",
    ]);
  });

  it("a entrada do modelo é determinística, versionada, projetada e sem o workspaceId", async () => {
    const { context } = await setup();
    const a = buildAdvisorModelInput({ context, query: QUERY });
    const b = buildAdvisorModelInput({ context, query: QUERY });
    expect(a).toEqual(b);
    expect(a.promptVersion).toBe(ADVISOR_PROMPT_VERSION);
    expect(a.rules).toBe(ADVISOR_INTERPRETATION_RULES);
    expect(a.contextJson).not.toContain(WS);
    expect(a.query).toEqual({ intent: "period_summary", period: OCT_PERIOD });

    const parsed = JSON.parse(a.contextJson);
    expect(parsed.workspaceId).toBeUndefined();
    // datas já em dd/mm/aaaa: o modelo copia, não converte
    expect(parsed.period).toEqual({ start: "01/10/2026", end: "04/10/2026", days: 4 });
    // a visão leva tudo o que o modelo interpreta — limitações, evidências, hipóteses e diagnóstico — por projeção explícita
    expect(parsed.limitations).toHaveLength(context.limitations.length);
    expect(parsed.evidence).toHaveLength(context.evidence.length);
    expect(parsed.hypotheses).toHaveLength(context.hypotheses.length);
    expect(parsed.diagnostics.items[0].key).toBe("data-quality:no_key_events");
  });

  it("a pergunta livre vai no pedido; a comparação leva o período-base", async () => {
    const { context } = await setup();
    const free = buildAdvisorModelInput({ context, query: { ...QUERY, intent: "free_question", question: "Como foi outubro?" } });
    expect(free.query.question).toBe("Como foi outubro?");
    const cmp = buildAdvisorModelInput({
      context,
      query: { ...QUERY, intent: "comparison", comparePeriod: { startDate: "2026-09-27", endDate: "2026-09-30" } },
    });
    expect(cmp.query.comparePeriod).toEqual({ startDate: "2026-09-27", endDate: "2026-09-30" });
  });

  it("nenhuma das intenções do produto fica sem resposta determinística", async () => {
    const { deps, context } = await setup();
    for (const intent of ADVISOR_INTENTS) {
      const q: AdvisorQuery = {
        ...QUERY,
        intent,
        ...(intent === "free_question" ? { question: "x" } : {}),
        ...(intent === "comparison" ? { comparePeriod: { startDate: "2026-09-27", endDate: "2026-09-30" } } : {}),
      };
      const response = await answerAdvisorQuery(q, deps);
      expect(response.provenance.producer, intent).toBe("deterministic");
      void context;
    }
  });
});
