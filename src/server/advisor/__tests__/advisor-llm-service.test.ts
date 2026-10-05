/**
 * O fluxo completo com o modelo de linguagem, pelo serviço:
 *
 *   pergunta ─▶ AdvisorQuery ─▶ AdvisorContext ─▶ LlmAdvisorModel ─▶ schema ─▶ guard ─▶ AdvisorResponse
 *
 * Prova: a resposta boa é aceita e completada pelo sistema; cada tipo de mentira
 * (número, data, moeda, evidência, limitação, insight…) é recusado e substituído pela
 * resposta determinística, com isso registrado e sem vestígio do que o modelo inventou;
 * cada falha do provedor (timeout, API, formato, credencial, privacidade) cai no
 * determinístico com o motivo certo; a pergunta livre em fallback recebe uma resposta
 * útil; e o LLM nem é chamado quando não há o que interpretar. O log só tem metadados.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";

import { answerDeterministically } from "../deterministic-model";
import { ADVISOR_PROMPT_VERSION } from "../llm-contract";
import { MODEL_FAILURE_TEXT, type ModelFailureReason } from "../limitations";
import { createAnthropicTransport } from "../llm/anthropic";
import { LlmAdvisorModel, UnconfiguredLlmModel } from "../llm/model";
import type { AdvisorLlmOutput } from "../llm/schema";
import { AdvisorLlmError } from "../llm/transport";
import { logAdvisorEvent, serializeAdvisorEvent, type AdvisorLogEvent } from "../log";
import { validateAdvisorResponse } from "../guard";
import { ADVISOR_INTENTS, INTENT_LABEL } from "../intents";
import { answerAdvisorQuery } from "../service";
import type { AdvisorQuery } from "../types";
import { SEP_PERIOD, WS, sourcesFrom } from "./advisor-fixtures";
import {
  QUERY,
  anthropicError,
  anthropicOk,
  captureLog,
  disp,
  evId,
  fakeFetch,
  fakeTransport,
  goodOutput,
  item,
  ok,
  setup,
} from "./advisor-llm-fixtures";

afterEach(() => vi.restoreAllMocks());

/** Roda o serviço com um transporte de mentira que devolve `respond(output)`. */
async function run(
  respond: (output: AdvisorLlmOutput, context: Awaited<ReturnType<typeof setup>>["context"]) => ReturnType<typeof ok> | Promise<ReturnType<typeof ok>> = (o) => ok(o),
  query: AdvisorQuery = QUERY,
  opts: Parameters<typeof setup>[0] = {},
) {
  const s = await setup(opts);
  const transport = fakeTransport(() => respond(goodOutput(s.context), s.context) as never);
  const log = captureLog();
  const model = new LlmAdvisorModel(transport, { log: log.sink });
  const response = await answerAdvisorQuery(query, { ...s.deps, model, log: log.sink });
  return { ...s, transport, response, log: log.events as AdvisorLogEvent[] };
}

describe("a resposta do modelo é ACEITA quando fundamentada", () => {
  it("o texto é do modelo; figuras, evidências, limitações e proveniência são do sistema", async () => {
    const { response, context, transport } = await run();
    expect(transport.calls).toHaveLength(1);

    expect(response.provenance).toMatchObject({
      producer: "fake:fake-1",
      promptVersion: ADVISOR_PROMPT_VERSION,
      fellBack: false,
    });
    expect(response.title).toBe("Fechamento parcial de 01/10/2026 a 04/10/2026");
    expect(response.status).toBe("answered");
    expect(response.sections.map((s) => s.id)).toEqual(["llm-1", "llm-2"]);

    // o sistema valida a resposta FINAL com as mesmas regras do determinístico
    expect(validateAdvisorResponse(response, context)).toEqual([]);
    // TODAS as limitações do contexto estão na resposta — o modelo não consegue tirar nenhuma
    const present = new Set(response.limitations.map((l) => `${l.code}\u0000${l.message}`));
    for (const l of context.limitations) expect(present.has(`${l.code}\u0000${l.message}`), l.code).toBe(true);
  });

  it("os IDs das evidências são preservados no output: referências reais, e cada uma resolve na lista de evidências", async () => {
    const { response, context } = await run();
    const real = new Set(context.evidence.map((e) => e.ref));
    const resolved = new Set(response.evidence.map((e) => e.ref));
    const cited = response.sections.flatMap((s) => [...s.figures.map((f) => f.ref), ...s.items.flatMap((i) => i.evidenceRefs)]);
    expect(cited.length).toBeGreaterThan(10);
    for (const ref of cited) {
      expect(real.has(ref), `${ref} não é uma referência real`).toBe(true);
      expect(resolved.has(ref), `${ref} não está em response.evidence`).toBe(true);
    }
    expect(cited.some((r) => r.startsWith("ga4.sessions@"))).toBe(true);
    expect(JSON.stringify(response.sections).includes('"E5"')).toBe(false); // nenhum id curto vaza
  });

  it("os números do texto são os do contexto, e as figuras são cópias exatas das evidências", async () => {
    const { response, context } = await run();
    for (const metric of ["ga4.sessions", "rd_marketing.visits", "rd_crm.won_deals", "rd_crm.won_value"]) {
      expect(response.summary + JSON.stringify(response.sections)).toContain(disp(context, metric));
    }
    const sessions = response.sections.flatMap((s) => s.figures).find((f) => f.ref.startsWith("ga4.sessions@"));
    expect(sessions).toEqual(context.evidence.find((e) => e.ref.startsWith("ga4.sessions@")));
  });

  it("o texto de uma limitação vem do contexto, com a gravidade do sistema", async () => {
    const { response, context } = await run();
    const real = context.limitations.find((l) => l.code === "currency_not_informed")!;
    const inline = response.sections.flatMap((s) => s.items).find((i) => i.code === "currency_not_informed")!;
    expect(inline).toMatchObject({ layer: "limitation", text: real.message, severity: real.severity });
  });

  it("responde a cada intenção do produto (exceto a comparação sem base) com uma única chamada ao provedor", async () => {
    for (const intent of ADVISOR_INTENTS.filter((i) => i !== "comparison")) {
      const query: AdvisorQuery = { ...QUERY, intent, ...(intent === "free_question" ? { question: "Como foi outubro?" } : {}) };
      const { response, transport } = await run((o) => ok(o), query);
      expect(transport.calls, intent).toHaveLength(1);
      expect(response.provenance.fellBack, intent).toBe(false);
      expect(response.provenance.producer, intent).toBe("fake:fake-1");
      expect(response.intent).toBe(intent);
    }
  });

  it("o `followUps` é do sistema: intenções reais do produto, com o rótulo do produto", async () => {
    const { response } = await run();
    expect(response.followUps.length).toBeGreaterThan(0);
    for (const f of response.followUps) expect(f.label).toBe(INTENT_LABEL[f.intent]);
  });
});

describe("um modelo que MENTE é recusado e o determinístico entra no lugar", () => {
  async function lies(mutate: (o: AdvisorLlmOutput, c: Awaited<ReturnType<typeof setup>>["context"]) => AdvisorLlmOutput) {
    const out = await run((o, c) => ok(mutate(o, c)));
    const expected = answerDeterministically(out.context, QUERY);
    return { ...out, expected };
  }

  /** o serviço devolve a resposta determinística e registra a recusa — sem vestígio do que o modelo escreveu */
  function expectFallback(r: Awaited<ReturnType<typeof lies>>, violation: string, needle: string) {
    expect(r.response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    expect(r.response.provenance).not.toHaveProperty("promptVersion");
    expect(r.response.title).toBe(r.expected.title);
    expect(r.response.summary).toBe(r.expected.summary);
    const note = r.response.limitations.find((l) => l.code === "model_output_rejected")!;
    expect(note.severity).toBe("warning");
    expect(note.message).toContain("fake:fake-1");
    expect(note.message).toContain(violation);
    expect(JSON.stringify(r.response).includes(needle), `vestígio de "${needle}" na resposta`).toBe(false);
    expect(validateAdvisorResponse(r.response, r.context)).toEqual([]);
  }

  it("número inventado", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: `${o.summary} Foram 1.234 leads qualificados.` })), "number_not_in_context", "1.234 leads");
  });

  it("variação calculada por conta própria", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: `${o.summary} Isso é 12,5% acima do esperado.` })), "number_not_in_context", "12,5%");
  });

  it("taxa criada pelo modelo (conversão entre fontes)", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: `${o.summary} A taxa de conversão do site é de 1,2%.` })), "number_not_in_context", "1,2%");
  });

  it("data inventada", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: `${o.summary} Pico em 20/09/2026.` })), "date_not_in_context", "20/09/2026");
  });

  it("moeda inventada: R$ onde o CRM não informa moeda", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: "O valor ganho foi R$ 23.399,00." })), "currency_assumed", "R$ 23.399");
  });

  it("moeda inventada por extenso", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: "O valor ganho foi de 23.399,00 reais." })), "currency_assumed", "23.399,00 reais");
  });

  it("evidência inexistente", async () => {
    expectFallback(await lies((o) => ({ ...o, sections: [{ ...o.sections[0]!, figureIds: ["E999"] }] })), "unknown_evidence_ref", "E999");
  });

  it("limitação inexistente", async () => {
    expectFallback(
      await lies((o) => ({ ...o, sections: [{ ...o.sections[0]!, items: [item("limitation", "Sem limitações.", [], "tudo_ok")] }] })),
      "unknown_limitation_code",
      "tudo_ok",
    );
  });

  it("insight inexistente", async () => {
    expectFallback(await lies((o) => ({ ...o, insightRefs: [{ origin: "diagnostics", key: "traffic-volume-drop:Inventado" }] })), "unknown_insight_ref", "Inventado");
  });

  it("número que existe no contexto mas que o texto não sustenta com evidência citada", async () => {
    expectFallback(
      await lies((o, c) => ({ ...o, sections: [{ ...o.sections[0]!, items: [item("fact", `Foram ${disp(c, "rd_crm.won_deals")} ganhos.`, [evId(c, "ga4.sessions")])] }] })),
      "number_not_supported_by_evidence",
      "ganhos.",
    );
  });

  it("número por extenso inventado", async () => {
    expectFallback(
      await lies((o, c) => ({ ...o, sections: [{ ...o.sections[0]!, items: [item("fact", "Foram sete mil leads.", [evId(c, "ga4.sessions")])] }] })),
      "spelled_number",
      "sete mil leads",
    );
  });

  it("plataforma que o contexto não tem", async () => {
    expectFallback(await lies((o) => ({ ...o, summary: "O principal problema da empresa é o Google Ads." })), "unknown_entity", "Google Ads");
  });

  it("hipótese solta", async () => {
    expectFallback(
      await lies((o) => ({ ...o, sections: [{ ...o.sections[0]!, items: [item("hypothesis", "Talvez o público tenha mudado de hábito.", [])] }] })),
      "hypothesis_without_evidence",
      "mudado de hábito",
    );
  });

  it("comparação sem comparação calculada", async () => {
    expectFallback(
      await lies((o, c) => ({ ...o, sections: [{ ...o.sections[0]!, items: [item("comparison", "Subiu em relação a setembro.", [evId(c, "ga4.sessions")])] }] })),
      "comparison_not_computed",
      "em relação a setembro",
    );
  });

  it("várias mentiras de uma vez: todos os motivos aparecem na limitação", async () => {
    const r = await lies((o) => ({ ...o, summary: "O Google Ads gerou R$ 99.999,00 em 01/01/2026." }));
    const message = r.response.limitations.find((l) => l.code === "model_output_rejected")!.message;
    for (const code of ["unknown_entity", "currency_assumed", "number_not_in_context", "date_not_in_context"]) expect(message).toContain(code);
  });
});

describe("falha do PROVEDOR: a pergunta nunca fica sem resposta", () => {
  const reasons = Object.keys(MODEL_FAILURE_TEXT) as ModelFailureReason[];

  it.each(reasons.filter((r) => r !== "privacy_blocked"))("`%s` → resposta determinística + `model_failed` com o motivo", async (reason) => {
    const s = await setup();
    const model = new LlmAdvisorModel(
      fakeTransport(() => {
        throw new AdvisorLlmError(reason, { debugDetail: "TEXTO-INTERNO-DO-PROVEDOR", httpStatus: 500 });
      }),
      { log: () => {} },
    );
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    expect(response.summary).toBe(answerDeterministically(s.context, QUERY).summary);
    const note = response.limitations.find((l) => l.code === "model_failed")!;
    expect(note.message).toContain(MODEL_FAILURE_TEXT[reason]);
    expect(note.message).toContain("a resposta determinística foi usada no lugar");
    // o texto do provedor não vaza para o usuário
    expect(JSON.stringify(response).includes("TEXTO-INTERNO-DO-PROVEDOR")).toBe(false);
  });

  it("erro inesperado (um bug) também cai no determinístico, sem mostrar o erro", async () => {
    const s = await setup();
    const model = new LlmAdvisorModel(
      fakeTransport(() => {
        throw new Error("Cannot read properties of undefined (reading 'x') — stack secreta");
      }),
      { log: () => {} },
    );
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toBe(
      "O modelo “fake:fake-1” não respondeu; a resposta determinística foi usada no lugar.",
    );
    expect(JSON.stringify(response).includes("stack secreta")).toBe(false);
  });

  it.each([
    ["texto que não é JSON", "Aqui está o fechamento do mês: foi bom."],
    ["JSON cortado", '{"title":"Fechamento","summary":"No pe'],
    ["JSON válido com o schema errado", JSON.stringify({ resposta: "ok" })],
    ["campo extra proibido (status)", JSON.stringify({ ...goodOutputPlaceholder(), status: "answered" })],
  ])("saída inválida (%s) → determinístico com 'não tinha o formato esperado'", async (_name, text) => {
    const s = await setup();
    const model = new LlmAdvisorModel(fakeTransport(() => ok(text)), { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain("não tinha o formato esperado");
  });

  it("modelo habilitado SEM credencial: determinístico + 'não está configurado neste ambiente'", async () => {
    const s = await setup();
    const model = new UnconfiguredLlmModel("anthropic", "claude-sonnet-5-5", { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    const note = response.limitations.find((l) => l.code === "model_failed")!;
    expect(note.message).toContain("anthropic:claude-sonnet-5-5");
    expect(note.message).toContain("não está configurado neste ambiente");
  });
});

describe("ponta a ponta pelo adaptador HTTP (o `fetch` de mentira faz o papel da API)", () => {
  async function viaHttp(handler: Parameters<typeof fakeFetch>[0]) {
    const s = await setup();
    const http = fakeFetch(handler);
    const transport = createAnthropicTransport({ apiKey: "sk-ant-teste", model: "claude-sonnet-5-5", fetchImpl: http.fetchImpl, timeoutMs: 30 });
    const model = new LlmAdvisorModel(transport, { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    return { ...s, response, http };
  }

  it("resposta válida da API → aceita, com o id do modelo na proveniência", async () => {
    const s = await setup();
    const out = await viaHttp(() => anthropicOk(JSON.stringify(goodOutput(s.context))));
    expect(out.response.provenance).toMatchObject({ producer: "anthropic:claude-sonnet-5-5", fellBack: false });
    expect(out.http.calls).toHaveLength(1);
    expect(out.http.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
  });

  it.each([
    [429, "rate_limit_error", "o serviço do modelo está indisponível no momento"],
    [529, "overloaded_error", "o serviço do modelo está indisponível no momento"],
    [500, "api_error", "o serviço do modelo está indisponível no momento"],
    [401, "authentication_error", "o provedor recusou o pedido"],
    [400, "invalid_request_error", "o provedor recusou o pedido"],
  ])("erro da API (HTTP %i) → fallback determinístico: %s", async (status, type, expected) => {
    const { response } = await viaHttp(() => anthropicError(status, type, "x"));
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain(expected);
  });

  it("sem crédito na conta do provedor (HTTP 400 com a mensagem de saldo) → fallback determinístico que DIZ que é a conta", async () => {
    const { response } = await viaHttp(() =>
      anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."),
    );
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: true });
    const note = response.limitations.find((l) => l.code === "model_failed")!;
    expect(note.message).toContain("a conta do provedor do modelo está sem crédito ou atingiu o limite de gasto");
    expect(JSON.stringify(response).includes("credit balance")).toBe(false);
  });

  it("timeout → fallback determinístico: 'excedeu o tempo limite'", async () => {
    const { response } = await viaHttp(
      ({ init }) =>
        new Promise<Response>((_res, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain("o modelo excedeu o tempo limite");
  });

  it("recusa do modelo (`refusal`) e saída cortada (`max_tokens`) → fallback, nunca o texto parcial", async () => {
    const refused = await viaHttp(() => anthropicOk('{"title":"x"}', { stop_reason: "refusal" }));
    expect(refused.response.limitations.find((l) => l.code === "model_failed")?.message).toContain("o modelo recusou responder");
    const cut = await viaHttp(() => anthropicOk('{"title":"x', { stop_reason: "max_tokens" }));
    expect(cut.response.limitations.find((l) => l.code === "model_failed")?.message).toContain("veio incompleta");
  });
});

describe("pergunta livre em fallback: uma resposta útil e honesta", () => {
  const FREE: AdvisorQuery = { ...QUERY, intent: "free_question", question: "O que aconteceu com o marketing em outubro?" };

  it("o modelo falhou: o usuário recebe o resumo determinístico do período, dito como tal — não o 'requer modelo'", async () => {
    const s = await setup();
    const model = new LlmAdvisorModel(fakeTransport(() => { throw new AdvisorLlmError("unavailable"); }), { log: () => {} });
    const response = await answerAdvisorQuery(FREE, { ...s.deps, model, log: () => {} });

    expect(response.status).not.toBe("needs_model");
    expect(response.title.startsWith("Pergunta livre — Resumo do período")).toBe(true);
    expect(response.summary).toContain("Não foi possível responder à pergunta livre com o modelo de linguagem");
    expect(response.summary).toContain(disp(s.context, "ga4.sessions")); // traz os números reais
    expect(response.sections.length).toBeGreaterThan(0);
    expect(response.limitations.map((l) => l.code)).not.toContain("llm_not_connected");
    expect(response.limitations.map((l) => l.code)).toContain("model_failed");
    expect(JSON.stringify(response).includes("O que aconteceu com o marketing")).toBe(false); // a pergunta nunca é ecoada
  });

  it("o modelo mentiu: mesma resposta útil, e a recusa registrada", async () => {
    const out = await run((o) => ok({ ...o, summary: "O Google Ads vai mal." }), FREE);
    expect(out.response.provenance.fellBack).toBe(true);
    expect(out.response.title.startsWith("Pergunta livre — ")).toBe(true);
    expect(out.response.limitations.map((l) => l.code)).toContain("model_output_rejected");
  });

  it("LLM DESLIGADO (sem modelo): o resumo determinístico do período, dito como tal — não o `needs_model`, e sem simular um fallback", async () => {
    const s = await setup();
    const response = await answerAdvisorQuery(FREE, s.deps);
    expect(response.status).not.toBe("needs_model");
    expect(response.title.startsWith("Pergunta livre — Resumo do período")).toBe(true);
    expect(response.summary).toContain("O modelo de linguagem do Advisor não está ativo neste ambiente");
    expect(response.summary).toContain("segue o resumo determinístico do período, calculado pelo sistema");
    expect(response.summary).toContain(disp(s.context, "ga4.sessions")); // traz os números reais
    expect(response.sections.length).toBeGreaterThan(0);
    // desligado por configuração não é falha: não há `fellBack` nem `model_failed`
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: false });
    expect(response.limitations.find((l) => l.code === "llm_not_connected")).toMatchObject({ origin: "advisor", severity: "info" });
    expect(response.limitations.map((l) => l.code)).not.toContain("model_failed");
    expect(JSON.stringify(response).includes("O que aconteceu com o marketing")).toBe(false); // a pergunta nunca é ecoada
  });
});

describe("quando não há o que interpretar, o modelo de linguagem NEM É CHAMADO", () => {
  it("sem Cross-source gerado: resposta determinística `no_data`, sem chamada e sem fallback", async () => {
    const s = await setup();
    const transport = fakeTransport(() => ok(goodOutput(s.context)));
    const log = captureLog();
    const response = await answerAdvisorQuery(QUERY, {
      ...sourcesFrom(createMemoryStore()),
      model: new LlmAdvisorModel(transport, { log: log.sink }),
      log: log.sink,
    });
    expect(transport.calls).toHaveLength(0);
    expect(response.status).toBe("no_data");
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: false });
    expect(response.limitations.find((l) => l.code === "cross_source_not_generated")?.severity).toBe("blocking");
    expect(response.limitations.map((l) => l.code)).not.toContain("model_failed");
    expect(log.events).toMatchObject([{ event: "advisor.answer", outcome: "skipped", skippedReason: "no_data", fellBack: false }]);
  });

  it("pergunta livre sem Cross-source: o `no_data` honesto, não o 'requer modelo'", async () => {
    const transport = fakeTransport(() => ok({}));
    const response = await answerAdvisorQuery(
      { ...QUERY, intent: "free_question", question: "Como foi outubro?" },
      { ...sourcesFrom(createMemoryStore()), model: new LlmAdvisorModel(transport, { log: () => {} }), log: () => {} },
    );
    expect(transport.calls).toHaveLength(0);
    expect(response.status).toBe("no_data");
    expect(response.title.startsWith("Pergunta livre — ")).toBe(true);
  });

  it("comparação não computável (4 dias × 30 dias): o sistema responde `not_computable`, sem chamar o modelo", async () => {
    const s = await setup();
    const transport = fakeTransport(() => ok(goodOutput(s.context)));
    const response = await answerAdvisorQuery(
      { ...QUERY, intent: "comparison", comparePeriod: { startDate: "2026-09-01", endDate: "2026-09-30" } },
      { ...s.deps, model: new LlmAdvisorModel(transport, { log: () => {} }), log: () => {} },
    );
    expect(transport.calls).toHaveLength(0);
    expect(response.status).toBe("not_computable");
    expect(response.provenance.producer).toBe("deterministic");
  });

  it("comparação COMPUTADA: o modelo é chamado e recebe a variação já calculada pelo sistema", async () => {
    const s = await setup({ compare: true });
    const transport = fakeTransport(() => ok(goodOutput(s.context)));
    await answerAdvisorQuery(
      { ...QUERY, intent: "comparison", comparePeriod: SEP_PERIOD },
      { ...s.deps, model: new LlmAdvisorModel(transport, { log: () => {} }), log: () => {} },
    );
    expect(transport.calls).toHaveLength(1);
    const sent = JSON.parse(transport.calls[0]!.user) as { context: { comparison: { status: string; items: { delta: string }[] } } };
    expect(sent.context.comparison.status).toBe("computed");
    expect(sent.context.comparison.items.length).toBeGreaterThan(0);
    expect(sent.context.comparison.items[0]!.delta).toMatch(/^[+−]?\d/);
  });
});

describe("log: só metadados", () => {
  const SENTINEL_QUESTION = "PERGUNTA-SENSIVEL-DO-USUARIO-123";

  it("a chamada ao provedor e o desfecho da pergunta registram provedor, modelo, intenção, período, latência e tokens — e nada de conteúdo", async () => {
    const s = await setup();
    let t = 1000;
    const clock = () => (t += 617);
    const log = captureLog();
    const transport = fakeTransport(() => ok(goodOutput(s.context)), { provider: "anthropic", model: "claude-sonnet-5-5" });
    const model = new LlmAdvisorModel(transport, { log: log.sink, clock });
    await answerAdvisorQuery({ ...QUERY, intent: "free_question", question: SENTINEL_QUESTION }, { ...s.deps, model, log: log.sink });

    const [llm, answer] = log.events as AdvisorLogEvent[];
    expect(llm).toMatchObject({
      event: "advisor.llm",
      workspaceId: WS,
      intent: "free_question",
      period: { start: "2026-10-01", end: "2026-10-04" },
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      promptVersion: ADVISOR_PROMPT_VERSION,
      outcome: "ok",
      latencyMs: 617,
      inputTokens: 5000,
      outputTokens: 900,
      requestId: "req_test_123",
    });
    expect(answer).toMatchObject({ event: "advisor.answer", outcome: "answered", producer: "anthropic:claude-sonnet-5-5", fellBack: false, status: "answered" });

    // nada de conteúdo: nem a pergunta, nem o resumo, nem rótulos do contexto, nem chaves de conteúdo
    const lines = (log.events as AdvisorLogEvent[]).map(serializeAdvisorEvent).join("\n");
    for (const content of [SENTINEL_QUESTION, "Fechamento parcial", "Sessões (GA4)", "487", "23.399", '"question"', '"prompt"', '"context"', '"summary"']) {
      expect(lines.includes(content), `o log contém "${content}"`).toBe(false);
    }
  });

  it("falha do provedor: o motivo, o status HTTP e o tipo do erro — nunca o texto do provedor", async () => {
    const s = await setup();
    const log = captureLog();
    const model = new LlmAdvisorModel(
      fakeTransport(() => {
        throw new AdvisorLlmError("unavailable", { httpStatus: 529, providerErrorType: "overloaded_error", requestId: "req_x", debugDetail: "ECO-DO-PEDIDO-SENSIVEL" });
      }),
      { log: log.sink },
    );
    await answerAdvisorQuery(QUERY, { ...s.deps, model, log: log.sink });
    const [llm, answer] = log.events as AdvisorLogEvent[];
    expect(llm).toMatchObject({ outcome: "failed", reason: "unavailable", httpStatus: 529, providerErrorType: "overloaded_error", requestId: "req_x" });
    expect(answer).toMatchObject({ outcome: "fallback_failed", fellBack: true, producer: "deterministic" });
    expect(JSON.stringify(log.events).includes("ECO-DO-PEDIDO-SENSIVEL")).toBe(false);
  });

  it("resposta recusada pelo guard: os CÓDIGOS das violações, nunca o texto recusado", async () => {
    const log = captureLog();
    const s = await setup();
    const model = new LlmAdvisorModel(fakeTransport(() => ok({ ...goodOutput(s.context), summary: "Foram 777 leads com R$ 5 de custo." })), { log: log.sink });
    await answerAdvisorQuery(QUERY, { ...s.deps, model, log: log.sink });
    const answer = (log.events as AdvisorLogEvent[]).find((e) => e.event === "advisor.answer")!;
    expect(answer).toMatchObject({ outcome: "fallback_rejected", fellBack: true });
    expect((answer as { violationCodes: string[] }).violationCodes).toEqual(expect.arrayContaining(["number_not_in_context", "currency_assumed"]));
    expect(JSON.stringify(log.events).includes("777 leads")).toBe(false);
  });

  it("a serialização descarta qualquer campo que não seja de metadado, mesmo que escape do tipo", () => {
    const event = {
      event: "advisor.llm",
      workspaceId: WS,
      intent: "free_question",
      period: { start: "2026-10-01", end: "2026-10-04" },
      provider: "anthropic",
      model: "m",
      promptVersion: "v",
      outcome: "ok",
      latencyMs: 1,
      question: "SEGREDO-1",
      prompt: "SEGREDO-2",
      context: { x: "SEGREDO-3" },
      apiKey: "SEGREDO-4",
      response: "SEGREDO-5",
    } as unknown as AdvisorLogEvent;
    const line = serializeAdvisorEvent(event);
    expect(line).not.toMatch(/SEGREDO/);
    expect(JSON.parse(line)).toMatchObject({ event: "advisor.llm", workspaceId: WS, provider: "anthropic" });
  });

  it("o destino padrão escreve UMA linha JSON no log do servidor (`warn` quando houve fallback)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = { workspaceId: WS, intent: "closing_report" as const, period: { start: "2026-10-01", end: "2026-10-04" } };
    logAdvisorEvent({ ...base, event: "advisor.answer", producer: "deterministic", status: "answered", outcome: "answered", fellBack: false, latencyMs: 3 });
    logAdvisorEvent({ ...base, event: "advisor.answer", producer: "deterministic", status: "answered", outcome: "fallback_failed", fellBack: true, latencyMs: 3 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/^\[advisor\] \{"event":"advisor\.answer"/);
  });

  it("um destino de log que lança erro nunca derruba a resposta", async () => {
    const s = await setup();
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model: new LlmAdvisorModel(fakeTransport(() => ok(goodOutput(s.context))), { log: () => {} }), log: () => { throw new Error("disco cheio"); } });
    expect(response.provenance.fellBack).toBe(false);
  });

  it("o serviço não escreve nada no console por conta própria (só através do destino de log)", async () => {
    const spies = (["info", "warn", "error", "log"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const s = await setup();
    await answerAdvisorQuery(QUERY, { ...s.deps, model: new LlmAdvisorModel(fakeTransport(() => ok(goodOutput(s.context))), { log: () => {} }), log: () => {} });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

/** Um objeto válido no formato do schema (para variar só um campo nos testes de saída inválida). */
function goodOutputPlaceholder(): AdvisorLlmOutput {
  return {
    title: "t",
    summary: "s",
    sections: [{ title: "a", content: "b", figureIds: [], items: [item("fact", "x", ["E1"])] }],
    insightRefs: [],
  };
}
