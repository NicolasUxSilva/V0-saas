/**
 * Schema de saída do modelo de linguagem: o JSON do modelo nunca é confiado.
 *
 * Prova: (1) JSON inválido, campos ausentes, campos extras, tipos errados, enums
 * inválidos e tamanhos absurdos viram `invalid_output` — sem repetir o conteúdo
 * recebido; (2) o JSON Schema que o provedor recebe é DERIVADO do mesmo schema Zod e
 * respeita o subconjunto que a saída estruturada aceita; (3) a conversão para o
 * contrato do Advisor devolve as referências REAIS das evidências, o texto das
 * limitações vem do contexto, e o status e os acompanhamentos são do sistema.
 */
import { describe, expect, it } from "vitest";

import { LLM_LAYERS, advisorLlmJsonSchema, advisorLlmOutputSchema, deriveResponseStatus, parseLlmOutput, toModelResponse } from "../llm/schema";
import { projectContextForModel } from "../llm/privacy";
import { AdvisorLlmError } from "../llm/transport";
import { octoberContext } from "./advisor-fixtures";
import { QUERY, evId, goodOutput, item, refOf, setup } from "./advisor-llm-fixtures";

const invalid = (text: string): AdvisorLlmError => {
  try {
    parseLlmOutput(text);
  } catch (error) {
    expect(error).toBeInstanceOf(AdvisorLlmError);
    expect((error as AdvisorLlmError).code).toBe("invalid_output");
    return error as AdvisorLlmError;
  }
  throw new Error("era esperado que o parse falhasse");
};

const GOOD = async () => {
  const { context } = await setup();
  return { context, output: goodOutput(context) };
};

describe("JSON inválido", () => {
  it.each([
    ["vazio", ""],
    ["texto solto", "Aqui está o fechamento: ..."],
    ["JSON cortado (truncado)", '{"title":"Fechamento","summary":"No pe'],
    ["cercado de markdown", '```json\n{"title":"x"}\n```'],
    ["array no lugar do objeto", "[]"],
    ["null", "null"],
    ["número", "42"],
    ["JSON com texto depois", '{"title":"x"} obrigado!'],
  ])("%s → `invalid_output`", (_name, text) => {
    invalid(text);
  });
});

describe("campos ausentes, extras e tipos errados", () => {
  it("um objeto bom é aceito (a linha de base dos testes abaixo)", async () => {
    const { output } = await GOOD();
    expect(() => parseLlmOutput(JSON.stringify(output))).not.toThrow();
  });

  it.each(["title", "summary", "sections", "insightRefs"])("sem `%s` no topo → recusado, com o caminho no detalhe", async (key) => {
    const { output } = await GOOD();
    const broken: Record<string, unknown> = { ...output };
    delete broken[key];
    expect(invalid(JSON.stringify(broken)).debugDetail).toContain(key);
  });

  it.each(["title", "content", "figureIds", "items"])("seção sem `%s` → recusado", async (key) => {
    const { output } = await GOOD();
    const section: Record<string, unknown> = { ...output.sections[0] };
    delete section[key];
    invalid(JSON.stringify({ ...output, sections: [section] }));
  });

  it.each(["layer", "text", "evidenceIds", "limitationCode"])("item sem `%s` → recusado", async (key) => {
    const { output } = await GOOD();
    const broken: Record<string, unknown> = { ...output.sections[0]!.items[0] };
    delete broken[key];
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], items: [broken] }] }));
  });

  it("campos EXTRAS são recusados (o modelo não pode acrescentar `status`, `followUps`, `extraLimitations`…)", async () => {
    const { output } = await GOOD();
    for (const extra of [{ status: "answered" }, { followUps: [] }, { extraLimitations: [] }, { id: "x" }]) {
      invalid(JSON.stringify({ ...output, ...extra }));
    }
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], id: "minha-secao" }] }));
    invalid(
      JSON.stringify({
        ...output,
        sections: [{ ...output.sections[0], items: [{ ...output.sections[0]!.items[0], severity: "info" }] }],
      }),
    );
  });

  it("tipos errados: número no lugar do texto, string no lugar da lista, `null` onde não pode", async () => {
    const { output } = await GOOD();
    invalid(JSON.stringify({ ...output, title: 123 }));
    invalid(JSON.stringify({ ...output, summary: null }));
    invalid(JSON.stringify({ ...output, sections: "nenhuma" }));
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], figureIds: "E1" }] }));
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], items: [{ ...output.sections[0]!.items[0], evidenceIds: [5] }] }] }));
  });

  it("enum inválido: camada que não existe e origem de insight que não existe", async () => {
    const { output } = await GOOD();
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], items: [{ ...output.sections[0]!.items[0], layer: "opinion" }] }] }));
    invalid(JSON.stringify({ ...output, insightRefs: [{ origin: "web", key: "x" }] }));
  });

  it("a caixa de um enum não é garantida pelo provedor: `FACT` vale `fact`; um valor errado de verdade continua recusado", async () => {
    const { output } = await GOOD();
    const shouting = {
      ...output,
      sections: output.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, layer: i.layer.toUpperCase() })) })),
      insightRefs: [{ origin: "CROSS_SOURCE", key: "commercial-activity" }],
    };
    const parsed = parseLlmOutput(JSON.stringify(shouting));
    expect(parsed.sections[0]!.items[0]!.layer).toBe("fact");
    expect(parsed.insightRefs[0]!.origin).toBe("cross_source");
  });

  it("limites: título longo demais, seções demais, nenhuma seção, item de texto vazio fora de `limitation`", async () => {
    const { output } = await GOOD();
    invalid(JSON.stringify({ ...output, title: "x".repeat(161) }));
    invalid(JSON.stringify({ ...output, summary: "" }));
    invalid(JSON.stringify({ ...output, sections: [] }));
    invalid(JSON.stringify({ ...output, sections: Array.from({ length: 9 }, () => output.sections[0]) }));
    invalid(JSON.stringify({ ...output, sections: [{ ...output.sections[0], items: [item("fact", "  ", ["E1"])] }] }));
    // mas texto vazio EM `limitation` é o esperado (o sistema escreve o texto)
    expect(() =>
      parseLlmOutput(JSON.stringify({ ...output, sections: [{ ...output.sections[0], items: [item("limitation", "", [], "currency_not_informed")] }] })),
    ).not.toThrow();
  });

  it("o detalhe do erro só traz CAMINHOS de campo — nunca o valor que o modelo mandou", async () => {
    const { output } = await GOOD();
    const error = invalid(JSON.stringify({ ...output, title: 123, summary: { segredo: "VALOR-SENSIVEL-DO-MODELO" } }));
    expect(error.debugDetail).toContain("title");
    expect(error.debugDetail).not.toContain("VALOR-SENSIVEL-DO-MODELO");
    expect(error.message).toBe("a resposta do modelo não tinha o formato esperado");
  });
});

describe("o JSON Schema que o provedor recebe", () => {
  const schema = advisorLlmJsonSchema();
  type Node = Record<string, unknown>;

  /** Todos os nós de schema (não os nomes de campo dentro de `properties`). */
  function nodes(node: Node, out: Node[] = []): Node[] {
    out.push(node);
    for (const [k, v] of Object.entries(node)) {
      if (k === "properties") for (const sub of Object.values(v as Record<string, Node>)) nodes(sub, out);
      else if (k === "items" && typeof v === "object" && v) nodes(v as Node, out);
      else if ((k === "anyOf" || k === "allOf" || k === "oneOf") && Array.isArray(v)) for (const sub of v) nodes(sub as Node, out);
    }
    return out;
  }
  const all = nodes(schema);

  it("é derivado do schema Zod: os mesmos campos, nos mesmos níveis", () => {
    expect(Object.keys(schema.properties as Node).sort()).toEqual(["insightRefs", "sections", "summary", "title"]);
    const section = ((schema.properties as Node).sections as Node).items as Node;
    expect(Object.keys(section.properties as Node).sort()).toEqual(["content", "figureIds", "items", "title"]);
    const itemNode = ((section.properties as Node).items as Node).items as Node;
    expect(Object.keys(itemNode.properties as Node).sort()).toEqual(["evidenceIds", "layer", "limitationCode", "text"]);
    expect(((itemNode.properties as Node).layer as Node).enum).toEqual([...LLM_LAYERS]);
  });

  it("o campo `title` NÃO é confundido com a palavra-chave `title` (o sanitizador só limpa palavras-chave)", () => {
    expect((schema.properties as Node).title).toEqual({ type: "string" });
  });

  it("todo objeto fecha `additionalProperties: false` e lista TODOS os campos em `required` (exigência da saída estruturada)", () => {
    const objects = all.filter((n) => n.type === "object");
    expect(objects.length).toBe(4); // raiz, seção, item e insightRef
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as Node).sort());
    }
  });

  it("nenhuma palavra-chave que o provedor recusa (400): tamanhos, números, padrões, formatos, `$schema`", () => {
    for (const n of all) {
      for (const k of ["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "pattern", "format", "default"]) {
        expect(n, k).not.toHaveProperty(k);
      }
      if ("minItems" in n) expect(n.minItems as number).toBeLessThanOrEqual(1);
    }
  });

  it("limites de complexidade do provedor: poucas uniões (≤ 16) e nada recursivo", () => {
    expect(all.filter((n) => "anyOf" in n).length).toBeLessThanOrEqual(16);
    expect(JSON.stringify(schema)).not.toMatch(/\$ref/);
  });

  it("os limites de tamanho que saíram do JSON Schema continuam valendo na validação Zod", () => {
    expect(advisorLlmOutputSchema.safeParse({ title: "x".repeat(500), summary: "s", sections: [], insightRefs: [] }).success).toBe(false);
  });
});

describe("conversão para o contrato do Advisor", () => {
  it("ids curtos voltam a ser as referências REAIS das evidências (os ids ficam preservados no output)", async () => {
    const { context, output } = await GOOD();
    const projection = projectContextForModel(context);
    const draft = toModelResponse(output, { context, query: QUERY, aliasToRef: projection.aliasToRef });

    expect(draft.sections[0]!.figureRefs).toEqual([
      refOf(context, "ga4.sessions"),
      refOf(context, "rd_marketing.visits"),
      refOf(context, "rd_marketing.conversions"),
    ]);
    expect(draft.sections[0]!.items[0]!.evidenceRefs).toEqual([refOf(context, "ga4.sessions"), refOf(context, "ga4.days_with_data")]);
    // nenhum id curto escapa para o contrato
    expect(JSON.stringify(draft)).not.toMatch(/"E\d+"/);
  });

  it("id de evidência desconhecido passa como está — e é o guard quem o recusa", async () => {
    const { context, output } = await GOOD();
    const bad = { ...output, sections: [{ ...output.sections[0]!, figureIds: ["E999"], items: [item("fact", "x", ["E999"])] }] };
    const draft = toModelResponse(bad, { context, query: QUERY, aliasToRef: projectContextForModel(context).aliasToRef });
    expect(draft.sections[0]!.figureRefs).toEqual(["E999"]);
    expect(draft.sections[0]!.items[0]!.evidenceRefs).toEqual(["E999"]);
  });

  it("o TEXTO de uma limitação é sempre o do contexto — o que o modelo escreveu no lugar é descartado", async () => {
    const { context, output } = await GOOD();
    const parafraseada = {
      ...output,
      sections: [{ ...output.sections[0]!, items: [item("limitation", "Tudo certo com a moeda, pode confiar.", [], "currency_not_informed")] }],
    };
    const draft = toModelResponse(parafraseada, { context, query: QUERY, aliasToRef: projectContextForModel(context).aliasToRef });
    const real = context.limitations.find((l) => l.code === "currency_not_informed")!;
    expect(draft.sections[0]!.items[0]).toEqual({
      layer: "limitation",
      text: real.message,
      evidenceRefs: real.evidenceRefs,
      code: "currency_not_informed",
      severity: real.severity,
    });
    expect(JSON.stringify(draft)).not.toContain("Tudo certo");
  });

  it("código de limitação inexistente (ou ausente) é mantido como veio — e o guard o recusa", async () => {
    const { context, output } = await GOOD();
    const draft = toModelResponse(
      { ...output, sections: [{ ...output.sections[0]!, items: [item("limitation", "Sem limitações.", [], "tudo_ok"), item("limitation", "x", [], null)] }] },
      { context, query: QUERY, aliasToRef: projectContextForModel(context).aliasToRef },
    );
    expect(draft.sections[0]!.items[0]).toMatchObject({ layer: "limitation", code: "tudo_ok", text: "Sem limitações." });
    expect(draft.sections[0]!.items[1]).not.toHaveProperty("code");
  });

  it("ids de seção, status, acompanhamentos e limitações extras são do SISTEMA, não do modelo", async () => {
    const { context, output } = await GOOD();
    const draft = toModelResponse(output, { context, query: QUERY, aliasToRef: projectContextForModel(context).aliasToRef });
    expect(draft.sections.map((s) => s.id)).toEqual(["llm-1", "llm-2"]);
    expect(draft.status).toBe("answered");
    expect(draft.followUps.length).toBeGreaterThan(0);
    expect(draft.followUps.map((f) => f.intent)).not.toContain("closing_report");
    expect(draft.extraLimitations).toBeUndefined();
  });

  it("o modelo não escolhe o status: ele é derivado do contexto", async () => {
    const full = await setup();
    expect(deriveResponseStatus(full.context, QUERY)).toBe("answered");

    const partial = await setup({ context: octoberContext({ ga4Days: ["2026-10-01", "2026-10-02"] }) });
    expect(deriveResponseStatus(partial.context, QUERY)).toBe("partial");

    const comparisonOk = await setup({ compare: true });
    expect(deriveResponseStatus(comparisonOk.context, { ...QUERY, intent: "comparison" })).toBe("answered");
    expect(deriveResponseStatus(full.context, { ...QUERY, intent: "comparison" })).toBe("not_computable");
  });

  it("sem Cross-source gerado o status é `no_data`", async () => {
    const { buildAdvisorContext } = await import("../context");
    const { createMemoryStore } = await import("@/server/analysis/__tests__/cross-source-store-memory");
    const { OCT_PERIOD, WS, sourcesFrom } = await import("./advisor-fixtures");
    const context = await buildAdvisorContext(WS, OCT_PERIOD, {}, sourcesFrom(createMemoryStore()));
    expect(deriveResponseStatus(context, QUERY)).toBe("no_data");
  });

  it("o mesmo contexto e a mesma saída dão sempre o mesmo rascunho (determinismo)", async () => {
    const { context, output } = await GOOD();
    const aliasToRef = projectContextForModel(context).aliasToRef;
    expect(toModelResponse(output, { context, query: QUERY, aliasToRef })).toEqual(
      toModelResponse(output, { context, query: QUERY, aliasToRef }),
    );
    expect(evId(context, "ga4.sessions")).toBe(evId(context, "ga4.sessions"));
  });
});
