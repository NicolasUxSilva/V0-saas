/**
 * Guard ESTRITO (`validateLlmDraft`): o que se exige de uma resposta que NÃO é a
 * determinística.
 *
 * Além das regras do guard base ("o número existe no contexto", referências reais,
 * moeda), o estrito exige que o número esteja numa evidência CITADA, que hipótese e
 * comparação tenham âncora, que não haja número por extenso fora do contexto nem
 * plataforma que o contexto não menciona, e que nenhuma moeda seja escrita sem uma
 * fonte que a informe. O que NÃO prova — que uma frase sem número seja verdadeira —
 * está no cabeçalho de `guard.ts` e é coberto pelo prompt e pela avaliação do modelo.
 */
import { describe, expect, it } from "vitest";

import { answerDeterministically } from "../deterministic-model";
import { validateAdvisorResponse, validateLlmDraft, validateModelResponse, type GuardViolation } from "../guard";
import { ADVISOR_INTERPRETATION_RULES } from "../llm-contract";
import { projectContextForModel } from "../llm/privacy";
import { parseLlmOutput, toModelResponse, type AdvisorLlmOutput } from "../llm/schema";
import { answerAdvisorQuery } from "../service";
import type { AdvisorContext, AdvisorModelResponse } from "../types";
import { OCT_PERIOD, SEP_PERIOD, WS, diagnosticItem, octoberContext } from "./advisor-fixtures";
import { QUERY, disp, evId, ga4AbsentOutput, goodOutput, item, setup } from "./advisor-llm-fixtures";

type Setup = Awaited<ReturnType<typeof setup>>;

/** Converte a saída (formato do schema) em rascunho e o valida de forma estrita. */
function judge(
  { context }: Pick<Setup, "context">,
  mutate: (output: AdvisorLlmOutput, context: AdvisorContext) => AdvisorLlmOutput = (o) => o,
  query = QUERY,
  build: (context: AdvisorContext) => AdvisorLlmOutput = goodOutput,
) {
  const output = mutate(build(context), context);
  const draft = toModelResponse(output, { context, query, aliasToRef: projectContextForModel(context).aliasToRef });
  return { draft, violations: validateLlmDraft(draft, context) };
}
const codes = (v: GuardViolation[]) => [...new Set(v.map((x) => x.code))].sort();
const firstSection = (o: AdvisorLlmOutput) => o.sections[0]!;
const withItems = (o: AdvisorLlmOutput, ...items: AdvisorLlmOutput["sections"][number]["items"]): AdvisorLlmOutput => ({
  ...o,
  sections: [{ ...firstSection(o), items }, ...o.sections.slice(1)],
});

describe("a linha de base: uma resposta de modelo bom passa", () => {
  it("`goodOutput` — números só dos `display`, tudo citado, limitação pelo código — não tem nenhuma violação", async () => {
    const s = await setup();
    expect(judge(s).violations).toEqual([]);
  });

  it("o determinístico é coerente com a validação estrita nas intenções principais (a calibração das regras)", async () => {
    // se alguma regra estrita ficar mais severa do que o próprio texto do sistema, este teste acusa
    const { context } = await setup({ compare: true });
    for (const intent of ["period_summary", "closing_report", "problems", "diagnostic_explanation", "commercial_analysis", "opportunities"] as const) {
      const draft = answerDeterministically(context, { workspaceId: WS, period: OCT_PERIOD, intent });
      expect(validateLlmDraft(draft, context), intent).toEqual([]);
    }
  });

  it("é um SUPERCONJUNTO do guard base: toda violação do base aparece também na estrita (sem duplicar)", async () => {
    const s = await setup();
    const { draft, violations } = judge(s, (o) => ({ ...o, summary: `${o.summary} Foram 777 leads.` }));
    expect(codes(validateModelResponse(draft, s.context))).toEqual(["number_not_in_context"]);
    // um número que nem existe no contexto é do guard base; a estrita não o repete
    expect(codes(violations)).toEqual(["number_not_in_context"]);
    expect(violations.filter((v) => v.code === "number_not_in_context")).toHaveLength(1);
  });
});

describe("número sem evidência citada (`must.cite_evidence`)", () => {
  it("o número existe no contexto, mas o item não cita a evidência dele → `number_not_supported_by_evidence`", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(o, item("fact", `O RD CRM registrou ${disp(c, "rd_crm.won_deals")} negócios ganhos.`, [evId(c, "ga4.sessions")])),
    );
    expect(codes(violations)).toEqual(["number_not_supported_by_evidence"]);
    expect(violations[0]!.where).toBe("sections[0].items[0]");
  });

  it("citando a evidência certa, o mesmo texto passa", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(o, item("fact", `O RD CRM registrou ${disp(c, "rd_crm.won_deals")} negócios ganhos.`, [evId(c, "rd_crm.won_deals")])),
    );
    expect(violations).toEqual([]);
  });

  it("vale para relação observável, hipótese e comparação — não só para fato", async () => {
    const s = await setup();
    for (const layer of ["observable_relationship", "hypothesis"] as const) {
      const { violations } = judge(s, (o, c) =>
        withItems(o, item(layer, `Isso envolve ${disp(c, "rd_crm.won_deals")} ganhos.`, [evId(c, "ga4.sessions")])),
      );
      expect(codes(violations), layer).toEqual(["number_not_supported_by_evidence"]);
    }
  });

  it("o RESUMO só traz números de evidências citadas em algum lugar da resposta", async () => {
    const s = await setup();
    // a resposta só cita a evidência de sessões, mas o resumo também fala do valor ganho (que existe no contexto)
    const onlySessions = (o: AdvisorLlmOutput, c: AdvisorContext): AdvisorLlmOutput => {
      const sessions = evId(c, "ga4.sessions");
      return {
        ...o,
        summary: `O GA4 registrou ${disp(c, "ga4.sessions")} sessões e o valor ganho foi ${disp(c, "rd_crm.won_value")}.`,
        sections: [{ ...firstSection(o), figureIds: [sessions], items: [item("fact", `O GA4 registrou ${disp(c, "ga4.sessions")} sessões.`, [sessions])] }],
      };
    };
    const { violations } = judge(s, onlySessions);
    const bad = violations.filter((v) => v.code === "number_not_supported_by_evidence");
    expect(bad.map((v) => v.where)).toEqual(["summary"]);
    expect(bad[0]!.detail).toContain(`“${disp(s.context, "rd_crm.won_value")}”`);
    // e o número de sessões, citado, não é acusado
    expect(bad.some((v) => v.detail.includes(`“${disp(s.context, "ga4.sessions")}”`))).toBe(false);
  });

  it("citar a evidência do valor ganho em qualquer ponto da resposta sustenta o resumo", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => {
      const sessions = evId(c, "ga4.sessions");
      const value = evId(c, "rd_crm.won_value");
      return {
        ...o,
        summary: `O GA4 registrou ${disp(c, "ga4.sessions")} sessões e o valor ganho informado foi ${disp(c, "rd_crm.won_value")}.`,
        sections: [{ ...firstSection(o), figureIds: [sessions, value], items: [item("fact", `O GA4 registrou ${disp(c, "ga4.sessions")} sessões.`, [sessions])] }],
      };
    });
    expect(violations).toEqual([]);
  });

  it("números que o SISTEMA escreveu numa frase ligada à evidência citada valem (ex.: '2 landing pages', '19 fechados')", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(
        o,
        item("fact", `O RD Marketing registrou ${disp(c, "rd_marketing.visits")} visitas e ${disp(c, "rd_marketing.conversions")} conversões em 2 landing pages.`, [
          evId(c, "rd_marketing.visits"),
          evId(c, "rd_marketing.conversions"),
        ]),
      ),
    );
    expect(violations).toEqual([]);
  });

  it("mas o mesmo '2' sem ligação com nenhuma evidência citada não vale", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(o, item("fact", "O RD Marketing registrou 2 landing pages.", [evId(c, "ga4.sessions")])),
    );
    expect(codes(violations)).toEqual(["number_not_supported_by_evidence"]);
  });

  it("os dias do período e a cobertura por fonte valem sempre ('4 dias', '4 de 4 dias')", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(o, item("fact", "O período tem 4 dias; o GA4 cobre 4 de 4 dias.", [evId(c, "ga4.sessions")])),
    );
    expect(violations).toEqual([]);
  });
});

describe("número por extenso e aritmética implícita (`must.digits_as_displayed`)", () => {
  it("'cinco negócios ganhos' vale se a evidência de ganhos foi citada — e não vale se não foi", async () => {
    const s = await setup();
    const cited = judge(s, (o, c) => withItems(o, item("fact", "O RD CRM registrou cinco negócios ganhos.", [evId(c, "rd_crm.won_deals")])));
    expect(cited.violations).toEqual([]);
    const uncited = judge(s, (o, c) => withItems(o, item("fact", "O RD CRM registrou cinco negócios ganhos.", [evId(c, "ga4.sessions")])));
    expect(codes(uncited.violations)).toEqual(["number_not_supported_by_evidence"]);
  });

  it("número por extenso que não existe no contexto → `spelled_number` (o guard de dígitos não o veria)", async () => {
    const s = await setup();
    for (const text of ["O RD CRM registrou sete negócios ganhos.", "Foram trinta e cinco visitas.", "Cerca de cem sessões por dia."]) {
      const { violations } = judge(s, (o, c) => withItems(o, item("fact", text, [evId(c, "rd_crm.won_deals")])));
      expect(codes(violations), text).toContain("spelled_number");
    }
  });

  it("magnitudes e contas implícitas ('mil', 'milhões', 'dobrou', 'metade') → `spelled_number`", async () => {
    const s = await setup();
    for (const text of ["Foram mil sessões.", "Houve milhões de visitas.", "As sessões dobraram.", "Só metade dos negócios foi ganha.", "O tráfego triplicou."]) {
      const { violations } = judge(s, (o, c) => withItems(o, item("fact", text, [evId(c, "ga4.sessions")])));
      expect(codes(violations), text).toContain("spelled_number");
    }
  });

  it("uma palavra que o próprio contexto usa é permitida (o sistema também a escreve)", async () => {
    const s = await setup({
      diagnostics: [diagnosticItem({ explanation: "O tráfego do canal dobrou em relação à semana anterior." })],
    });
    const { violations } = judge(s, (o) => withItems(o, item("diagnostic", "O motor registrou que o tráfego do canal dobrou.", [])));
    expect(violations.filter((v) => v.code === "spelled_number")).toEqual([]);
  });

  it("'zero conversões' vale se a evidência de conversões foi citada (o 0 é um fato)", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => withItems(o, item("fact", "O RD Marketing teve zero conversões.", [evId(c, "rd_marketing.conversions")])));
    expect(violations).toEqual([]);
  });

  it("'um' e 'uma' são artigos: nunca acusados", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => withItems(o, item("fact", "Há uma fonte com um registro no período.", [evId(c, "ga4.sessions")])));
    expect(violations).toEqual([]);
  });
});

describe("plataforma que o contexto não menciona (`must_not.unknown_entities`)", () => {
  it.each([
    ["Google Ads", "O principal problema da empresa é o Google Ads."],
    ["facebook", "O FACEBOOK trouxe a maior parte do tráfego."],
    ["instagram", "As sessões vieram do Instagram."],
    ["meta ads", "As campanhas do Meta Ads performaram mal."],
    ["tiktok", "Vale investir em TikTok."],
  ])("%s → `unknown_entity`, no resumo, no título, no texto da seção e nos itens", async (_name, text) => {
    const s = await setup();
    for (const where of ["summary", "title", "content", "item"] as const) {
      const { violations } = judge(s, (o, c) => {
        if (where === "summary") return { ...o, summary: text };
        if (where === "title") return { ...o, title: text };
        if (where === "content") return { ...o, sections: [{ ...firstSection(o), content: text }, ...o.sections.slice(1)] };
        return withItems(o, item("fact", text, [evId(c, "ga4.sessions")]));
      });
      expect(codes(violations), `${where}: ${text}`).toContain("unknown_entity");
    }
  });

  it("a mesma plataforma é permitida quando o contexto a menciona", async () => {
    const s = await setup({ diagnostics: [diagnosticItem({ explanation: "A queda coincide com a pausa de uma campanha no Google Ads." })] });
    const { violations } = judge(s, (o) => ({ ...o, summary: `${o.summary} O motor menciona o Google Ads.` }));
    expect(violations.filter((v) => v.code === "unknown_entity")).toEqual([]);
  });

  it("não acusa os nomes das fontes do produto nem sinônimos comuns (GA4, 'Google Analytics', RD Station)", async () => {
    const s = await setup();
    const { violations } = judge(s, (o) => ({
      ...o,
      summary: `${o.summary} Dados do GA4 (Google Analytics), do RD Station Marketing e do RD Station CRM.`,
    }));
    expect(violations.filter((v) => v.code === "unknown_entity")).toEqual([]);
  });
});

describe("moeda (`must_not.assume_currency`)", () => {
  const flagged = async (text: string, context?: AdvisorContext) => {
    const s = await setup();
    const ctx = context ?? s.context;
    const { violations } = judge({ context: ctx }, (o) => ({ ...o, summary: `${o.summary} ${text}` }));
    return violations.filter((v) => v.code === "currency_assumed").map((v) => v.detail);
  };

  it.each([
    "O valor foi R$ 23.399,00.",
    "O valor foi de 23.399,00 reais.",
    "Os valores estão em reais.",
    "Foram 5 reais por negócio.",
    "O valor está em BRL.",
    "O valor foi US$ 5.",
    "O valor está em USD.",
    "O valor está em dólares.",
    "O valor está em euros.",
    "O valor foi € 5.",
    "O valor foi £ 5.",
    "O valor foi $ 5.",
  ])("recusa: %s", async (text) => {
    expect((await flagged(text)).length).toBeGreaterThan(0);
  });

  it.each([
    "Com base nos dados reais do período.",
    "Os números reais são esses.",
    "Uma situação real, sem reais valores monetários informados.",
  ])("NÃO recusa 'reais' como adjetivo: %s", async (text) => {
    expect(await flagged(text)).toEqual([]);
  });

  it("aceita a moeda que ALGUMA fonte informou — e só ela", async () => {
    const { context } = await setup();
    const withBrl: AdvisorContext = {
      ...context,
      evidence: context.evidence.map((e) => (e.format === "currency" ? { ...e, currency: "BRL" } : e)),
    };
    expect(await flagged("O valor foi R$ 23.399,00.", withBrl)).toEqual([]);
    expect((await flagged("O valor foi US$ 5.", withBrl)).length).toBeGreaterThan(0);
  });
});

describe("conta implícita (`must_not.recalculate`)", () => {
  const claim = async (text: string, metrics: string[] = ["rd_crm.won_value", "rd_crm.won_deals"]) => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => withItems(o, item("fact", text, metrics.map((m) => evId(c, m)))));
    return codes(violations);
  };

  it.each([
    "Os 5 negócios ganhos valem 23.399,00 cada.",
    "Cada negócio ganho vale 23.399,00.",
    "O valor por negócio ganho é 23.399,00.",
    "Foram 487 sessões, em média 121 por dia.",
    "Houve 9 criados, 3 vezes mais que o previsto.",
    "A razão entre ganhos e perdidos é de 5 para 14.",
    "A proporção de 5 ganhos sobre 14 perdidos é baixa.",
  ])("recusa a frase que distribui, divide ou compara por conta própria: %s", async (text) => {
    expect(await claim(text, ["rd_crm.won_value", "rd_crm.won_deals", "rd_crm.lost_deals", "ga4.sessions", "rd_crm.created_deals"])).toContain("derived_calculation");
  });

  it("o erro clássico — número certo na frase errada — é pego pela FRASE, já que todos os números existem e estão citados", async () => {
    // sem a palavra de conta a MESMA frase passa: é exatamente o limite do guard numérico
    expect(await claim("O valor ganho informado é 23.399,00, referente a 1 dos 5 negócios ganhos.", ["rd_crm.won_value", "rd_crm.won_deals", "rd_crm.won_deals_with_value"])).toEqual([]);
    expect(await claim("Os 5 negócios ganhos valem 23.399,00 cada.")).toContain("derived_calculation");
  });

  it("não acusa frases sem número, nem frases sem palavra de conta, nem 'cada' fora de uma conta", async () => {
    expect(await claim("Cada fonte tem a sua própria cobertura de datas.", ["ga4.sessions"])).toEqual([]);
    expect(await claim("O RD CRM registrou 9 negócios criados.", ["rd_crm.created_deals"])).toEqual([]);
  });

  it("uma frase que o PRÓPRIO sistema escreveu (contida num texto do contexto) não é conta por conta própria — reescrita, é", async () => {
    const sentence = "Foram 120 sessões por dia em média no canal Paid Search";
    const s = await setup({ diagnostics: [diagnosticItem({ explanation: `${sentence}.` })] });
    const verbatim = judge(s, (o) => withItems(o, item("diagnostic", `${sentence}.`, [])));
    expect(verbatim.violations.filter((v) => v.code === "derived_calculation")).toEqual([]);
    // a mesma ideia com outras palavras já é uma conta que o contexto não traz
    const rewritten = judge(s, (o) => withItems(o, item("diagnostic", "Em média, o canal Paid Search teve 120 sessões por dia.", [])));
    expect(codes(rewritten.violations)).toContain("derived_calculation");
  });

  it("vale para o resumo e o texto da seção, não só para os itens", async () => {
    const s = await setup();
    for (const where of ["summary", "content"] as const) {
      const { violations } = judge(s, (o) =>
        where === "summary"
          ? { ...o, summary: "Os 5 negócios ganhos valem 23.399,00 cada." }
          : { ...o, sections: [{ ...firstSection(o), content: "Os 5 negócios ganhos valem 23.399,00 cada." }, ...o.sections.slice(1)] },
      );
      expect(codes(violations), where).toContain("derived_calculation");
    }
  });
});

describe("ausência não sustenta número (nunca vira zero)", () => {
  const GA4_EMPTY = () => ({ context: octoberContext({ ga4Days: [] }) });
  // a saída boa de um contexto SEM GA4 só fala do CRM: parte dela e acrescenta o item a testar
  const withExtra = (s: Setup, ...extra: AdvisorLlmOutput["sections"][number]["items"]) =>
    judge(
      s,
      (base) => ({ ...base, sections: [{ ...base.sections[0]!, items: [...base.sections[0]!.items, ...extra] }] }),
      QUERY,
      ga4AbsentOutput,
    );

  it("a linha de base: a saída que só descreve o que existe passa", async () => {
    const s = await setup(GA4_EMPTY());
    expect(withExtra(s).violations).toEqual([]);
  });

  it("'0 sessões' citando só a evidência sem dado → recusado (o '0' existe em outro lugar, mas não sustenta ESTE item)", async () => {
    const s = await setup(GA4_EMPTY());
    const { violations } = withExtra(s, item("fact", "O GA4 registrou 0 sessões no período.", [evId(s.context, "ga4.sessions")]));
    expect(codes(violations)).toEqual(["number_not_supported_by_evidence"]);
  });

  it("qualquer número para uma evidência sem dado é recusado, não só o zero ('5 sessões')", async () => {
    const s = await setup(GA4_EMPTY());
    const { violations } = withExtra(s, item("fact", "O GA4 registrou 5 sessões no período.", [evId(s.context, "ga4.sessions")]));
    expect(codes(violations)).toEqual(["number_not_supported_by_evidence"]);
  });

  it("dizer, sem número, que não há dado é a leitura correta e passa", async () => {
    const s = await setup(GA4_EMPTY());
    const { violations } = withExtra(s, item("fact", "O GA4 não tem dados no período analisado.", [evId(s.context, "ga4.sessions")]));
    expect(violations).toEqual([]);
  });

  it("evidência ausente NÃO liga as frases do sistema: o '487' de uma frase que cita a evidência de sessões não sustenta um item que cita só a sessão nula", async () => {
    const s = await setup();
    // as frases do contexto ("GA4: 487 sessões…") continuam citando a evidência de sessões, mas agora ela é nula
    const nullSessions: AdvisorContext = {
      ...s.context,
      evidence: s.context.evidence.map((e) =>
        e.ref.startsWith("ga4.sessions@") ? { ...e, value: null, display: null } : e,
      ),
    };
    const sessionsId = evId(nullSessions, "ga4.sessions");
    const { violations } = judge(
      { context: nullSessions },
      (o) => ({
        ...o,
        summary: "O GA4 está sem dado de sessões no período.",
        sections: [{ ...o.sections[0]!, figureIds: [], items: [item("fact", "O GA4 registrou 487 sessões no período.", [sessionsId])] }],
      }),
      QUERY,
      (c) => ({ ...goodOutput({ ...c, evidence: s.context.evidence }), title: "t" }),
    );
    // o número "487" EXISTE no contexto (nas frases), mas nada com dado o sustenta
    expect(codes(violations)).toContain("number_not_supported_by_evidence");
    expect(violations.some((v) => v.detail.includes("“487”"))).toBe(true);
  });

  it("a cobertura ('0 de 4 dias') é uma evidência e precisa ser citada — não vale como número solto", async () => {
    const s = await setup(GA4_EMPTY());
    const uncited = withExtra(s, item("fact", "O GA4 tem 0 de 4 dias com dados.", [evId(s.context, "ga4.sessions")]));
    expect(codes(uncited.violations)).toEqual(["number_not_supported_by_evidence"]);
    const cited = withExtra(s, item("fact", "O GA4 tem 0 de 4 dias com dados.", [evId(s.context, "ga4.days_with_data")]));
    expect(cited.violations).toEqual([]);
  });
});

describe("hipótese sem âncora (`must_not.unanchored_hypothesis`)", () => {
  it("hipótese própria sem evidência → `hypothesis_without_evidence`", async () => {
    const s = await setup();
    const { violations } = judge(s, (o) => withItems(o, item("hypothesis", "Talvez o público seja outro.", [])));
    expect(codes(violations)).toEqual(["hypothesis_without_evidence"]);
  });

  it("com as evidências sobre as quais é levantada, passa", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => withItems(o, item("hypothesis", "Talvez o público seja outro.", [evId(c, "ga4.sessions")])));
    expect(violations).toEqual([]);
  });

  it("hipótese que o PRÓPRIO contexto traz (as do motor não têm evidência) pode ser repetida palavra por palavra", async () => {
    const s = await setup();
    const own = s.context.hypotheses.find((h) => h.evidenceRefs.length === 0);
    expect(own).toBeDefined();
    const { violations } = judge(s, (o) => withItems(o, item("hypothesis", own!.text, [])));
    expect(violations).toEqual([]);
    // reescrita de uma hipótese do contexto sem evidência já é hipótese própria
    const rewritten = judge(s, (o) => withItems(o, item("hypothesis", `${own!.text} E mais.`, [])));
    expect(codes(rewritten.violations)).toEqual(["hypothesis_without_evidence"]);
  });
});

describe("comparação (`must_not.comparison_without_data`)", () => {
  it("sem comparação calculada no contexto, a camada `comparison` é recusada", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) =>
      withItems(o, item("comparison", "As sessões subiram em relação a setembro.", [evId(c, "ga4.sessions")])),
    );
    expect(codes(violations)).toContain("comparison_not_computed");
  });

  it("com comparação calculada, um item que cita as evidências e usa os valores prontos passa", async () => {
    const s = await setup({ compare: true });
    const cmp = s.context.comparison!;
    expect(cmp.status).toBe("computed");
    const sessions = cmp.items.find((i) => i.metricId === "ga4.sessions")!;
    const aliasOf = (ref: string) => [...projectContextForModel(s.context).aliasToRef].find(([, r]) => r === ref)![0];
    const { violations } = judge(
      s,
      (o) =>
        withItems(
          o,
          item(
            "comparison",
            `As sessões do GA4 foram de ${sessions.baselineDisplay} para ${sessions.currentDisplay} (${sessions.deltaDisplay}${sessions.deltaPctDisplay ? `, ${sessions.deltaPctDisplay}` : ""}).`,
            [aliasOf(sessions.currentRef), aliasOf(sessions.baselineRef)],
          ),
        ),
      { ...QUERY, intent: "comparison", comparePeriod: SEP_PERIOD },
    );
    expect(violations).toEqual([]);
  });

  it("item de comparação sem evidência citada → `fact_without_evidence`", async () => {
    const s = await setup({ compare: true });
    const { violations } = judge(s, (o) => withItems(o, item("comparison", "Houve variação.", [])));
    expect(codes(violations)).toContain("fact_without_evidence");
  });

  it("a variação calculada pelo modelo (que não está nos itens) é um número fora do contexto", async () => {
    const s = await setup({ compare: true });
    const { violations } = judge(s, (o, c) => withItems(o, item("comparison", "As sessões subiram 99,9%.", [evId(c, "ga4.sessions")])), {
      ...QUERY,
      intent: "comparison",
      comparePeriod: SEP_PERIOD,
    });
    expect(codes(violations)).toContain("number_not_in_context");
  });
});

describe("resposta vazia", () => {
  it("seções sem nenhum item → `empty_response`", async () => {
    const s = await setup();
    const { violations } = judge(s, (o) => ({ ...o, sections: [{ ...firstSection(o), items: [] }] }));
    expect(codes(violations)).toContain("empty_response");
  });
});

describe("cada regra aplicada pelo guard tem uma violação provada", () => {
  type Case = {
    /** como provocar a violação */
    violate: (s: Setup) => Promise<GuardViolation[]> | GuardViolation[];
    expected: string;
  };
  const viaDraft =
    (mutate: (o: AdvisorLlmOutput, c: AdvisorContext) => AdvisorLlmOutput) => async (s: Setup) =>
      judge(s, mutate).violations;

  const CASES: Record<string, Case> = {
    "must_not.recalculate": {
      violate: viaDraft((o) => ({ ...o, summary: `${o.summary} A variação foi de 12,5%.` })),
      expected: "number_not_in_context",
    },
    "must_not.invent": {
      violate: viaDraft((o) => withItems(o, item("fact", "x", ["E999"]))),
      expected: "unknown_evidence_ref",
    },
    "must_not.create_evidence": {
      violate: viaDraft((o) => withItems(o, item("fact", "O site vai bem.", []))),
      expected: "fact_without_evidence",
    },
    "must_not.assume_currency": {
      violate: viaDraft((o) => ({ ...o, summary: "O valor ganho foi R$ 23.399,00." })),
      expected: "currency_assumed",
    },
    "must_not.drop_limitations": {
      violate: async (s) => {
        const response = await answerAdvisorQuery(QUERY, s.deps);
        return validateAdvisorResponse(
          { ...response, limitations: response.limitations.filter((l) => l.code !== "currency_not_informed") },
          s.context,
        );
      },
      expected: "limitation_dropped",
    },
    "must_not.unknown_entities": {
      violate: viaDraft((o) => ({ ...o, summary: "O problema é o Google Ads." })),
      expected: "unknown_entity",
    },
    "must_not.unanchored_hypothesis": {
      violate: viaDraft((o) => withItems(o, item("hypothesis", "Talvez.", []))),
      expected: "hypothesis_without_evidence",
    },
    "must_not.comparison_without_data": {
      violate: viaDraft((o, c) => withItems(o, item("comparison", "Subiu.", [evId(c, "ga4.sessions")]))),
      expected: "comparison_not_computed",
    },
    "must.digits_as_displayed": {
      violate: viaDraft((o, c) => withItems(o, item("fact", "Foram sete ganhos.", [evId(c, "rd_crm.won_deals")]))),
      expected: "spelled_number",
    },
    "must.cite_evidence": {
      violate: viaDraft((o, c) => withItems(o, item("fact", `Foram ${disp(c, "rd_crm.won_deals")} ganhos.`, [evId(c, "ga4.sessions")]))),
      expected: "number_not_supported_by_evidence",
    },
    "must.structured_output": {
      // o schema Zod é a regra: JSON inválido nunca chega ao guard
      violate: () => {
        try {
          parseLlmOutput("não é JSON");
        } catch (error) {
          return [{ code: (error as { code: string }).code as never, where: "schema", detail: "" }];
        }
        return [];
      },
      expected: "invalid_output",
    },
  };

  it.each(Object.entries(CASES))("%s", async (_rule, c) => {
    const s = await setup();
    const violations = await c.violate(s);
    expect(violations.map((v) => v.code as string)).toContain(c.expected);
  });

  it("a tabela cobre EXATAMENTE as regras marcadas como `enforced` (uma regra nova sem teste quebra aqui)", () => {
    const enforced = ADVISOR_INTERPRETATION_RULES.filter((r) => r.enforced).map((r) => r.id);
    expect(Object.keys(CASES).sort()).toEqual(enforced.sort());
  });
});

describe("rascunho completo de modelo que mente em tudo ao mesmo tempo", () => {
  it("todos os motivos aparecem, e nenhum deles some por causa de outro", async () => {
    const s = await setup();
    const { violations } = judge(s, (o, c) => ({
      ...o,
      summary: "O Google Ads gerou R$ 99.999,00 em 01/01/2026 com mil leads.",
      sections: [
        {
          ...firstSection(o),
          figureIds: ["E999"],
          items: [
            item("fact", "Sem evidência.", []),
            item("hypothesis", "Talvez.", []),
            item("limitation", "", [], "tudo_ok"),
            item("comparison", "Subiu.", [evId(c, "ga4.sessions")]),
          ],
        },
      ],
      insightRefs: [{ origin: "diagnostics", key: "inventado" }],
    }));
    const got = codes(violations);
    for (const code of [
      "number_not_in_context",
      "date_not_in_context",
      "currency_assumed",
      "unknown_entity",
      "spelled_number",
      "unknown_evidence_ref",
      "fact_without_evidence",
      "hypothesis_without_evidence",
      "unknown_limitation_code",
      "comparison_not_computed",
      "unknown_insight_ref",
    ]) {
      expect(got, code).toContain(code);
    }
  });
});

describe("tipos", () => {
  it("`validateLlmDraft` aceita o rascunho que o modelo de linguagem produz", async () => {
    const s = await setup();
    const { draft } = judge(s);
    const typed: AdvisorModelResponse = draft;
    expect(validateLlmDraft(typed, s.context)).toEqual([]);
  });
});
