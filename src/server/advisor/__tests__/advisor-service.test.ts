/**
 * AdvisorService — as intenções do produto respondidas de forma determinística,
 * sobre o Cross-source e o diagnóstico (sem LLM). Cada resposta é estruturada,
 * fundamentada em evidência, com as limitações preservadas.
 */
import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";

import { buildAdvisorContext } from "../context";
import { validateAdvisorResponse } from "../guard";
import { ADVISOR_INTENTS, INTENT_LABEL, type AdvisorIntent } from "../intents";
import { AdvisorQueryError } from "../query";
import { answerAdvisorQuery } from "../service";
import type { AdvisorContext, AdvisorDiagnosticItem, AdvisorResponse } from "../types";
import {
  OCT,
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  makeRdCrm,
  octoberContext,
  octoberCrmRows,
  persist,
  septemberContext,
  sourcesFrom,
  trafficDropItem,
} from "./advisor-fixtures";

interface Run {
  response: AdvisorResponse;
  context: AdvisorContext;
}

async function ask(
  intent: AdvisorIntent,
  opts: {
    ctx?: ReturnType<typeof octoberContext>;
    diagnostics?: AdvisorDiagnosticItem[];
    withSeptember?: boolean;
    memory?: ReturnType<typeof createMemoryStore>;
    comparePeriod?: typeof SEP_PERIOD;
    period?: typeof OCT_PERIOD;
    question?: string;
  } = {},
): Promise<Run> {
  const memory = opts.memory ?? (await persist(opts.ctx ?? octoberContext(), OCT_PERIOD));
  if (opts.withSeptember) await persist(septemberContext(), SEP_PERIOD, memory);
  const deps = sourcesFrom(memory, opts.diagnostics ?? [diagnosticItem()]);
  const period = opts.period ?? OCT_PERIOD;
  const comparePeriod = opts.comparePeriod ?? (intent === "comparison" ? SEP_PERIOD : undefined);
  const response = await answerAdvisorQuery(
    {
      workspaceId: WS,
      period,
      ...(comparePeriod ? { comparePeriod } : {}),
      intent,
      ...(intent === "free_question" ? { question: opts.question ?? "Qual foi o CAC de outubro?" } : {}),
    },
    deps,
  );
  const context = await buildAdvisorContext(WS, period, { comparePeriod }, deps);
  return { response, context };
}

const ids = (r: AdvisorResponse) => r.sections.map((s) => s.id);
const section = (r: AdvisorResponse, id: string) => r.sections.find((s) => s.id === id);
const figureDisplays = (r: AdvisorResponse, id: string) => section(r, id)?.figures.map((f) => f.display);
const allText = (r: AdvisorResponse) =>
  [r.title, r.summary, ...r.sections.flatMap((s) => [s.title, s.content, ...s.items.map((i) => i.text)])].join("\n");
const layers = (r: AdvisorResponse, id: string) => section(r, id)?.items.map((i) => i.layer) ?? [];

describe("contrato comum a todas as intenções", () => {
  for (const intent of ADVISOR_INTENTS) {
    it(`${intent}: resposta estruturada, fundamentada e validada`, async () => {
      const { response, context } = await ask(intent, { withSeptember: intent === "comparison" });

      expect(response.schemaVersion).toBe(1);
      expect(response.intent).toBe(intent);
      expect(response.title.trim()).not.toBe("");
      expect(response.summary.trim()).not.toBe("");
      expect(response.period).toEqual({ startDate: "2026-10-01", endDate: "2026-10-04", days: 4 });
      expect(response.provenance).toMatchObject({
        producer: "deterministic",
        contextSchemaVersion: 1,
        contextGeneratedAt: context.generatedAt,
        fellBack: false,
        crossSource: { status: "generated", generatedAt: "2026-10-04T20:10:55.505Z" },
        diagnostics: { status: "available", alignedWithPeriod: false },
      });

      // a resposta é autocontida: toda evidência citada em qualquer lugar existe em `evidence`
      const known = new Set(response.evidence.map((e) => e.ref));
      for (const s of response.sections) {
        for (const f of s.figures) expect(known.has(f.ref), f.ref).toBe(true);
        for (const i of s.items) for (const ref of i.evidenceRefs) expect(known.has(ref), ref).toBe(true);
      }
      for (const l of response.limitations) for (const ref of l.evidenceRefs) expect(known.has(ref), ref).toBe(true);

      // nenhuma limitação do contexto é perdida
      const present = new Set(response.limitations.map((l) => `${l.code}\u0000${l.message}`));
      for (const l of context.limitations) expect(present.has(`${l.code}\u0000${l.message}`), l.code).toBe(true);

      // o guard (números ∈ contexto, evidência, camadas) não acha nada
      expect(validateAdvisorResponse(response, context)).toEqual([]);

      // JSON puro: atravessa a fronteira do server action sem conversão
      expect(JSON.parse(JSON.stringify(response))).toEqual(response);

      // acompanhamentos são intenções reais, com o rótulo do produto, e não incluem a própria
      expect(response.followUps.length).toBeGreaterThan(0);
      for (const f of response.followUps) {
        expect(ADVISOR_INTENTS).toContain(f.intent);
        expect(f.label).toBe(INTENT_LABEL[f.intent]);
        if (intent !== "free_question") expect(f.intent).not.toBe(intent);
      }
    });
  }
});

describe("1 · Resumo do período (period_summary)", () => {
  it("devolve, de forma executiva, os dados disponíveis — com a ressalva do valor e da moeda", async () => {
    const { response } = await ask("period_summary");
    expect(response.status).toBe("answered");
    expect(response.title).toBe("Resumo do período 01/10/2026 a 04/10/2026");
    expect(response.summary).toBe(
      "Período 01/10/2026 a 04/10/2026 (4 dias). " +
        "GA4: 487 sessões em 4 de 4 dias; " +
        "RD Marketing: 6 visitas e 0 conversões em 4 de 4 dias; " +
        "RD CRM: 9 negócios criados, 5 ganhos e 14 perdidos; " +
        "valor dos ganhos 23.399,00 (soma de 1 de 5 ganhos com valor registrado; moeda não informada pelo CRM).",
    );
    expect(ids(response)).toEqual(["coverage", "acquisition", "commercial", "values"]);
  });

  it("as figuras são os números do contexto, por fonte", async () => {
    const { response } = await ask("period_summary");
    // dias do GA4 · dias distintos no histórico do GA4 (a fixture só tem estes 4) · dias do RD Marketing · funis do CRM (a fixture tem 1)
    expect(figureDisplays(response, "coverage")).toEqual(["4", "4", "4", "1"]);
    expect(figureDisplays(response, "acquisition")).toEqual(["487", "0", "6", "0"]);
    expect(section(response, "commercial")?.figures.map((f) => [f.metric, f.display])).toEqual([
      ["created_deals", "9"],
      ["won_deals", "5"],
      ["lost_deals", "14"],
      ["created_still_open_deals", "9"],
      ["win_rate", "26,3%"],
      // `pipelines` só existe com 2+ funis (a fixture tem 1; o piloto real tem 2)
    ]);
    expect(section(response, "values")?.figures.map((f) => [f.metric, f.display, f.currency])).toEqual([
      ["won_value", "23.399,00", null],
      ["won_deals_with_value", "1", undefined],
      ["average_ticket", "23.399,00", null],
    ]);
  });

  it("o texto dos fatos é o do Cross-source, sem reescrita (inclusive os 2 landing pages)", async () => {
    const { response, context } = await ask("period_summary");
    const factTexts = new Set(context.facts.map((f) => f.text));
    for (const s of response.sections) {
      for (const i of s.items.filter((x) => x.layer === "fact")) expect(factTexts.has(i.text)).toBe(true);
    }
    expect(allText(response)).toContain("6 visitas e 0 conversões em 2 ativos de conversão (landing pages)");
  });

  it("limitações relevantes aparecem junto de cada número, e cada uma só uma vez", async () => {
    const { response } = await ask("period_summary");
    const limitationItems = response.sections.flatMap((s) => s.items.filter((i) => i.layer === "limitation"));
    const codes = limitationItems.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(layers(response, "values")).toEqual(["fact", "fact", "limitation", "limitation"]);
    expect(section(response, "values")?.items.find((i) => i.code === "currency_not_informed")?.severity).toBe("warning");
  });

  it("fontes ausentes aparecem como ausentes — nunca como zero", async () => {
    const { response } = await ask("period_summary", {
      ctx: octoberContext({ rdMarketing: null, rdCrm: null }),
    });
    expect(response.status).toBe("partial");
    expect(response.summary).toContain("RD Marketing: sem dados no período");
    expect(response.summary).toContain("RD CRM: sem negócios criados ou fechados no período");
    expect(response.summary).not.toMatch(/0 visitas|0 negócios/);
    expect(response.sections.flatMap((s) => s.figures).some((f) => f.source === "rd_crm" && f.metric === "created_deals")).toBe(false);
  });

  it("GA4 sem linha nenhuma: 'ausência de dado, não zero sessões' e a figura é `null`", async () => {
    const { response } = await ask("period_summary", { ctx: octoberContext({ ga4Days: [] }) });
    expect(response.status).toBe("partial");
    expect(response.summary).toContain("GA4: sem dados no período (ausência de dado, não zero sessões)");
    const sessions = section(response, "acquisition")?.figures.find((f) => f.metric === "sessions");
    expect(sessions?.value).toBeNull();
    expect(sessions?.display).toBeNull();
    expect(response.limitations.find((l) => l.code === "ga4_unavailable")?.severity).toBe("blocking");
  });
});

describe("2 · Fechamento (closing_report)", () => {
  it("organiza aquisição, comercial, ganhos/perdas, valores, cobertura, problemas, limitações e observações", async () => {
    const { response } = await ask("closing_report");
    expect(response.status).toBe("answered");
    expect(response.title).toBe("Fechamento do período 01/10/2026 a 04/10/2026");
    expect(ids(response)).toEqual([
      "coverage",
      "acquisition",
      "commercial",
      "values",
      "attribution",
      "diagnostics",
      "relationships",
      "hypotheses",
      "populations",
      "metrics",
    ]);
  });

  it("hipóteses ficam numa seção própria, todas marcadas como hipótese — e só elas", async () => {
    const { response, context } = await ask("closing_report");
    const items = section(response, "hypotheses")!.items;
    expect(items.every((i) => i.layer === "hypothesis")).toBe(true);
    expect(items.map((i) => i.text)).toEqual(expect.arrayContaining(context.hypotheses.map((h) => h.text)));
    // nenhuma hipótese aparece como fato em nenhuma outra seção
    const hypothesisTexts = new Set(context.hypotheses.map((h) => h.text));
    for (const s of response.sections.filter((x) => x.id !== "hypotheses")) {
      for (const i of s.items) expect(hypothesisTexts.has(i.text), i.text).toBe(false);
    }
  });

  it("o diagnóstico do motor vem com a janela dele e a limitação de janela diferente", async () => {
    const { response } = await ask("closing_report");
    const diagnostics = section(response, "diagnostics")!;
    expect(diagnostics.content).toContain("Janela analisada pelo motor: 05/09/2026 a 02/10/2026");
    expect(diagnostics.items.map((i) => i.layer)).toEqual(["diagnostic", "diagnostic", "limitation"]);
    expect(diagnostics.items[0]?.text).toContain("Sem dados de conversão (nenhum key event no período)");
    expect(diagnostics.items.at(-1)?.code).toBe("diagnostics_period_differs");
  });

  it("o que não é calculável está dito: valor perdido, CAC, ROAS, atribuição, taxas entre fontes", async () => {
    const { response } = await ask("closing_report");
    const codes = response.limitations.map((l) => l.code);
    for (const code of [
      "metric_not_computable:lost_value",
      "not_computed:cac",
      "not_computed:roas",
      "not_computed:sales_attribution",
      "not_computed:ga4_to_rd_rate",
      "attribution_not_supported",
    ]) {
      expect(codes, code).toContain(code);
    }
    const lostValue = section(response, "metrics")!.figures.find((f) => f.metric === "lost_value");
    expect(lostValue?.value).toBeNull(); // valor perdido não calculável é `null`, nunca 0
  });

  it("cada evidência e cada limitação aparece uma vez — sem repetir entre seções", async () => {
    const { response } = await ask("closing_report");
    const refs = response.sections.flatMap((s) => s.figures.map((f) => f.ref));
    expect(new Set(refs).size).toBe(refs.length);
    const shown = response.sections.flatMap((s) => s.items.filter((i) => i.layer === "limitation").map((i) => `${i.code}|${i.text}`));
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("insights usados: o do diagnóstico e os tipos do Cross-source que aparecem nas seções", async () => {
    const { response } = await ask("closing_report");
    const keys = response.insights.map((i) => `${i.origin}:${i.key}`);
    expect(keys).toContain("diagnostics:data-quality:no_key_events");
    expect(keys).toContain("cross_source:commercial-activity");
    expect(response.insights.find((i) => i.origin === "diagnostics")).toMatchObject({
      title: "Sem dados de conversão (nenhum key event no período)",
      kind: "data_quality",
      severity: "attention",
    });
  });
});

describe("3 · Problemas (problems)", () => {
  it("usa os insights determinísticos existentes e as limitações que pedem atenção", async () => {
    const { response } = await ask("problems", { diagnostics: [diagnosticItem(), trafficDropItem()] });
    expect(ids(response)).toEqual(["diagnostics", "attention"]);
    const text = allText(response);
    expect(text).toContain("Problema crítico — Sessões de Paid Search caíram ~16%");
    expect(text).toContain("Qualidade dos dados — Sem dados de conversão");
    // a ação sugerida é a do motor, atribuída a ele
    expect(text).toContain("Ação sugerida pelo motor: Revisar as campanhas de Paid Search.");
    // atenção: só bloqueantes e avisos — definições (info) ficam fora desta seção
    const attention = section(response, "attention")!;
    expect(attention.items.every((i) => i.layer === "limitation" && i.severity !== "info")).toBe(true);
    expect(attention.items.map((i) => i.code)).toContain("won_value_partial");
  });

  it("oportunidades do motor não são 'problemas'", async () => {
    const opportunity = diagnosticItem({
      dedupeKey: "x:opp",
      kind: "opportunity",
      title: "Canal Organic cresceu",
      explanation: "O canal Organic Search cresceu.",
    });
    const { response } = await ask("problems", { diagnostics: [opportunity] });
    expect(allText(response)).not.toContain("Canal Organic cresceu");
    expect(section(response, "diagnostics")?.items.some((i) => i.layer === "diagnostic")).toBe(false);
  });

  it("sem insight do motor: não afirma 'sem problemas' — diz que isso não prova nada", async () => {
    const { response } = await ask("problems", { diagnostics: [] });
    expect(response.summary).toContain("não tem problemas abertos ou reconhecidos");
    expect(response.summary).toContain("Isso não prova que não há problemas");
    expect(section(response, "diagnostics")?.content).toContain("não tem insights abertos ou reconhecidos");
  });

  it("funciona sem Cross-source: o diagnóstico independe dele", async () => {
    const { response } = await ask("problems", { memory: createMemoryStore() });
    expect(response.status).toBe("answered");
    expect(allText(response)).toContain("Qualidade dos dados — Sem dados de conversão");
    expect(response.limitations.find((l) => l.code === "cross_source_not_generated")?.severity).toBe("blocking");
  });
});

describe("4 · Diagnóstico (diagnostic_explanation)", () => {
  it("explica só o que os dados e os insights sustentam, sem causa nem hipótese", async () => {
    const { response } = await ask("diagnostic_explanation");
    expect(ids(response)).toEqual([
      "coverage",
      "acquisition",
      "commercial",
      "diagnostics",
      "relationships",
      "cannot_claim",
    ]);
    expect(response.summary).toContain("nenhuma causa é afirmada");
    // nenhuma hipótese nesta resposta
    expect(response.sections.flatMap((s) => s.items).some((i) => i.layer === "hypothesis")).toBe(false);
    // o que os dados NÃO permitem afirmar vem com os códigos estáveis
    const cannot = section(response, "cannot_claim")!.items.map((i) => i.code);
    expect(cannot).toEqual(expect.arrayContaining(["attribution_not_supported", "no_origin_mapping", "not_computed:cac"]));
  });

  it("a relação entre as fontes é só coexistência — e vem com a limitação que diz isso", async () => {
    const { response } = await ask("diagnostic_explanation");
    const rel = section(response, "relationships")!;
    expect(rel.items.map((i) => [i.layer, i.code])).toEqual([
      ["observable_relationship", undefined],
      ["limitation", "coexistence_only"],
    ]);
  });
});

describe("acquisition_analysis e commercial_analysis", () => {
  it("aquisição: GA4 e RD Marketing lado a lado, sem CRM e sem taxa conjunta", async () => {
    const { response } = await ask("acquisition_analysis");
    expect(ids(response)).toEqual(["coverage", "acquisition", "populations"]);
    expect(response.title).toBe("Aquisição no período 01/10/2026 a 04/10/2026");
    expect(section(response, "acquisition")!.figures.every((f) => f.source !== "rd_crm")).toBe(true);
    expect(response.limitations.map((l) => l.code)).toContain("no_joint_rate");
    expect(section(response, "acquisition")!.items.map((i) => i.code)).toEqual(
      expect.arrayContaining(["no_joint_rate", "rd_marketing_scope", "rd_marketing_no_conversions"]),
    );
  });

  it("comercial: negócios, valores e origem — sem GA4, e dizendo que atribuição não é suportada", async () => {
    const { response } = await ask("commercial_analysis");
    expect(ids(response)).toEqual(["coverage", "commercial", "values", "attribution", "populations", "metrics"]);
    expect(response.sections.flatMap((s) => s.figures).filter((f) => f.source === "ga4" && f.metric === "sessions")).toEqual([]);
    const attribution = section(response, "attribution")!;
    expect(attribution.figures.map((f) => [f.metric, f.display])).toEqual(
      expect.arrayContaining([
        ["created_campaign_id_coverage", "0,0%"],
        ["created_source_id_coverage", "88,9%"], // 8 dos 9 criados têm source_id nesta fixture
        ["won_source_id_coverage", "100,0%"],
        ["created_distinct_source_ids", "3"],
      ]),
    );
    expect(attribution.items.map((i) => i.code)).toEqual(
      expect.arrayContaining(["campaign_id_insufficient", "no_origin_mapping", "attribution_not_supported"]),
    );
  });

  it("CRM com histórico importado parcial: a limitação aparece e o status vira parcial", async () => {
    const ctx = octoberContext({ rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-10-03") });
    const { response } = await ask("commercial_analysis", { ctx });
    expect(response.status).toBe("partial");
    const all = response.sections.flatMap((s) => s.items.map((i) => i.code));
    expect(all.filter((c) => c === "rd_crm_partial_imported_history")).toHaveLength(1);
  });
});

describe("opportunities", () => {
  it("só hipóteses e oportunidades, marcadas como tal; as do motor vêm com a limitação de janela", async () => {
    const { response } = await ask("opportunities");
    expect(ids(response)).toEqual(["hypotheses"]);
    const items = section(response, "hypotheses")!.items;
    expect(items.filter((i) => i.layer === "hypothesis").length).toBeGreaterThanOrEqual(3);
    expect(items.at(-1)).toMatchObject({ layer: "limitation", code: "diagnostics_period_differs" });
    expect(response.insights.map((i) => i.key)).toContain("data-quality:no_key_events");
    expect(response.summary).toContain("não conclusões");
  });

  it("oportunidade do motor entra numa seção própria", async () => {
    const opportunity = diagnosticItem({ dedupeKey: "x:opp", kind: "opportunity", title: "Canal Organic cresceu", explanation: "Organic Search cresceu." });
    const { response } = await ask("opportunities", { diagnostics: [opportunity] });
    expect(ids(response)).toEqual(["diagnostics", "hypotheses"]);
    expect(section(response, "diagnostics")?.title).toBe("Oportunidades do diagnóstico");
    expect(allText(response)).toContain("Oportunidade — Canal Organic cresceu");
  });

  it("sem hipótese nem oportunidade: diz isso, não inventa", async () => {
    const empty = octoberContext({ rdCrm: null, rdMarketing: null });
    const { response } = await ask("opportunities", { ctx: empty, diagnostics: [] });
    expect(response.sections.flatMap((s) => s.items).some((i) => i.layer === "hypothesis")).toBe(false);
    expect(response.summary).toContain("Nada foi inventado");
  });
});

describe("5 · Comparação (comparison)", () => {
  it("computável: variações calculadas pelo sistema, com as duas evidências", async () => {
    const { response } = await ask("comparison", { withSeptember: true });
    expect(response.status).toBe("answered");
    expect(response.title).toBe("Comparação entre 01/10/2026 a 04/10/2026 e 27/09/2026 a 30/09/2026");
    expect(response.comparePeriod).toEqual({ startDate: "2026-09-27", endDate: "2026-09-30", days: 4 });
    expect(response.comparison?.status).toBe("computed");
    expect(ids(response)).toEqual(["comparison", "comparison_skipped"]);

    const sessions = section(response, "comparison")!.items.find((i) => i.text.startsWith("Sessões (GA4)"))!;
    expect(sessions.layer).toBe("comparison");
    expect(sessions.text).toBe(
      "Sessões (GA4): 487 em 01/10/2026 a 04/10/2026 e 410 em 27/09/2026 a 30/09/2026 (+77, +18,8%).",
    );
    // base zero: o texto diz que a variação % não é calculável
    expect(allText(response)).toContain("variação percentual não calculável, a base é zero");
    // as evidências dos dois períodos estão na resposta
    const refs = new Set(response.evidence.map((e) => e.ref));
    for (const i of response.comparison!.items) {
      expect(refs.has(i.currentRef)).toBe(true);
      expect(refs.has(i.baselineRef)).toBe(true);
    }
  });

  it("não computável: 'não computável', com o motivo — e nenhuma variação", async () => {
    const { response } = await ask("comparison"); // setembro nunca foi gerado
    expect(response.status).toBe("not_computable");
    expect(response.title).toContain("Comparação não computável");
    expect(response.comparison?.status).toBe("not_computable");
    expect(response.comparison?.items).toEqual([]);
    expect(ids(response)).toEqual(["comparison_reasons"]);
    expect(section(response, "comparison_reasons")!.items.map((i) => i.code)).toEqual([
      "comparison_not_computable:baseline_cross_source_missing",
    ]);
    expect(response.limitations.map((l) => l.code)).toContain("comparison_not_computable:baseline_cross_source_missing");
    expect(allText(response)).not.toMatch(/[+−]\d/); // nenhuma diferença escrita
  });

  it("o caso real: outubro (4 dias) × setembro inteiro → não computável por duração", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const { response } = await ask("comparison", {
      memory,
      comparePeriod: { startDate: "2026-09-01", endDate: "2026-09-30" },
    });
    expect(response.status).toBe("not_computable");
    expect(response.limitations.map((l) => l.code)).toContain("comparison_not_computable:different_duration");
  });
});

describe("free_question", () => {
  const LEAD =
    "O modelo de linguagem do Advisor não está ativo neste ambiente, então a pergunta livre não foi interpretada; segue o resumo determinístico do período, calculado pelo sistema. ";

  it("LLM desligado: o usuário recebe o resumo determinístico do período, dito como tal — com os números reais", async () => {
    const { response } = await ask("free_question", { question: "Qual foi o CAC de outubro?" });
    const summary = (await ask("period_summary")).response;

    // é o MESMO resumo do período, antecedido de uma frase que diz o que ele é e por quê
    expect(response.status).toBe("answered");
    expect(response.intent).toBe("free_question");
    expect(response.title).toBe("Pergunta livre — Resumo do período 01/10/2026 a 04/10/2026");
    expect(response.summary).toBe(LEAD + summary.summary);
    expect(response.sections).toEqual(summary.sections);
    expect(ids(response)).toEqual(["coverage", "acquisition", "commercial", "values"]);
    // números reais do período, com a ressalva do valor e da moeda
    expect(response.summary).toContain("487 sessões");
    expect(response.summary).toContain("23.399,00 (soma de 1 de 5 ganhos com valor registrado; moeda não informada pelo CRM)");
    expect(response.summary).not.toMatch(/R\$/);
    expect(response.provenance).toMatchObject({ producer: "deterministic", fellBack: false });
  });

  it("LLM desligado: o motivo vem como limitação (`llm_not_connected`), sem texto técnico, sem erro e sem stack trace", async () => {
    const { response } = await ask("free_question");
    expect(response.limitations.find((l) => l.code === "llm_not_connected")).toMatchObject({ origin: "advisor", severity: "info" });
    expect(response.limitations.map((l) => l.code)).not.toContain("model_failed");
    expect(response.limitations.map((l) => l.code)).not.toContain("model_output_rejected");
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/\bat \S+ \(|node_modules|Error:|stack|ANTHROPIC|api[_ -]?key|undefined|\[object/i);
    // todas as limitações do resumo do período continuam na resposta (nenhuma some)
    const summaryCodes = (await ask("period_summary")).response.limitations.map((l) => l.code);
    for (const code of summaryCodes) expect(response.limitations.map((l) => l.code)).toContain(code);
  });

  it("LLM desligado: a pergunta não é ecoada nem respondida — nenhum número de CAC aparece e o CAC segue 'não calculado'", async () => {
    const { response } = await ask("free_question", { question: "Qual foi o CAC de outubro? Quanto vendemos de Paid Search?" });
    expect(JSON.stringify(response)).not.toContain("Qual foi o CAC");
    expect(JSON.stringify(response)).not.toContain("Paid Search");
    // o único CAC da resposta é a definição do sistema ("Não calculado: CAC — …"), sem número
    const cac = response.limitations.find((l) => l.code === "not_computed:cac");
    expect(cac?.message).toMatch(/^Não calculado: CAC/);
    for (const i of response.sections.flatMap((s) => s.items)) {
      if (/CAC/.test(i.text)) expect(i.layer).toBe("limitation");
    }
  });

  it("LLM desligado e sem Cross-source gerado: `no_data` — o resumo diz que não há dados e a limitação bloqueante aparece", async () => {
    const { response } = await ask("free_question", { memory: createMemoryStore() });
    expect(response.status).toBe("no_data");
    expect(response.title).toContain("Pergunta livre — ");
    expect(response.summary.startsWith(LEAD)).toBe(true);
    expect(response.summary).toContain("Não há Cross-source gerado");
    expect(response.sections.flatMap((s) => s.figures)).toEqual([]);
    expect(response.limitations.find((l) => l.code === "cross_source_not_generated")?.severity).toBe("blocking");
    expect(response.limitations.map((l) => l.code)).toContain("llm_not_connected");
  });

  it("oferece as análises determinísticas seguintes (a própria síntese do período não se repete)", async () => {
    const { response } = await ask("free_question");
    expect(response.followUps.map((f) => f.intent)).toEqual(
      expect.arrayContaining(["closing_report", "problems", "acquisition_analysis", "commercial_analysis"]),
    );
    expect(response.followUps.map((f) => f.intent)).not.toContain("period_summary");
  });
});

describe("sem Cross-source gerado (nada a inventar)", () => {
  for (const intent of ["period_summary", "closing_report", "diagnostic_explanation", "acquisition_analysis", "commercial_analysis"] as const) {
    it(`${intent}: no_data, sem nenhuma figura e sem nenhum número além das datas`, async () => {
      const { response } = await ask(intent, { memory: createMemoryStore() });
      expect(response.status).toBe("no_data");
      expect(response.title).toContain("sem dados para 01/10/2026 a 04/10/2026");
      expect(response.sections.flatMap((s) => s.figures)).toEqual([]);
      expect(response.evidence).toEqual([]);
      // nenhum número além das datas do período ("GA4" é o nome da fonte, não o número 4)
      expect(response.summary.replace(/\d{2}\/\d{2}\/\d{4}/g, "").replace(/GA4/g, "GA")).not.toMatch(/\d/);
      expect(response.limitations.find((l) => l.code === "cross_source_not_generated")?.severity).toBe("blocking");
      expect(response.provenance.crossSource).toEqual({ status: "not_generated", generatedAt: null });
    });
  }

  it("o fechamento ainda mostra o diagnóstico do motor, com a ressalva da janela", async () => {
    const { response } = await ask("closing_report", { memory: createMemoryStore() });
    expect(ids(response)).toEqual(["coverage", "diagnostics"]);
    expect(layers(response, "diagnostics")).toContain("limitation");
  });
});

describe("isolamento e validação do pedido", () => {
  it("responde só com os dados do workspace pedido", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD, undefined, WS);
    await persist(octoberContext({ ga4Rows: [{ date: "2026-10-01", sessions: 999 }, { date: "2026-10-02", sessions: 0 }, { date: "2026-10-03", sessions: 0 }, { date: "2026-10-04", sessions: 0 }] }), OCT_PERIOD, memory, "ws-b");
    const mine = await answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent: "period_summary" }, sourcesFrom(memory, []));
    const theirs = await answerAdvisorQuery({ workspaceId: "ws-b", period: OCT_PERIOD, intent: "period_summary" }, sourcesFrom(memory, []));
    expect(mine.summary).toContain("487 sessões");
    expect(mine.summary).not.toContain("999");
    expect(theirs.summary).toContain("999 sessões");
  });

  it("pedido inválido nunca chega ao modelo: erro com mensagem para o usuário", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const deps = sourcesFrom(memory);
    await expect(answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent: "nao_existe" }, deps)).rejects.toThrow(AdvisorQueryError);
    await expect(answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent: "comparison" }, deps)).rejects.toThrow(/período de comparação/);
    await expect(answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent: "free_question" }, deps)).rejects.toThrow(/Escreva a pergunta/);
    await expect(
      answerAdvisorQuery({ workspaceId: WS, period: { startDate: "2026-10-05", endDate: "2026-10-01" }, intent: "period_summary" }, deps),
    ).rejects.toThrow(/Período inválido/);
    await expect(
      answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent: "period_summary", workspace: "x" }, deps),
    ).rejects.toThrow(AdvisorQueryError);
  });

  it("é determinística: o mesmo pedido gera a mesma resposta", async () => {
    const a = await ask("closing_report");
    const b = await ask("closing_report");
    expect(a.response).toEqual(b.response);
  });
});
