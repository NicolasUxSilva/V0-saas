/**
 * Segurança semântica — o que o Advisor NUNCA pode fazer, provado numa matriz
 * cenário × intenção (nove cenários de dados, oito intenções):
 *
 *   • criar dados            — todo número/evidência da resposta existe no contexto;
 *   • inventar comparação    — só compara quando comparável, e só as métricas permitidas;
 *   • tratar ausência como 0 — fonte ausente nunca ganha zero; `null` continua `null`;
 *   • criar atribuição       — nenhum fato/relação afirma atribuição, CAC, ROAS ou causa;
 *   • misturar populações    — nenhuma taxa/razão entre GA4, RD Marketing e CRM;
 *   • assumir moeda          — sem R$/BRL quando a fonte não informa a moeda;
 *   • hipótese como fato     — hipótese só aparece na camada `hypothesis`.
 */
import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";

import { COMPARABLE_METRICS } from "../comparison";
import { buildAdvisorContext } from "../context";
import { validateAdvisorResponse } from "../guard";
import { ADVISOR_INTENTS, type AdvisorIntent } from "../intents";
import { answerAdvisorQuery } from "../service";
import type { AdvisorContext, AdvisorResponse } from "../types";
import {
  OCT,
  OCT_GA4_ROWS,
  OCT_PERIOD,
  SEP_PERIOD,
  WS,
  deal,
  diagnosticItem,
  lost,
  makeRdCrm,
  octoberContext,
  octoberCrmRows,
  persist,
  septemberContext,
  sourcesFrom,
  trafficDropItem,
  won,
} from "./advisor-fixtures";

interface Scenario {
  name: string;
  build: () => Promise<ReturnType<typeof createMemoryStore>>;
  diagnostics?: ReturnType<typeof diagnosticItem>[];
}

const noValueCrm = () =>
  makeRdCrm(
    [
      ...Array.from({ length: 9 }, () => deal({ dealCreatedAt: "2026-10-02" })),
      ...Array.from({ length: 5 }, () => won({ dealClosedAt: "2026-10-01" })),
      ...Array.from({ length: 14 }, () => lost({ dealClosedAt: "2026-10-02" })),
    ],
    OCT,
    "2026-04-07",
  );

const SCENARIOS: Scenario[] = [
  { name: "completo", build: () => persist(octoberContext(), OCT_PERIOD) },
  { name: "ga4 ausente", build: () => persist(octoberContext({ ga4Days: [] }), OCT_PERIOD) },
  {
    name: "ga4 com linhas zeradas",
    build: () => persist(octoberContext({ ga4Rows: OCT_GA4_ROWS.map((r) => ({ ...r, sessions: 0 })) }), OCT_PERIOD),
  },
  { name: "ga4 parcial", build: () => persist(octoberContext({ ga4Days: ["2026-10-01", "2026-10-02"] }), OCT_PERIOD) },
  { name: "rd ausentes", build: () => persist(octoberContext({ rdMarketing: null, rdCrm: null }), OCT_PERIOD) },
  {
    name: "histórico de crm parcial",
    build: () => persist(octoberContext({ rdCrm: makeRdCrm(octoberCrmRows(), OCT, "2026-10-03") }), OCT_PERIOD),
  },
  { name: "crm sem nenhum valor", build: () => persist(octoberContext({ rdCrm: noValueCrm() }), OCT_PERIOD) },
  { name: "cross-source não gerado", build: async () => createMemoryStore() },
  {
    name: "com problema crítico do motor",
    build: () => persist(octoberContext(), OCT_PERIOD),
    diagnostics: [trafficDropItem(), diagnosticItem()],
  },
];

const INTENTS = ADVISOR_INTENTS.filter((i) => i !== "comparison" && i !== "free_question");

async function run(scenario: Scenario, intent: AdvisorIntent) {
  const memory = await scenario.build();
  const deps = sourcesFrom(memory, scenario.diagnostics ?? [diagnosticItem()]);
  const response = await answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, intent }, deps);
  const context = await buildAdvisorContext(WS, OCT_PERIOD, {}, deps);
  return { response, context };
}

const texts = (r: AdvisorResponse) => [
  r.title,
  r.summary,
  ...r.sections.flatMap((s) => [s.title, s.content, ...s.items.map((i) => i.text)]),
];
const nonLimitationItems = (r: AdvisorResponse) =>
  r.sections.flatMap((s) => s.items).filter((i) => i.layer !== "limitation");

function expectSafe(response: AdvisorResponse, context: AdvisorContext): void {
  // a evidência do período-base (comparação) vem no contexto, ao lado da do período atual
  const byRef = new Map(
    [...context.evidence, ...(context.comparison?.baselineEvidence ?? [])].map((e) => [e.ref, e] as const),
  );

  // 1. o guard (número ∈ contexto, evidência existe, camadas, limitações, figuras idênticas) não acha nada
  expect(validateAdvisorResponse(response, context)).toEqual([]);

  // 2. NÃO cria dados: toda figura e toda evidência são cópias EXATAS do contexto
  for (const s of response.sections) {
    for (const f of s.figures) expect(f, f.ref).toEqual(byRef.get(f.ref));
  }
  for (const e of response.evidence) expect(e, e.ref).toEqual(byRef.get(e.ref));

  // 3. NÃO assume moeda: nenhuma fonte informou moeda, então nenhum R$/BRL
  if (!context.evidence.some((e) => e.currency)) {
    for (const t of texts(response)) expect(t).not.toMatch(/R\$|\bBRL\b|\breais\b/i);
  }

  // 4. NÃO cria atribuição, CAC, ROAS nem causa: só as LIMITAÇÕES falam disso (para negar)
  for (const i of nonLimitationItems(response)) {
    expect(i.text, i.text).not.toMatch(/\b(CAC|ROAS)\b/);
    expect(i.text, i.text).not.toMatch(/atribu[ií]/i);
    expect(i.text, i.text).not.toMatch(/\b(causou|causaram|provocou|gerou|resultou em|por causa d|devido a)\b/i);
  }

  // 5. NÃO mistura populações: nenhuma taxa/razão entre fontes entre as figuras
  for (const s of response.sections) {
    for (const f of s.figures) {
      if (f.format === "rate") {
        expect(f.source, f.ref).toBe("rd_crm"); // taxa de ganho e cobertura de origem — intra-CRM
        expect(f.metric, f.ref).toMatch(/^(win_rate|(created|won)_(source_id|campaign_id)_coverage)$/);
      }
      expect(f.metric, f.ref).not.toMatch(/ga4_to_rd|rd_to_crm|traffic_to_sales|conversion_rate|\bcac\b|\broas\b/);
    }
  }

  // 6. hipótese NUNCA é fato: o texto de uma hipótese do contexto só aparece na camada `hypothesis`
  const hypotheses = new Set(context.hypotheses.map((h) => h.text));
  for (const s of response.sections) {
    for (const i of s.items) {
      if (hypotheses.has(i.text)) expect(i.layer, i.text).toBe("hypothesis");
      if (i.layer === "fact") expect(hypotheses.has(i.text), i.text).toBe(false);
    }
  }

  // 7. fato e relação observável sempre citam evidência
  for (const s of response.sections) {
    for (const i of s.items) {
      if (i.layer === "fact" || i.layer === "observable_relationship") {
        expect(i.evidenceRefs.length, i.text).toBeGreaterThan(0);
      }
    }
  }

  // 8. AUSÊNCIA ≠ ZERO: fonte ausente/desconhecida nunca ganha uma métrica de atividade — nem zerada
  const ACTIVITY = new Set(["sessions", "visits", "conversions", "created_deals", "won_deals", "lost_deals"]);
  for (const src of context.sources.filter((x) => x.status === "unavailable" || x.status === "unknown")) {
    for (const s of response.sections) {
      for (const f of s.figures.filter((x) => x.source === src.source && ACTIVITY.has(x.metric))) {
        // a única presença possível é a GA4 sem linhas: `null` com nota — nunca 0
        expect(f.value, f.ref).toBeNull();
        expect(f.display, f.ref).toBeNull();
      }
    }
  }
  const ga4 = context.sources.find((x) => x.source === "ga4");
  if (ga4?.status === "unavailable") {
    expect(response.summary).not.toMatch(/\b0 sessões/);
  }

  // 9. JSON puro e finito
  expect(JSON.parse(JSON.stringify(response))).toEqual(response);
}

describe("segurança semântica — cenário × intenção", () => {
  for (const scenario of SCENARIOS) {
    for (const intent of INTENTS) {
      it(`${scenario.name} · ${intent}`, async () => {
        const { response, context } = await run(scenario, intent);
        expectSafe(response, context);
      });
    }
  }
});

describe("segurança semântica — casos que a matriz não cobre sozinha", () => {
  it("comparação: só métricas permitidas, e variação nunca é inventada quando não é comparável", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    await persist(septemberContext(), SEP_PERIOD, memory);
    const deps = sourcesFrom(memory, [diagnosticItem()]);
    const computed = await answerAdvisorQuery({ workspaceId: WS, period: OCT_PERIOD, comparePeriod: SEP_PERIOD, intent: "comparison" }, deps);
    const context = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, deps);
    expectSafe(computed, context);
    for (const i of computed.comparison!.items) expect(COMPARABLE_METRICS).toContain(i.metricId);

    // não comparável → nenhuma diferença escrita em lugar nenhum
    const notComputable = await answerAdvisorQuery(
      { workspaceId: WS, period: OCT_PERIOD, comparePeriod: { startDate: "2026-09-01", endDate: "2026-09-30" }, intent: "comparison" },
      deps,
    );
    expect(notComputable.status).toBe("not_computable");
    expect(notComputable.comparison?.items).toEqual([]);
    expect(texts(notComputable).join("\n")).not.toMatch(/[+−]\d|variação percentual/);
  });

  it("pergunta livre (LLM desligado): o resumo determinístico — não responde sobre CAC/ROAS, não ecoa a pergunta e não inventa canal", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    const deps = sourcesFrom(memory);
    const r = await answerAdvisorQuery(
      { workspaceId: WS, period: OCT_PERIOD, intent: "free_question", question: "Qual o CAC e o ROAS de 2026 e quanto vendemos de Paid Search?" },
      deps,
    );
    expect(r.provenance).toMatchObject({ producer: "deterministic", fellBack: false });
    expect(r.summary).toContain("segue o resumo determinístico do período");
    // a pergunta nunca é ecoada e um canal que o contexto não tem não aparece
    expect(JSON.stringify(r)).not.toContain("quanto vendemos");
    expect(JSON.stringify(r)).not.toContain("Paid Search");
    // CAC e ROAS só existem como "não calculado" (limitação do sistema), sem número e fora dos fatos
    for (const item of r.sections.flatMap((s) => s.items)) {
      if (/CAC|ROAS/.test(item.text)) expect(item.layer, item.text).toBe("limitation");
    }
    expect(r.limitations.find((l) => l.code === "not_computed:cac")?.message).toMatch(/^Não calculado: CAC/);
    expect(r.limitations.find((l) => l.code === "not_computed:roas")?.message).toMatch(/^Não calculado: ROAS/);
  });

  it("o valor ganho nunca aparece como total quando só parte dos ganhos tem valor", async () => {
    const { response } = await run(SCENARIOS[0]!, "period_summary");
    expect(response.summary).toContain("soma de 1 de 5 ganhos com valor registrado");
    expect(response.summary).toContain("moeda não informada pelo CRM");
    expect(response.summary).not.toMatch(/R\$/);
    const values = response.sections.find((s) => s.id === "values")!;
    expect(values.items.map((i) => i.code)).toEqual(expect.arrayContaining(["won_value_partial", "currency_not_informed"]));
  });

  it("CRM sem NENHUM valor: o valor ganho é ausência, não 0,00", async () => {
    const { response, context } = await run(SCENARIOS.find((s) => s.name === "crm sem nenhum valor")!, "commercial_analysis");
    const wonValue = context.evidence.find((e) => e.metric === "won_value");
    expect(wonValue?.value).toBeNull();
    expect(response.summary).not.toContain("valor dos ganhos");
    expect(response.sections.flatMap((s) => s.figures).find((f) => f.metric === "won_value" && f.display !== null)).toBeUndefined();
    expect(response.limitations.map((l) => l.code)).toContain("metric_not_computable:won_value");
  });

  it("GA4 com linhas zeradas é DADO (0 sessões, fonte coberta) — e não é tratado como ausência", async () => {
    const { response, context } = await run(SCENARIOS.find((s) => s.name === "ga4 com linhas zeradas")!, "period_summary");
    expect(context.sources.find((s) => s.source === "ga4")?.status).toBe("covered");
    expect(response.summary).toContain("GA4: 0 sessões em 4 de 4 dias");
    expect(response.summary).not.toContain("ausência de dado");
    expect(response.limitations.map((l) => l.code)).not.toContain("ga4_unavailable");
  });

  it("GA4 ausente é AUSÊNCIA (nunca '0 sessões'), e a figura continua `null`", async () => {
    const { response } = await run(SCENARIOS.find((s) => s.name === "ga4 ausente")!, "period_summary");
    expect(response.summary).toContain("GA4: sem dados no período (ausência de dado, não zero sessões)");
    expect(response.sections.flatMap((s) => s.figures).find((f) => f.metric === "sessions")).toMatchObject({ value: null, display: null });
  });

  it("diagnóstico de outra janela nunca é apresentado como se fosse do período pedido", async () => {
    const { response } = await run(SCENARIOS.find((s) => s.name === "com problema crítico do motor")!, "problems");
    const diagnostics = response.sections.find((s) => s.id === "diagnostics")!;
    expect(diagnostics.content).toContain("Janela analisada pelo motor: 05/09/2026 a 02/10/2026");
    expect(diagnostics.items.at(-1)).toMatchObject({ layer: "limitation", code: "diagnostics_period_differs" });
    expect(response.provenance.diagnostics.alignedWithPeriod).toBe(false);
  });
});
