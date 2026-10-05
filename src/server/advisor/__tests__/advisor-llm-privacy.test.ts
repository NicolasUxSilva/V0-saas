/**
 * Privacidade: o que sai para o provedor de LLM.
 *
 * Duas garantias estruturais, provadas aqui: (1) a visão do contexto é uma PROJEÇÃO
 * explícita — um campo novo do `AdvisorContext` não chega ao provedor até alguém
 * decidir isso; (2) uma varredura fail-closed barra o envio quando qualquer string do
 * payload (inclusive a pergunta digitada) parece dado pessoal. E o payload que de
 * fato chega ao transporte é conferido por regexes independentes das do código.
 */
import { describe, expect, it } from "vitest";

import { CONTEXT_FIELDS_NOT_SENT, LLM_VIEW_FIELDS, projectContextForModel, scanForPii } from "../llm/privacy";
import { LlmAdvisorModel } from "../llm/model";
import { answerAdvisorQuery } from "../service";
import { WS, diagnosticItem, octoberContext } from "./advisor-fixtures";
import { QUERY, captureLog, fakeTransport, goodOutput, ok, setup } from "./advisor-llm-fixtures";

describe("a visão é uma projeção explícita do contexto", () => {
  it("tem exatamente os campos de `LLM_VIEW_FIELDS`", async () => {
    const { context } = await setup();
    expect(Object.keys(projectContextForModel(context).view).sort()).toEqual([...LLM_VIEW_FIELDS].sort());
  });

  it("todo campo do `AdvisorContext` é enviado ou deliberadamente NÃO enviado — um campo novo quebra este teste até alguém decidir", async () => {
    const { context } = await setup();
    const sent = new Set<string>(LLM_VIEW_FIELDS);
    const notSent = new Set<string>(CONTEXT_FIELDS_NOT_SENT);
    expect(Object.keys(context).filter((k) => !sent.has(k) && !notSent.has(k))).toEqual([]);
    // e o que a lista diz que não vai é exatamente o que a visão deixa de fora
    expect(Object.keys(context).filter((k) => !sent.has(k)).sort()).toEqual([...CONTEXT_FIELDS_NOT_SENT].sort());
  });

  it("não leva o workspace, a versão do schema nem o instante em que o contexto foi montado", async () => {
    const { context } = await setup();
    const json = JSON.stringify(projectContextForModel(context).view);
    for (const forbidden of [WS, "workspaceId", "schemaVersion", context.generatedAt, context.crossSource.generatedAt!]) {
      expect(json.includes(forbidden), `a visão contém ${forbidden}`).toBe(false);
    }
    // do Cross-source leva só a DATA de geração (dd/mm/aaaa), não o instante com hora
    expect(JSON.stringify(projectContextForModel(context).view.crossSource.generatedOn)).toBe('"04/10/2026"');
  });

  it("não leva ids técnicos nem o valor numérico cru das evidências (o modelo copia o `display`, não calcula sobre o número)", async () => {
    const { context } = await setup();
    const { view } = projectContextForModel(context);
    for (const e of view.evidence) {
      expect(Object.keys(e).filter((k) => !["id", "source", "label", "display", "period", "note", "currency"].includes(k))).toEqual([]);
    }
    const json = JSON.stringify(view);
    for (const technical of ['"ref"', '"insightType"', '"value":', "@2026", "ga4.sessions", "rd_crm.won_value"]) {
      expect(json.includes(technical), `a visão contém ${technical}`).toBe(false);
    }
  });

  it("datas sempre em dd/mm/aaaa — nenhuma ISO para o modelo converter", async () => {
    const { context } = await setup({ compare: true });
    const json = JSON.stringify(projectContextForModel(context).view);
    expect(/\d{4}-\d{2}-\d{2}/.test(json)).toBe(false);
    expect(projectContextForModel(context).view.period).toEqual({ start: "01/10/2026", end: "04/10/2026", days: 4 });
  });

  it("não leva o `supportingEvidence` (Google Ads) do diagnóstico — o guard ainda não conhece esses números", async () => {
    const { context } = await setup({
      diagnostics: [
        diagnosticItem({
          evidence: {
            metricLabel: "Sessões do site",
            current: 100,
            previous: 120,
            baseline: null,
            deltaPct: -0.1667,
            format: "count",
            test: null,
            breakdown: [],
            supportingEvidence: [
              {
                source: "google_ads",
                relationship: "same_period",
                title: "Contexto complementar",
                detail: "Campanha Marca X",
                metrics: { campaignCount: 1, impressions: 9, clicks: 8, cost: 7, conversions: 6, conversionValue: 5, impressionShare: null },
                currency: "BRL",
              },
            ],
          },
        }),
      ],
    });
    const json = JSON.stringify(projectContextForModel(context).view);
    for (const forbidden of ["Campanha Marca X", "google_ads", "supportingEvidence"]) {
      expect(json.includes(forbidden), `a visão contém ${forbidden}`).toBe(false);
    }
  });
});

describe("ids curtos das evidências", () => {
  it("E1…En, únicos e sequenciais, um por evidência — e a tradução de volta é um-para-um", async () => {
    const { context } = await setup();
    const { view, aliasToRef } = projectContextForModel(context);
    expect(view.evidence.map((e) => e.id)).toEqual(Array.from({ length: context.evidence.length }, (_, i) => `E${i + 1}`));
    expect([...aliasToRef.values()].sort()).toEqual(context.evidence.map((e) => e.ref).sort());
  });

  it("toda citação da visão (fatos, relações, hipóteses, limitações, fontes) usa só ids que existem", async () => {
    const { context } = await setup();
    const { view, aliasToRef } = projectContextForModel(context);
    const cited = [
      ...view.facts.flatMap((s) => s.evidenceIds),
      ...view.observations.flatMap((s) => s.evidenceIds),
      ...view.hypotheses.flatMap((s) => s.evidenceIds),
      ...view.limitations.flatMap((l) => l.evidenceIds),
      ...view.sources.flatMap((s) => s.evidenceIds),
    ];
    expect(cited.length).toBeGreaterThan(10);
    for (const id of cited) expect(aliasToRef.has(id), id).toBe(true);
  });

  it("com comparação, as evidências do período-base também ganham id e os itens apontam para os dois", async () => {
    const { context } = await setup({ compare: true });
    const { view, aliasToRef } = projectContextForModel(context);
    expect(view.comparison?.status).toBe("computed");
    expect(aliasToRef.size).toBe(context.evidence.length + context.comparison!.baselineEvidence.length);
    for (const i of view.comparison!.items) {
      expect(i.currentEvidenceId).not.toBeNull();
      expect(i.baselineEvidenceId).not.toBeNull();
      expect(aliasToRef.has(i.currentEvidenceId!)).toBe(true);
      expect(aliasToRef.has(i.baselineEvidenceId!)).toBe(true);
    }
  });
});

describe("ausência continua ausência", () => {
  it("evidência sem dado vai com `display: null` — nunca '0'", async () => {
    const { context } = await setup({ context: octoberContext({ ga4Days: [] }) });
    const { view } = projectContextForModel(context);
    const missing = context.evidence.filter((e) => e.value === null);
    expect(missing.length).toBeGreaterThan(0);
    for (const e of missing) {
      const v = view.evidence.find((x) => x.label === e.label)!;
      expect(v.display, e.label).toBeNull();
    }
    expect(view.sources.find((s) => s.source === "ga4")?.status).toBe("unavailable");
  });

  it("`currency` só nos valores monetários, e `null` quando a fonte não informa a moeda (nunca assumida)", async () => {
    const { context } = await setup();
    const { view } = projectContextForModel(context);
    const withCurrency = view.evidence.filter((e) => "currency" in e);
    expect(withCurrency.length).toBeGreaterThan(0);
    for (const e of withCurrency) expect(e.currency).toBeNull();
    expect(view.evidence.find((e) => e.label === "Sessões (GA4)")).not.toHaveProperty("currency");
  });
});

describe("varredura de PII", () => {
  const kinds = (text: string) => scanForPii({ x: text }).map((f) => f.kind);

  it.each([
    ["e-mail", "fale com joao.silva+vendas@empresa.com.br hoje", "email"],
    ["URL com http", "veja https://exemplo.com/perfil?id=1", "url"],
    ["URL com www", "acesse www.exemplo.com.br/contato", "url"],
    ["UUID", "id 123e4567-e89b-12d3-a456-426614174000", "uuid"],
    ["CPF formatado", "CPF 123.456.789-09", "document_number"],
    ["CNPJ formatado", "CNPJ 12.345.678/0001-95", "document_number"],
    ["telefone com DDD e hífen", "ligue (11) 98765-4321", "phone"],
    ["telefone sem 9", "ligue 11 3456-7890", "phone"],
    ["telefone com DDI", "ligue +55 11 98765-4321", "phone"],
    ["sequência longa de dígitos (CPF sem pontuação)", "documento 12345678909", "long_digits"],
    ["sequência longa de dígitos (id)", "cliente 4829105736", "long_digits"],
  ])("acusa %s", (_name, text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it("NÃO acusa o que o contexto legitimamente carrega: números pt-BR, percentuais, datas, ids de evidência, nomes de fonte", () => {
    for (const legit of [
      "23.399,00",
      "1.234.567",
      "26,3%",
      "487 sessões em 4 de 4 dias",
      "01/10/2026 a 04/10/2026",
      "2026-10-04",
      "E12",
      "RD Marketing, RD CRM e GA4",
      "Negócios criados com source_id",
      "88,9% (8 de 9)",
      "12345678",
    ]) {
      expect(kinds(legit), legit).toEqual([]);
    }
  });

  it("devolve só o TIPO e o CAMINHO do achado — nunca o valor", () => {
    const findings = scanForPii({ query: { question: "meu e-mail é maria@exemplo.com" } }, "payload");
    expect(findings).toEqual([{ kind: "email", where: "payload.query.question" }]);
    expect(JSON.stringify(findings)).not.toContain("maria");
  });

  it("a visão REAL do contexto de outubro não tem nenhum achado", async () => {
    const { context } = await setup({ compare: true });
    expect(scanForPii(projectContextForModel(context).view)).toEqual([]);
  });
});

describe("o payload que chega ao transporte", () => {
  async function sentPayload(question?: string) {
    const { context, deps } = await setup();
    const transport = fakeTransport(() => ok(goodOutput(context)));
    const query = question ? { ...QUERY, intent: "free_question" as const, question } : QUERY;
    await answerAdvisorQuery(query, { ...deps, model: new LlmAdvisorModel(transport, { log: () => {} }) });
    return { request: transport.calls[0]!, context };
  }

  it("não tem e-mail, telefone, CPF/CNPJ, UUID, URL nem sequência longa de dígitos (regexes independentes das do código)", async () => {
    const { request } = await sentPayload("Como foi outubro?");
    for (const text of [request.system, request.user]) {
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(text).not.toMatch(/https?:\/\//i);
      expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
      expect(text).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
      expect(text).not.toMatch(/\(?\d{2}\)?\s?9?\d{4}-\d{4}/);
      expect(text).not.toMatch(/\d{9,}/);
    }
  });

  it("não tem o workspace, e a pergunta digitada vai SÓ no campo `query.question` da mensagem de dados", async () => {
    const { request } = await sentPayload("Como foi outubro?");
    expect(request.system).not.toContain(WS);
    expect(request.user).not.toContain(WS);
    expect(request.system).not.toContain("Como foi outubro?");
    const body = JSON.parse(request.user) as { query: { question: string }; context: unknown };
    expect(body.query.question).toBe("Como foi outubro?");
    expect(Object.keys(body).sort()).toEqual(["context", "query"]);
  });

  it("sem pergunta livre, nenhum campo `question` é enviado", async () => {
    const { request } = await sentPayload();
    expect(JSON.parse(request.user).query).not.toHaveProperty("question");
  });
});

describe("PII bloqueia o envio — fail-closed", () => {
  async function run(over: { question?: string; diagnostics?: ReturnType<typeof diagnosticItem>[] }) {
    const { context, deps } = await setup({ diagnostics: over.diagnostics });
    const transport = fakeTransport(() => ok(goodOutput(context)));
    const log = captureLog();
    const query = over.question ? { ...QUERY, intent: "free_question" as const, question: over.question } : QUERY;
    const response = await answerAdvisorQuery(query, {
      ...deps,
      model: new LlmAdvisorModel(transport, { log: log.sink }),
      log: log.sink,
    });
    return { response, transport, log: log.events };
  }

  it.each([
    ["e-mail na pergunta", "Mande o resumo para ana.paula@empresa.com e diga como foi outubro", "email"],
    ["telefone na pergunta", "Ligue para (11) 98765-4321 sobre os negócios", "phone"],
    ["CPF na pergunta", "O cliente 123.456.789-09 fechou?", "document_number"],
    ["id longo na pergunta", "Negócio 4829105736 foi ganho?", "long_digits"],
  ])("%s: o provedor NÃO é chamado, o Advisor responde de forma determinística e diz por quê", async (_name, question, kind) => {
    const { response, transport, log } = await run({ question });
    expect(transport.calls).toHaveLength(0);
    expect(response.provenance.fellBack).toBe(true);
    const note = response.limitations.find((l) => l.code === "model_failed")!;
    expect(note.message).toContain("a pergunta contém dado pessoal e não foi enviada ao modelo");

    // o log registra o TIPO do dado pessoal — nunca o valor
    const llmEvent = log.find((e) => (e as { event: string }).event === "advisor.llm") as { piiKinds: string[]; reason: string };
    expect(llmEvent.reason).toBe("privacy_blocked");
    expect(llmEvent.piiKinds).toContain(kind);
    const everything = JSON.stringify([response, log]);
    for (const value of ["ana.paula@empresa.com", "98765-4321", "123.456.789-09", "4829105736"]) {
      expect(everything.includes(value), `vazou ${value}`).toBe(false);
    }
  });

  it("PII que vier de uma dimensão externa do diagnóstico (rótulo de canal/campanha) também bloqueia — nada vai ao provedor nem ao log", async () => {
    const { response, transport, log } = await run({
      diagnostics: [diagnosticItem({ explanation: "A queda veio do canal 'contato@lojadamaria.com.br'." })],
    });
    expect(transport.calls).toHaveLength(0);
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.find((l) => l.code === "model_failed")?.message).toContain("contém dado pessoal");
    expect(JSON.stringify(log).includes("lojadamaria")).toBe(false);
    // (o fallback determinístico mostra ao DONO do workspace o diagnóstico dele; o que não pode é sair para um terceiro)
  });

  it("sem PII, o provedor é chamado normalmente (a varredura não bloqueia o que é legítimo)", async () => {
    const { response, transport } = await run({ question: "Quais foram os principais problemas em outubro de 2026, com 487 sessões?" });
    expect(transport.calls).toHaveLength(1);
    expect(response.provenance.fellBack).toBe(false);
  });
});
