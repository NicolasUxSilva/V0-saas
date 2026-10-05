/**
 * UI do Advisor — o visualizador da resposta renderizado no servidor (ele é puro).
 *
 * O que se prova aqui é o que importa para não enganar quem lê: números vêm da
 * resposta estruturada, uma hipótese NUNCA parece um fato, ausência aparece como
 * "sem dado" (nunca 0), limitações aparecem por gravidade, e nada é HTML injetável.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdvisorResponseView } from "@/components/advisor/response-view";
import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";

import type { AdvisorIntent } from "../intents";
import { LlmAdvisorModel } from "../llm/model";
import { AdvisorLlmError } from "../llm/transport";
import { answerAdvisorQuery } from "../service";
import type { AdvisorResponse } from "../types";
import {
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  octoberContext,
  persist,
  septemberContext,
  sourcesFrom,
} from "./advisor-fixtures";
import { QUERY as LLM_QUERY, fakeTransport, goodOutput, ok, setup as llmSetup } from "./advisor-llm-fixtures";

async function respond(
  intent: AdvisorIntent,
  opts: { ctx?: ReturnType<typeof octoberContext>; memory?: ReturnType<typeof createMemoryStore>; compare?: boolean } = {},
): Promise<AdvisorResponse> {
  const memory = opts.memory ?? (await persist(opts.ctx ?? octoberContext(), OCT_PERIOD));
  if (opts.compare) await persist(septemberContext(), SEP_PERIOD, memory);
  return answerAdvisorQuery(
    {
      workspaceId: WS,
      period: OCT_PERIOD,
      intent,
      ...(intent === "comparison" ? { comparePeriod: SEP_PERIOD } : {}),
      ...(intent === "free_question" ? { question: "e então?" } : {}),
    },
    sourcesFrom(memory, [diagnosticItem()]),
  );
}

const html = (response: AdvisorResponse, onFollowUp?: (i: AdvisorIntent) => void) =>
  renderToStaticMarkup(createElement(AdvisorResponseView, { response, onFollowUp }));

describe("fechamento renderizado", () => {
  it("título, período, resumo e status", async () => {
    const out = html(await respond("closing_report"));
    expect(out).toContain("Fechamento do período 01/10/2026 a 04/10/2026");
    expect(out).toContain("Período analisado: 01/10/2026 a 04/10/2026");
    expect(out).toContain("GA4: 487 sessões em 4 de 4 dias");
    expect(out).toContain("Respondido");
  });

  it("os números saem da resposta estruturada, sem símbolo de moeda inventado", async () => {
    const out = html(await respond("closing_report"));
    for (const n of ["487", "23.399,00", "26,3%", ">9<", ">5<", ">14<"]) expect(out, n).toContain(n);
    expect(out).not.toMatch(/R\$|BRL/);
  });

  it("cada camada tem a sua etiqueta — e a hipótese é visualmente distinta (tracejada)", async () => {
    const out = html(await respond("closing_report"));
    for (const label of ["Fato", "Relação observável", "Hipótese", "Diagnóstico do motor"]) expect(out, label).toContain(label);
    // limitação sempre com a gravidade na etiqueta
    expect(out).toContain("Limitação · Atenção");
    expect(out).toContain("Limitação · Definição");
    // a hipótese tem a borda tracejada; fato e limitação não
    const hypothesisLi = out.split("<li").filter((li) => li.includes("Hipótese</span>"));
    expect(hypothesisLi.length).toBeGreaterThanOrEqual(3);
    for (const li of hypothesisLi) expect(li).toContain("border-dashed");
    const factLi = out.split("<li").filter((li) => li.includes(">Fato</span>"));
    expect(factLi.length).toBeGreaterThan(5);
    for (const li of factLi) expect(li).not.toContain("border-dashed");
  });

  it("o diagnóstico de outra janela vem com a limitação, e a proveniência diz que a janela é outra", async () => {
    const out = html(await respond("closing_report"));
    expect(out).toContain("Janela analisada pelo motor: 05/09/2026 a 02/10/2026");
    expect(out).toContain("O diagnóstico do motor refere-se a outra janela");
    expect(out).toContain("diagnóstico de outra janela");
    expect(out).toContain("Cross-source gerado em");
    expect(out).toContain("determinística (sem modelo de linguagem)");
  });

  it("evidências citadas num bloco recolhível e definições num bloco recolhível", async () => {
    const out = html(await respond("problems"));
    expect(out).toMatch(/<details[^>]*>[\s\S]*Definições e escopo dos dados \(\d+\)/);
    const closing = html(await respond("closing_report"));
    expect(closing).toMatch(/Evidências citadas \(\d+\)/);
  });

  it("cada limitação aparece UMA vez na tela (inline ou no painel), nunca duas", async () => {
    const response = await respond("period_summary");
    const out = html(response);
    for (const l of response.limitations) {
      const text = l.message.replace(/&/g, "&amp;");
      const occurrences = out.split(text).length - 1;
      expect(occurrences, l.code).toBe(1);
    }
  });
});

describe("ausência nunca vira zero na tela", () => {
  it("GA4 sem linhas: 'sem dado' + a nota NA TABELA DE NÚMEROS, e nenhum '0 sessões'", async () => {
    const out = html(await respond("period_summary", { ctx: octoberContext({ ga4Days: [] }) }));
    // só as seções: o bloco de evidências (depois) também diz "sem dado" e não pode mascarar a tabela
    const sections = out.split("Evidências citadas")[0]!;
    expect(sections).toMatch(/Sessões \(GA4\)<\/td><td[^>]*><span[^>]*>sem dado<\/span>/);
    expect(sections).not.toMatch(/Sessões \(GA4\)<\/td><td[^>]*>0</);
    expect(out).toContain("ausência de dado, não zero sessões");
    expect(out).toContain("Parcial");
    expect(out).not.toMatch(/\b0 sessões/);
  });

  it("valor perdido não calculável aparece como 'sem dado' com o motivo — não como 0,00", async () => {
    const out = html(await respond("commercial_analysis"));
    const sections = out.split("Evidências citadas")[0]!;
    expect(sections).toMatch(/Valor dos negócios perdidos<\/td><td[^>]*><span[^>]*>sem dado<\/span>/);
    expect(sections).not.toMatch(/Valor dos negócios perdidos<\/td><td[^>]*>0[,<]/);
    expect(out).toContain("nenhum dos 14 negócios perdidos tem valor registrado");
  });

  it("Cross-source não gerado: 'Sem dados', limitação bloqueante e nenhuma tabela de números", async () => {
    const out = html(await respond("period_summary", { memory: createMemoryStore() }));
    expect(out).toContain("Sem dados");
    expect(out).toContain("Bloqueante");
    expect(out).toContain("Cross-source não gerado para o período");
    expect(out).not.toContain("<table");
  });
});

describe("comparação e pergunta livre", () => {
  it("comparação computada: tabela com diferença e variação; base zero explicada", async () => {
    const out = html(await respond("comparison", { compare: true }));
    expect(out).toContain("Comparação calculada pelo sistema");
    expect(out).toContain("+77");
    expect(out).toContain("+18,8%");
    expect(out).toContain("27/09/2026 a 30/09/2026");
    expect(out).toContain("base zero");
  });

  it("comparação não computável: o motivo, e nenhuma tabela de variação", async () => {
    const out = html(await respond("comparison"));
    expect(out).toContain("Não computável");
    expect(out).toContain("Bloqueante");
    expect(out).toContain("Não há Cross-source gerado para o período de comparação");
    expect(out).not.toContain("Comparação calculada pelo sistema");
  });

  it("pergunta livre (LLM desligado): o resumo determinístico, dito como tal, com os números reais e a limitação — sem 'Requer modelo'", async () => {
    const out = html(await respond("free_question"));
    expect(out).toContain("Pergunta livre — Resumo do período 01/10/2026 a 04/10/2026");
    expect(out).toContain("O modelo de linguagem do Advisor não está ativo neste ambiente");
    expect(out).toContain("segue o resumo determinístico do período, calculado pelo sistema");
    expect(out).toContain("GA4: 487 sessões em 4 de 4 dias");
    expect(out).toContain("23.399,00");
    expect(out).not.toMatch(/R\$|BRL/);
    expect(out).toContain("Perguntas livres precisam do modelo de linguagem do Advisor, que não está ativo neste ambiente");
    expect(out).not.toContain("Requer modelo de linguagem");
    expect(out).toContain("Respondido");
    // nada técnico na tela
    expect(out).not.toMatch(/stack|Error:|undefined|ANTHROPIC|\[object/i);
  });
});

describe("acompanhamentos e segurança do HTML", () => {
  it("os botões de acompanhamento só existem quando há quem os trate", async () => {
    const response = await respond("period_summary");
    expect(html(response)).not.toContain("Continuar com");
    const out = html(response, () => {});
    expect(out).toContain("Continuar com");
    for (const f of response.followUps) expect(out).toContain(f.label);
  });

  it("texto da resposta nunca vira HTML (escape de <script> e aspas)", async () => {
    const response = await respond("period_summary");
    const hostile: AdvisorResponse = {
      ...response,
      title: '<script>alert("x")</script>',
      summary: '"><img src=x onerror=alert(1)>',
      sections: response.sections.map((s, i) =>
        i === 0 ? { ...s, items: [{ layer: "fact" as const, text: "<b>negrito</b>", evidenceRefs: [] }] } : s,
      ),
    };
    const out = html(hostile);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>negrito</b>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;b&gt;negrito&lt;/b&gt;");
  });

  it("renderiza todas as intenções sem lançar erro", async () => {
    for (const intent of ["period_summary", "closing_report", "problems", "diagnostic_explanation", "acquisition_analysis", "commercial_analysis", "opportunities", "free_question"] as const) {
      expect(html(await respond(intent)).length, intent).toBeGreaterThan(200);
    }
  });
});

describe("modelo de linguagem na tela", () => {
  async function viaModel(respond: Parameters<typeof fakeTransport>[0]) {
    const s = await llmSetup();
    const model = new LlmAdvisorModel(fakeTransport(respond), { log: () => {} });
    return answerAdvisorQuery(LLM_QUERY, { ...s.deps, model, log: () => {} });
  }
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  it("resposta do modelo: a proveniência diz qual modelo, a versão do prompt e que o sistema a validou — sem aviso de fallback", async () => {
    const s = await llmSetup();
    const out = html(await viaModel(() => ok(goodOutput(s.context))));
    expect(out).toContain("do modelo “fake:fake-1” (prompt advisor-prompt-v2), validada pelo sistema");
    expect(out).not.toContain("determinística (sem modelo de linguagem)");
    expect(out).not.toContain("não pôde ser usada");
    expect(out).toContain("Respondido");
  });

  it("FALLBACK por falha do provedor: o aviso no topo diz o motivo, e a limitação aparece UMA vez (não repetida no painel)", async () => {
    const response = await viaModel(() => {
      throw new AdvisorLlmError("unavailable");
    });
    const out = html(response);
    const note = response.limitations.find((l) => l.code === "model_failed")!;
    expect(out).toContain("A resposta do modelo de linguagem não pôde ser usada");
    expect(out).toContain("o serviço do modelo está indisponível no momento");
    expect(out).toContain("Abaixo está a resposta determinística do sistema");
    expect(count(out, note.message)).toBe(1);
    // o aviso vem ANTES do título da resposta
    expect(out.indexOf("não pôde ser usada")).toBeLessThan(out.indexOf("Fechamento do período"));
    expect(out).toContain("determinística (sem modelo de linguagem) — o modelo de linguagem não pôde ser usado");
  });

  it("FALLBACK por recusa do guard: o aviso traz os motivos da recusa", async () => {
    const s = await llmSetup();
    const response = await viaModel(() => ok({ ...goodOutput(s.context), summary: "O valor foi R$ 99,00." }));
    const out = html(response);
    const note = response.limitations.find((l) => l.code === "model_output_rejected")!;
    expect(out).toContain("A resposta do modelo de linguagem não pôde ser usada");
    expect(out).toContain("currency_assumed");
    expect(count(out, note.message)).toBe(1);
  });

  it("em fallback, TODA limitação continua aparecendo exatamente uma vez na tela", async () => {
    const response = await viaModel(() => {
      throw new AdvisorLlmError("timeout");
    });
    const out = html(response);
    for (const l of response.limitations) {
      expect(count(out, l.message.replace(/&/g, "&amp;")), l.code).toBe(1);
    }
  });

  it("sem fallback (determinístico, pergunta livre sem LLM, sem dados) não há aviso de fallback", async () => {
    for (const intent of ["closing_report", "free_question"] as const) {
      expect(html(await respond(intent))).not.toContain("não pôde ser usada");
    }
    const noData = html(await respond("period_summary", { memory: createMemoryStore() }));
    expect(noData).not.toContain("não pôde ser usada");
  });

  it("o texto do modelo também é escapado (nunca vira HTML)", async () => {
    const s = await llmSetup();
    const response = await viaModel(() => ok(goodOutput(s.context)));
    const hostile: AdvisorResponse = { ...response, summary: '<img src=x onerror="alert(1)">', title: "<script>1</script>" };
    const out = html(hostile);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });
});
