/**
 * Semântica das camadas na resposta do modelo de linguagem: fato, relação observável,
 * hipótese e limitação — e a regra "ausência não é zero".
 *
 * O sistema NUNCA reclassifica o que o modelo escreveu (um fato não vira hipótese, uma
 * hipótese não vira fato): ele valida o que a camada exige e deixa a etiqueta como veio,
 * para a tela mostrar cada camada com a sua cara.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdvisorResponseView } from "@/components/advisor/response-view";

import { LlmAdvisorModel } from "../llm/model";
import type { AdvisorLlmOutput } from "../llm/schema";
import { answerAdvisorQuery } from "../service";
import type { AdvisorResponse } from "../types";
import { octoberContext } from "./advisor-fixtures";
import { QUERY, disp, evId, fakeTransport, ga4AbsentOutput, goodOutput, item, ok, setup } from "./advisor-llm-fixtures";

async function ask(
  mutate: (o: AdvisorLlmOutput, c: Awaited<ReturnType<typeof setup>>["context"]) => AdvisorLlmOutput = (o) => o,
  opts: Parameters<typeof setup>[0] = {},
): Promise<{ response: AdvisorResponse; context: Awaited<ReturnType<typeof setup>>["context"] }> {
  const s = await setup(opts);
  const model = new LlmAdvisorModel(fakeTransport(() => ok(mutate(goodOutput(s.context), s.context))), { log: () => {} });
  const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
  return { response, context: s.context };
}
const items = (r: AdvisorResponse) => r.sections.flatMap((s) => s.items);
const only = (o: AdvisorLlmOutput, ...xs: AdvisorLlmOutput["sections"][number]["items"]): AdvisorLlmOutput => ({
  ...o,
  sections: [{ ...o.sections[0]!, items: xs }, ...o.sections.slice(1)],
});
const rejectedCodes = (r: AdvisorResponse) => r.limitations.find((l) => l.code === "model_output_rejected")?.message ?? "";

describe("FATO", () => {
  it("uma afirmação com evidência chega à resposta como `fact`, com as referências REAIS — o texto copia o `display`", async () => {
    const { response, context } = await ask();
    const sessions = items(response).find((i) => i.layer === "fact" && i.text.startsWith("O GA4 registrou"))!;
    expect(sessions.text).toContain(disp(context, "ga4.sessions"));
    expect(sessions.evidenceRefs.some((r) => r.startsWith("ga4.sessions@2026-10-01..2026-10-04"))).toBe(true);
    expect(response.provenance.fellBack).toBe(false);
  });

  it("fato SEM evidência é recusado — nunca chega à tela como fato", async () => {
    const { response } = await ask((o) => only(o, item("fact", "O marketing teve baixo desempenho em outubro.", [])));
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toContain("fact_without_evidence");
    expect(JSON.stringify(response).includes("baixo desempenho")).toBe(false);
  });

  it("número aproximado ou arredondado não é o do contexto: 'quase 490 sessões' é recusado", async () => {
    const { response } = await ask((o, c) => only(o, item("fact", "O GA4 teve quase 490 sessões.", [evId(c, "ga4.sessions")])));
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toContain("number_not_in_context");
  });

  it("o texto de um fato pode ser reescrito em linguagem executiva, desde que o número e a evidência sejam os mesmos", async () => {
    const { response } = await ask((o, c) =>
      only(o, item("fact", `Em outubro (parcial), o site recebeu ${disp(c, "ga4.sessions")} sessões segundo o GA4.`, [evId(c, "ga4.sessions")])),
    );
    expect(response.provenance.fellBack).toBe(false);
    expect(items(response)[0]!.text).toMatch(/^Em outubro \(parcial\), o site recebeu 487 sessões segundo o GA4\.$/);
  });
});

describe("RELAÇÃO OBSERVÁVEL", () => {
  it("duas medidas lado a lado chegam como `observable_relationship`, citando as duas evidências", async () => {
    const { response } = await ask();
    const rel = items(response).find((i) => i.layer === "observable_relationship")!;
    expect(rel.evidenceRefs).toHaveLength(2);
    expect(rel.evidenceRefs.map((r) => r.split("@")[0]).sort()).toEqual(["ga4.sessions", "rd_marketing.visits"]);
  });

  it("relação sem evidência é recusada, como o fato", async () => {
    const { response } = await ask((o) => only(o, item("observable_relationship", "O GA4 e o RD Marketing andam juntos.", [])));
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toContain("fact_without_evidence");
  });

  it("fato e relação ficam em camadas DIFERENTES na resposta — o sistema não funde nem reclassifica", async () => {
    const { response } = await ask();
    const layers = new Set(items(response).map((i) => i.layer));
    expect(layers.has("fact")).toBe(true);
    expect(layers.has("observable_relationship")).toBe(true);
    expect(layers.has("hypothesis")).toBe(true);
  });
});

describe("HIPÓTESE", () => {
  it("chega marcada como `hypothesis` (nunca promovida a fato), com a evidência sobre a qual foi levantada", async () => {
    const { response } = await ask();
    const h = items(response).find((i) => i.layer === "hypothesis")!;
    expect(h.text).toBe("Isso pode indicar uma diferença de população ou de instrumentação entre as fontes.");
    expect(h.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("a MESMA frase em outra camada não é reclassificada: o que o modelo marcou como fato continua fato (e exige evidência)", async () => {
    const sentence = "Isso pode indicar uma diferença de população ou de instrumentação entre as fontes.";
    const asFact = await ask((o, c) => only(o, item("fact", sentence, [evId(c, "ga4.sessions")])));
    expect(items(asFact.response).find((i) => i.text === sentence)!.layer).toBe("fact");
    const asHypothesis = await ask((o, c) => only(o, item("hypothesis", sentence, [evId(c, "ga4.sessions")])));
    expect(items(asHypothesis.response).find((i) => i.text === sentence)!.layer).toBe("hypothesis");
  });

  it("hipótese solta (sem evidência) é recusada", async () => {
    const { response } = await ask((o) => only(o, item("hypothesis", "O público talvez tenha mudado.", [])));
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toContain("hypothesis_without_evidence");
  });

  it("hipótese com número que a evidência citada não sustenta é recusada (hipótese não traz número novo)", async () => {
    const { response } = await ask((o, c) =>
      only(o, item("hypothesis", `Pode ser que os ${disp(c, "rd_crm.lost_deals")} perdidos tenham a ver com isso.`, [evId(c, "ga4.sessions")])),
    );
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toContain("number_not_supported_by_evidence");
  });

  it("a tela distingue: a hipótese tem borda tracejada e a etiqueta 'Hipótese'; o fato não", async () => {
    const { response } = await ask();
    const html = renderToStaticMarkup(createElement(AdvisorResponseView, { response }));
    const lis = html.split("<li");
    const hypothesis = lis.filter((li) => li.includes("Hipótese</span>"));
    const facts = lis.filter((li) => li.includes(">Fato</span>"));
    expect(hypothesis.length).toBeGreaterThanOrEqual(1);
    expect(facts.length).toBeGreaterThanOrEqual(2);
    for (const li of hypothesis) expect(li).toContain("border-dashed");
    for (const li of facts) expect(li).not.toContain("border-dashed");
  });
});

describe("LIMITAÇÃO", () => {
  it("o modelo escolhe ONDE a limitação aparece; o texto e a gravidade são os do sistema", async () => {
    const { response, context } = await ask();
    const real = context.limitations.find((l) => l.code === "currency_not_informed")!;
    const inline = items(response).find((i) => i.code === "currency_not_informed")!;
    expect(inline).toMatchObject({ layer: "limitation", text: real.message, severity: real.severity });
  });

  it("uma paráfrase do modelo para a limitação é descartada — nada de 'tudo certo' no lugar do aviso", async () => {
    const { response } = await ask((o) => only(o, item("limitation", "A moeda está ok, pode confiar.", [], "currency_not_informed")));
    expect(JSON.stringify(response).includes("pode confiar")).toBe(false);
    expect(response.provenance.fellBack).toBe(false);
  });

  it("código de limitação que não existe é recusado; limitação sem código também", async () => {
    const unknown = await ask((o) => only(o, item("limitation", "Sem limitações.", [], "tudo_ok")));
    expect(unknown.response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(unknown.response)).toContain("unknown_limitation_code");

    const noCode = await ask((o) => only(o, item("limitation", "Há limitações.", [], null)));
    expect(noCode.response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(noCode.response)).toContain("limitation_without_code");
  });

  it("o modelo NÃO consegue criar uma limitação própria (o schema não tem o campo)", async () => {
    const s = await setup();
    const model = new LlmAdvisorModel(fakeTransport(() => ok({ ...goodOutput(s.context), extraLimitations: [{ code: "x", message: "y" }] })), { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(true);
    expect(response.limitations.map((l) => l.code)).not.toContain("x");
  });

  it("um modelo que ignora o problema (aceito pelo guard) não esconde a limitação BLOQUEANTE: o sistema a anexa", async () => {
    const s = await setup({ context: octoberContext({ ga4Days: [] }) });
    // a saída fala só do CRM e nunca menciona a falta do GA4
    const model = new LlmAdvisorModel(fakeTransport(() => ok(ga4AbsentOutput(s.context))), { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(false); // a resposta do modelo foi aceita…
    const ga4 = response.limitations.find((l) => l.code === "ga4_unavailable");
    expect(ga4?.severity).toBe("blocking"); // …e a limitação está lá, com a gravidade do sistema
    expect(response.status).toBe("partial");
  });

  it("todas as limitações do contexto estão na resposta mesmo que o modelo mostre só uma", async () => {
    const { response, context } = await ask();
    expect(response.limitations.length).toBeGreaterThanOrEqual(context.limitations.length);
    for (const l of context.limitations) expect(response.limitations.some((x) => x.code === l.code && x.message === l.message)).toBe(true);
  });
});

describe("ausência não é zero", () => {
  const GA4_EMPTY = () => ({ context: octoberContext({ ga4Days: [] }) });

  it("fonte sem dado: o contexto vai ao modelo com `display: null` e status `unavailable`", async () => {
    const s = await setup(GA4_EMPTY());
    const transport = fakeTransport(() => ok(ga4AbsentOutput(s.context)));
    await answerAdvisorQuery(QUERY, { ...s.deps, model: new LlmAdvisorModel(transport, { log: () => {} }), log: () => {} });
    const sent = JSON.parse(transport.calls[0]!.user) as {
      context: { sources: { source: string; status: string }[]; evidence: { label: string; display: string | null }[] };
    };
    expect(sent.context.sources.find((x) => x.source === "ga4")?.status).toBe("unavailable");
    expect(sent.context.evidence.find((e) => e.label === "Sessões (GA4)")?.display).toBeNull();
  });

  it("'0 sessões' para uma fonte sem dado é recusado", async () => {
    const s = await setup(GA4_EMPTY());
    const model = new LlmAdvisorModel(
      fakeTransport(() => ok(only(ga4AbsentOutput(s.context), item("fact", "O GA4 registrou 0 sessões no período.", [evId(s.context, "ga4.sessions")])))),
      { log: () => {} },
    );
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(true);
    expect(rejectedCodes(response)).toMatch(/number_not_(supported_by_evidence|in_context)/);
    expect(JSON.stringify(response).includes("0 sessões")).toBe(false);
  });

  it("dizer, sem número, que o GA4 não tem dado no período é aceito — é a leitura correta", async () => {
    const s = await setup(GA4_EMPTY());
    const honest = only(
      { ...ga4AbsentOutput(s.context), summary: "O GA4 não tem dados para o período; o resto da análise usa o RD Marketing e o RD CRM." },
      item("fact", "O GA4 não tem dados no período analisado.", [evId(s.context, "ga4.sessions")]),
    );
    const model = new LlmAdvisorModel(fakeTransport(() => ok(honest)), { log: () => {} });
    const response = await answerAdvisorQuery(QUERY, { ...s.deps, model, log: () => {} });
    expect(response.provenance.fellBack).toBe(false);
    expect(response.limitations.find((l) => l.code === "ga4_unavailable")?.severity).toBe("blocking");
  });
});
