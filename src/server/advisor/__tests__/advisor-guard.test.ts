/**
 * Guard da saída (INV-6/INV-7): o que ele prova — e recusa — sobre uma resposta.
 */
import { describe, expect, it } from "vitest";

import { getCrossSourceInsights } from "@/server/analysis/cross-source-store";

import { composeAdvisorContext } from "../compose";
import { buildAdvisorContext } from "../context";
import { answerDeterministically } from "../deterministic-model";
import {
  allowedTokens,
  extractTokens,
  validateAdvisorResponse,
  validateModelResponse,
  type GuardViolationCode,
} from "../guard";
import { answerAdvisorQuery } from "../service";
import type { AdvisorContext, AdvisorModelResponse, AdvisorQuery } from "../types";
import {
  NOW,
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  diagnosticItem,
  octoberContext,
  persist,
  septemberContext,
  sourcesFrom,
} from "./advisor-fixtures";

const QUERY: AdvisorQuery = { workspaceId: WS, period: OCT_PERIOD, intent: "closing_report" };

async function setup() {
  const memory = await persist(octoberContext(), OCT_PERIOD);
  const deps = sourcesFrom(memory, [diagnosticItem()]);
  const context = await buildAdvisorContext(WS, OCT_PERIOD, {}, deps);
  const draft = answerDeterministically(context, QUERY);
  return { memory, deps, context, draft };
}

const codes = (violations: { code: GuardViolationCode }[]) => violations.map((v) => v.code);

describe("extractTokens — números e datas em texto pt-BR", () => {
  it("números com milhar, decimal e percentual", () => {
    expect(extractTokens("487 sessões; 23.399,00; 26,3%; 1.234.567; 0").numbers).toEqual([
      "487",
      "23.399,00",
      "26,3%",
      "1.234.567",
      "0",
    ]);
  });

  it("datas (dd/mm/aaaa e ISO) saem à parte — os dígitos delas não viram 'números'", () => {
    const t = extractTokens("de 01/10/2026 a 2026-10-04 (gerado em 2026-10-04T20:10:55.505Z): 487");
    expect(t.dates).toEqual(["01/10/2026", "04/10/2026", "04/10/2026"]);
    expect(t.numbers).toEqual(["487"]);
  });

  it("'GA4' é o nome da fonte, não o número 4", () => {
    expect(extractTokens("GA4: 487 sessões").numbers).toEqual(["487"]);
    expect(extractTokens("sem dados do GA4").numbers).toEqual([]);
  });

  it("texto sem números", () => {
    expect(extractTokens("Nenhuma causa foi comprovada.")).toEqual({ numbers: [], dates: [] });
  });
});

describe("allowedTokens — o que o contexto autoriza citar", () => {
  it("displays das evidências, dias do período, datas e números dos textos do Cross-source e do motor", async () => {
    const { context } = await setup();
    const { numbers, dates } = allowedTokens(context);
    for (const n of ["487", "6", "0", "9", "5", "14", "26,3%", "23.399,00", "4"]) expect(numbers.has(n), n).toBe(true);
    for (const d of ["01/10/2026", "04/10/2026", "05/09/2026", "02/10/2026"]) expect(dates.has(d), d).toBe(true);
    // texto do motor ("28 dias anteriores") e números de limitações ("80,0%") também
    expect(numbers.has("28")).toBe(true);
    expect(numbers.has("80,0%")).toBe(true);
    // e o que NÃO está no contexto, não está
    for (const n of ["488", "12345", "99,9%", "18,8%"]) expect(numbers.has(n), n).toBe(false);
    expect(dates.has("15/08/2026")).toBe(false);
  });
});

describe("validateModelResponse — o rascunho de um modelo", () => {
  it("a resposta determinística de cada intenção passa sem violação", async () => {
    const { context } = await setup();
    for (const intent of ["period_summary", "closing_report", "problems", "diagnostic_explanation", "acquisition_analysis", "commercial_analysis", "opportunities"] as const) {
      const draft = answerDeterministically(context, { ...QUERY, intent });
      expect(validateModelResponse(draft, context), intent).toEqual([]);
    }
  });

  it("recusa número que não existe no contexto (na frase, no título e nos itens)", async () => {
    const { context, draft } = await setup();
    const bad: AdvisorModelResponse = {
      ...draft,
      title: "Fechamento com 12345 leads",
      summary: `${draft.summary} Houve 488 sessões.`,
      sections: draft.sections.map((s, i) =>
        i === 0 ? { ...s, items: [...s.items, { layer: "fact", text: "Taxa de 99,9%.", evidenceRefs: [context.evidence[0]!.ref] }] } : s,
      ),
    };
    const v = validateModelResponse(bad, context);
    expect(codes(v)).toEqual(Array(3).fill("number_not_in_context"));
    expect(v.map((x) => x.detail).join("|")).toMatch(/12345.*488.*99,9%/);
    expect(v.map((x) => x.where)).toEqual(["title", "summary", "sections[0].items[" + (draft.sections[0]!.items.length) + "]"]);
  });

  it("recusa 'R$ 23.399' — o número até existe, mas a moeda não foi informada", async () => {
    const { context, draft } = await setup();
    const v = validateModelResponse({ ...draft, summary: "O valor ganho foi R$ 23.399,00 em outubro de 01/10/2026." }, context);
    expect(codes(v)).toEqual(["currency_assumed"]);
    // 23.399 sem os centavos também não é o número do contexto
    const v2 = validateModelResponse({ ...draft, summary: "Valor ganho: 23.399." }, context);
    expect(codes(v2)).toEqual(["number_not_in_context"]);
  });

  it("aceita moeda quando UMA fonte a informou (BRL no contexto)", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const stored = structuredClone(await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store }));
    for (const i of stored.insights) for (const e of i.evidence) if (e.format === "currency") e.currency = "BRL";
    const context = composeAdvisorContext({ workspaceId: WS, period: OCT_PERIOD, crossSource: stored, diagnostics: [], generatedAt: NOW.toISOString() });
    const draft = answerDeterministically(context, QUERY);
    expect(validateModelResponse({ ...draft, summary: "Valor ganho de R$ 23.399,00." }, context).map((v) => v.code)).not.toContain("currency_assumed");
    // e o display das evidências passa a trazer o símbolo da moeda informada
    expect(context.evidence.find((e) => e.metric === "won_value")?.display).toMatch(/R\$/);
  });

  it("recusa data que não existe no contexto (dd/mm/aaaa e ISO)", async () => {
    const { context, draft } = await setup();
    const v = validateModelResponse({ ...draft, summary: "No dia 15/08/2026 e em 2026-08-16 houve movimento." }, context);
    expect(codes(v)).toEqual(["date_not_in_context", "date_not_in_context"]);
    expect(v.map((x) => x.detail).join("|")).toMatch(/15\/08\/2026.*16\/08\/2026/);
  });

  it("recusa evidência inventada (em figura e em item)", async () => {
    const { context, draft } = await setup();
    const sections = draft.sections.map((s, i) =>
      i === 0
        ? {
            ...s,
            figureRefs: [...s.figureRefs, "ga4.bounce_rate@2026-10-01..2026-10-04"],
            items: [...s.items, { layer: "hypothesis" as const, text: "Pode haver algo.", evidenceRefs: ["rd_crm.cac@2026-10-01..2026-10-04"] }],
          }
        : s,
    );
    const v = validateModelResponse({ ...draft, sections }, context);
    expect(codes(v)).toEqual(["unknown_evidence_ref", "unknown_evidence_ref"]);
    expect(v.map((x) => x.where)).toEqual(["sections[0].figureRefs", `sections[0].items[${draft.sections[0]!.items.length}]`]);
  });

  it("fato e relação observável sem evidência são recusados; hipótese não precisa", async () => {
    const { context, draft } = await setup();
    const add = (layer: "fact" | "observable_relationship" | "hypothesis") => ({
      ...draft,
      sections: [{ id: "x", title: "x", content: "x", figureRefs: [], items: [{ layer, text: "Algo sem números.", evidenceRefs: [] }] }],
    });
    expect(codes(validateModelResponse(add("fact"), context))).toEqual(["fact_without_evidence"]);
    expect(codes(validateModelResponse(add("observable_relationship"), context))).toEqual(["fact_without_evidence"]);
    expect(validateModelResponse(add("hypothesis"), context)).toEqual([]);
  });

  it("limitação precisa apontar para um código que existe", async () => {
    const { context, draft } = await setup();
    const withItem = (item: { code?: string }) => ({
      ...draft,
      sections: [{ id: "x", title: "x", content: "x", figureRefs: [], items: [{ layer: "limitation" as const, text: "Limite.", evidenceRefs: [], ...item }] }],
    });
    expect(codes(validateModelResponse(withItem({}), context))).toEqual(["limitation_without_code"]);
    expect(codes(validateModelResponse(withItem({ code: "limite_inventado" }), context))).toEqual(["unknown_limitation_code"]);
    expect(validateModelResponse(withItem({ code: "attribution_not_supported" }), context)).toEqual([]);
  });

  it("insight inexistente (do diagnóstico ou do Cross-source) é recusado", async () => {
    const { context, draft } = await setup();
    const v = validateModelResponse(
      { ...draft, insightRefs: [{ origin: "diagnostics", key: "nao-existe" }, { origin: "cross_source", key: "cross-source:inventado" }, { origin: "cross_source", key: "commercial-activity" }] },
      context,
    );
    expect(codes(v)).toEqual(["unknown_insight_ref", "unknown_insight_ref"]);
  });

  it("limitação própria do modelo só pode ser do Advisor; intenção de acompanhamento tem de existir", async () => {
    const { context, draft } = await setup();
    const v = validateModelResponse(
      {
        ...draft,
        extraLimitations: [{ code: "x", message: "x", origin: "cross_source", severity: "info", sources: [], evidenceRefs: [] }],
        followUps: [{ intent: "inventada" as never, label: "x" }],
      },
      context,
    );
    expect(codes(v)).toEqual(["extra_limitation_origin", "unknown_intent"]);
  });

  it("em comparação, os motivos do 'não computável' contam como códigos de limitação conhecidos", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const deps = sourcesFrom(memory);
    const context = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, deps); // setembro não existe
    const draft = answerDeterministically(context, { workspaceId: WS, period: OCT_PERIOD, comparePeriod: SEP_PERIOD, intent: "comparison" });
    expect(validateModelResponse(draft, context)).toEqual([]);
  });
});

describe("validateAdvisorResponse — a resposta FINAL", () => {
  it("a resposta do serviço passa", async () => {
    const { deps, context } = await setup();
    const response = await answerAdvisorQuery(QUERY, deps);
    expect(validateAdvisorResponse(response, context)).toEqual([]);
  });

  it("detecta limitação omitida", async () => {
    const { deps, context } = await setup();
    const response = await answerAdvisorQuery(QUERY, deps);
    const dropped = { ...response, limitations: response.limitations.filter((l) => l.code !== "currency_not_informed") };
    const v = validateAdvisorResponse(dropped, context);
    expect(codes(v)).toEqual(["limitation_dropped"]);
    expect(v[0]?.detail).toContain("currency_not_informed");
  });

  it("detecta figura e evidência alteradas", async () => {
    const { deps, context } = await setup();
    const response = await answerAdvisorQuery(QUERY, deps);

    const sections = structuredClone(response.sections);
    const figure = sections.flatMap((s) => s.figures).find((f) => f.metric === "sessions")!;
    figure.value = 488;
    figure.display = "488";
    expect(codes(validateAdvisorResponse({ ...response, sections }, context))).toContain("figure_altered");

    const evidence = structuredClone(response.evidence);
    evidence.find((e) => e.metric === "won_deals")!.value = 6;
    expect(codes(validateAdvisorResponse({ ...response, evidence }, context))).toContain("evidence_altered");

    // uma figura que não existe no contexto também é "alterada"
    const invented = structuredClone(response.sections);
    invented[0]!.figures.push({ ...figure, ref: "ga4.bounce_rate@2026-10-01..2026-10-04", metric: "bounce_rate" });
    expect(codes(validateAdvisorResponse({ ...response, sections: invented }, context))).toContain("figure_altered");
  });

  it("detecta número inventado no texto da resposta final", async () => {
    const { deps, context } = await setup();
    const response = await answerAdvisorQuery(QUERY, deps);
    const v = validateAdvisorResponse({ ...response, summary: `${response.summary} Foram 77 leads.` }, context);
    expect(codes(v)).toEqual(["number_not_in_context"]);
  });
});

describe("guard — contexto de outro período não autoriza números", () => {
  it("um número que só existe no período-base não pode aparecer numa resposta sem comparação", async () => {
    // 410 só existe em setembro: o contexto de outubro (sem comparação) não o autoriza
    const memory = await persist(octoberContext(), OCT_PERIOD);
    await persist(septemberContext(), SEP_PERIOD, memory);
    const deps = sourcesFrom(memory);
    const context = await buildAdvisorContext(WS, OCT_PERIOD, {}, deps);
    const draft = answerDeterministically(context, QUERY);
    expect(codes(validateModelResponse({ ...draft, summary: "Em setembro foram 410 sessões." }, context))).toContain("number_not_in_context");
    // com a comparação no contexto, o 410 passa a existir
    const withComparison = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, deps);
    expect(validateModelResponse({ ...draft, summary: "Em 27/09/2026 a 30/09/2026 foram 410 sessões." }, withComparison)).toEqual([]);
  });

  it("o contexto não vaza o `workspaceId` para o texto autorizado", async () => {
    const { context } = await setup();
    const allowed = allowedTokens(context as AdvisorContext);
    expect([...allowed.numbers].some((n) => n.includes("ws-advisor"))).toBe(false);
  });
});
