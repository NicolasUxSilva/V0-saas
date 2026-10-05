/**
 * Cross-source sobre um PERÍODO EXPLÍCITO (V1.1) — o fechamento parcial de outubro,
 * 01–04/10/2026.
 *
 * Os contextos vêm de `assembleAnalysisContext` (o código de produção que
 * `buildAnalysisContext` usa depois de ler o banco) e dos compositores reais de RD,
 * sobre linhas sintéticas. O que se prova aqui é a separação entre o período
 * SOLICITADO e a cobertura REAL de cada fonte: o atraso do GA4, o RD Marketing
 * parcial e o histórico parcial do CRM aparecem como limitação — nunca como zero,
 * nunca como uma comparação "no mesmo período" que não é.
 */
import { describe, expect, it, vi } from "vitest";

import { buildCrossSourceInsights } from "@/server/analysis/cross-source";

import {
  codes,
  evidence,
  expectNoUnnegatedCausality,
  expectStructurallyValid,
  find,
  get,
  textOf,
} from "./cross-source-asserts";
import {
  OCT,
  deal,
  makeRdCrm,
  makeRdMarketing,
  octoberCrmRows,
  periodContext,
  range,
} from "./cross-source-fixtures";

// `context.ts` importa `db`; a camada Cross-source nunca pode usá-lo.
vi.mock("@/server/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`Cross-source acessou o banco (db.${String(prop)})`);
      },
    },
  ),
}));

const OCT_DAYS = range(OCT.start, OCT.end); // 01, 02, 03, 04

const assets = [
  { assetId: "a1", assetIdentifier: "lp-exemplo", visits: 6, conversions: 0 },
  { assetId: "a2", assetIdentifier: "lp-confirmacao-exemplo", visits: 0, conversions: 0 },
];
const rdOct = (dates: string[] = OCT_DAYS) => makeRdMarketing(assets, { window: OCT, dates });
const crmOct = (history: string | null = "2026-04-07") => makeRdCrm(octoberCrmRows(), OCT, history);

const run = (opts: Parameters<typeof periodContext>[0]) => buildCrossSourceInsights(periodContext(opts));

describe("01–04/10 com as três fontes cobrindo o período inteiro", () => {
  const out = run({ period: OCT, rdMarketing: rdOct(), rdCrm: crmOct() });

  it("gera o conjunto completo — e nenhum insight de limitação de período", () => {
    expect(out.map((i) => i.type)).toEqual([
      "data-coverage",
      "acquisition-coverage",
      "traffic-and-rd-conversions",
      "commercial-activity",
      "commercial-vs-acquisition",
      "attribution-quality",
      "population-not-comparable",
      "metric-not-computable",
    ]);
    for (const absent of ["partial-period", "period-mismatch", "source-unavailable"] as const) {
      expect(find(out, absent), absent).toBeUndefined();
    }
  });

  it("o período do insight é o solicitado (01–04), e nenhuma evidência foge dele", () => {
    for (const i of out) {
      expect([i.periodStart, i.periodEnd], i.type).toEqual([OCT.start, OCT.end]);
      for (const e of i.evidence) {
        if (e.metric === "history_distinct_dates") continue; // o histórico do GA4 é, por definição, mais longo
        expect(e.period.start >= OCT.start && e.period.end <= OCT.end, `${i.type}/${e.id}`).toBe(true);
      }
    }
    expect(textOf(get(out, "data-coverage"), "fact")[0]).toContain(
      "dados em 4 de 4 dias do período (01/10/2026 a 04/10/2026)",
    );
  });

  it("os números são os do período pedido — e só dele", () => {
    const traffic = get(out, "traffic-and-rd-conversions");
    expect(evidence(traffic, "ga4.sessions")).toMatchObject({ value: 4 * 190, period: OCT });
    expect(evidence(traffic, "rd_marketing.visits")).toMatchObject({ value: 6, period: OCT });
    expect(evidence(traffic, "rd_marketing.conversions")?.value).toBe(0);

    const crm = get(out, "commercial-activity");
    expect(evidence(crm, "rd_crm.created_deals")?.value).toBe(9);
    expect(evidence(crm, "rd_crm.won_deals")?.value).toBe(5);
    expect(evidence(crm, "rd_crm.lost_deals")?.value).toBe(14);
    expect(evidence(crm, "rd_crm.win_rate")?.value).toBe(0.2632);
    expect(evidence(crm, "rd_crm.won_value")?.value).toBe(23399);
    expect(evidence(crm, "rd_crm.won_deals_with_value")?.value).toBe(1);
  });

  it("a relação 'no mesmo período' vale: as fontes cobrem exatamente 01–04", () => {
    expect(textOf(get(out, "data-coverage"), "observable_relationship")).toEqual([
      "As fontes com dados (GA4, RD Marketing e RD CRM) cobrem exatamente o mesmo período (01/10/2026 a 04/10/2026).",
    ]);
    expect(textOf(get(out, "traffic-and-rd-conversions"), "observable_relationship")[0]).toContain(
      "No mesmo período (01/10/2026 a 04/10/2026)",
    );
  });

  it("estruturalmente válido e sem causalidade indevida", () => {
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
  });
});

describe("GA4 atrasado: pedido 01–04, cobertura real 01–02", () => {
  const ctx = periodContext({
    period: OCT,
    ga4Days: ["2026-10-01", "2026-10-02"],
    rdMarketing: rdOct(),
    rdCrm: crmOct(),
  });
  const out = buildCrossSourceInsights(ctx);

  it("o contexto preserva os dois conceitos: período solicitado ≠ cobertura real", () => {
    expect(ctx.period).toEqual(OCT);
    expect(ctx.coverage.inPeriod).toEqual({ daysWithData: 2, firstDate: "2026-10-01", lastDate: "2026-10-02" });
    expect(ctx.coverage.expectedLastDate).toBe("2026-10-04");
  });

  it("partial-period: dias faltando E atraso, com o texto de período explícito", () => {
    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["ga4_partial_days", "ga4_data_lag"]);
    expect(evidence(p, "ga4.days_with_data")?.value).toBe(2);
    expect(evidence(p, "ga4.data_lag_days")).toMatchObject({
      value: 2,
      period: { start: "2026-10-02", end: "2026-10-04" },
    });
    expect(textOf(p, "limitation")[0]).toContain("2 de 4 dias do período (01/10/2026 a 04/10/2026)");
    const lag = p.statements.find((s) => s.code === "ga4_data_lag")!.text;
    expect(lag).toContain("só tem dados até 02/10/2026");
    expect(lag).toContain("2 dias antes do fim do período solicitado (04/10/2026)");
    expect(lag).toContain("os números do GA4 cobrem só parte do período");
  });

  it("data-coverage: mostra o período efetivamente coberto e NÃO afirma 'mesmo período'", () => {
    const dc = get(out, "data-coverage");
    expect(textOf(dc, "fact")[0]).toContain(
      "dados em 2 de 4 dias do período (01/10/2026 a 04/10/2026); primeiro dia com dado em 01/10/2026 e último em 02/10/2026",
    );
    expect(textOf(dc, "observable_relationship")).toEqual([]);
  });

  it("period-mismatch: lista o que cada fonte de fato cobre", () => {
    const pm = get(out, "period-mismatch");
    const limitation = textOf(pm, "limitation")[0]!;
    expect(limitation).toContain("não são equivalentes entre as fontes");
    expect(limitation).toContain("GA4 01/10/2026 a 02/10/2026");
    expect(limitation).toContain("RD Marketing 01/10/2026 a 04/10/2026");
    expect(limitation).toContain("RD CRM 01/10/2026 a 04/10/2026");
    expect(textOf(pm, "fact")).toEqual([
      "Período solicitado: 01/10/2026 a 04/10/2026. Janelas de análise: GA4 01/10/2026 a 04/10/2026; RD Marketing 01/10/2026 a 04/10/2026; RD CRM 01/10/2026 a 04/10/2026.",
      "Períodos efetivamente cobertos: GA4 01/10/2026 a 02/10/2026.",
    ]);
    expect(evidence(pm, "ga4.covered_days")).toMatchObject({
      value: 2,
      period: { start: "2026-10-01", end: "2026-10-02" },
    });
  });

  it("nada é comparado como se fosse do mesmo período", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
    expect(codes(get(out, "acquisition-coverage"))).toContain("period_not_aligned");
    for (const i of out) expect(textOf(i, "observable_relationship"), i.type).toEqual([]);
  });

  it("a ausência NÃO vira zero: as sessões são as dos 2 dias que existem, sem extrapolar", () => {
    expect(evidence(get(out, "acquisition-coverage"), "ga4.sessions")?.value).toBe(2 * 190);
    expect(textOf(get(out, "acquisition-coverage"), "fact")[0]).toContain("380 sessões em 2 de 4 dias");
  });

  it("as outras fontes continuam íntegras, cada uma no seu período", () => {
    const crm = get(out, "commercial-activity");
    expect(evidence(crm, "rd_crm.won_deals")?.value).toBe(5);
    expect([crm.periodStart, crm.periodEnd]).toEqual([OCT.start, OCT.end]);
  });

  it("estruturalmente válido e sem causalidade indevida", () => {
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
  });

  it("GA4 sem NENHUM dia no período → fonte indisponível (e não 'parcial')", () => {
    const none = run({ period: OCT, ga4Days: [], ga4LastDate: "2026-09-20", rdMarketing: rdOct(), rdCrm: crmOct() });
    expect(codes(get(none, "source-unavailable"))).toEqual(["ga4_unavailable"]);
    expect(find(none, "traffic-and-rd-conversions")).toBeUndefined();
    expect(codes(get(none, "acquisition-coverage"))).toContain("ga4_unavailable");
  });
});

describe("GA4: zero ≠ ausência (regra definitiva)", () => {
  // linha existente com sessions = 0 → dado válido com valor zero
  // ausência de linha                  → ausência de dado
  // atraso, período parcial e período não equivalente dependem da COBERTURA (linhas), nunca do valor
  const row = (date: string, sessions: number) => ({ date, sessions });
  const zeroEverywhere = OCT_DAYS.map((d) => row(d, 0));
  const ga4Codes = (out: ReturnType<typeof run>) =>
    out.flatMap((i) => codes(i)).filter((c) => c?.startsWith("ga4_"));

  it("linha com 0 sessões em TODOS os dias é dado válido: sem atraso, sem período parcial, sem desalinhamento", () => {
    const out = run({ period: OCT, ga4Rows: zeroEverywhere, rdMarketing: rdOct(), rdCrm: crmOct() });

    for (const absent of ["partial-period", "period-mismatch", "source-unavailable"] as const) {
      expect(find(out, absent), absent).toBeUndefined();
    }
    expect(ga4Codes(out)).toEqual([]); // nenhuma limitação sobre o GA4

    // o GA4 está disponível, com um ZERO REGISTRADO — e é comparável "no mesmo período"
    const traffic = get(out, "traffic-and-rd-conversions");
    expect(evidence(traffic, "ga4.sessions")).toMatchObject({ value: 0, period: OCT });
    expect(textOf(traffic, "observable_relationship")[0]).toContain("o GA4 registrou 0 sessões");
    expect(textOf(get(out, "data-coverage"), "observable_relationship")).toEqual([
      "As fontes com dados (GA4, RD Marketing e RD CRM) cobrem exatamente o mesmo período (01/10/2026 a 04/10/2026).",
    ]);
  });

  it("o texto diz que é um zero registrado — e não confunde com ausência de dado", () => {
    const out = run({ period: OCT, ga4Rows: zeroEverywhere, rdMarketing: rdOct(), rdCrm: crmOct() });
    const fact = textOf(get(out, "acquisition-coverage"), "fact")[0]!;
    expect(fact).toBe(
      "O GA4 tem dados no período analisado e registrou 0 sessões em 4 de 4 dias (01/10/2026 a 04/10/2026): é um zero registrado, não ausência de dado.",
    );
    expect(evidence(get(out, "acquisition-coverage"), "ga4.days_with_data")?.value).toBe(4);
    expect(textOf(get(out, "commercial-vs-acquisition"), "observable_relationship")[0]).toContain(
      "No mesmo período, o GA4 registrou 0 sessões.",
    );
  });

  it("zero nas PONTAS (01 e 04 zerados, 02–03 com tráfego): a cobertura é o período inteiro — nenhum atraso", () => {
    const out = run({
      period: OCT,
      ga4Rows: [row("2026-10-01", 0), row("2026-10-02", 120), row("2026-10-03", 130), row("2026-10-04", 0)],
      rdMarketing: rdOct(),
      rdCrm: crmOct(),
    });
    expect(find(out, "partial-period")).toBeUndefined();
    expect(find(out, "period-mismatch")).toBeUndefined();
    expect(ga4Codes(out)).toEqual([]);
    expect(textOf(get(out, "data-coverage"), "fact")[0]).toContain(
      "dados em 4 de 4 dias do período (01/10/2026 a 04/10/2026); primeiro dia com dado em 01/10/2026 e último em 04/10/2026",
    );
    expect(find(out, "traffic-and-rd-conversions")).toBeDefined();
  });

  it("zero no MEIO do período não é buraco de cobertura", () => {
    const out = run({
      period: OCT,
      ga4Rows: [row("2026-10-01", 90), row("2026-10-02", 0), row("2026-10-03", 0), row("2026-10-04", 110)],
      rdMarketing: rdOct(),
      rdCrm: crmOct(),
    });
    expect(find(out, "partial-period")).toBeUndefined();
    expect(evidence(get(out, "data-coverage"), "ga4.days_with_data")?.value).toBe(4);
  });

  it("a MESMA soma de sessões, com linhas zeradas × sem linhas: insights DIFERENTES — o que decide é a cobertura, não o valor", () => {
    const withZeroRows = run({
      period: OCT,
      ga4Rows: [row("2026-10-01", 100), row("2026-10-02", 100), row("2026-10-03", 0), row("2026-10-04", 0)],
      rdMarketing: rdOct(),
      rdCrm: crmOct(),
    });
    const withoutRows = run({
      period: OCT,
      ga4Rows: [row("2026-10-01", 100), row("2026-10-02", 100)], // 03 e 04 SEM linha
      rdMarketing: rdOct(),
      rdCrm: crmOct(),
    });

    // mesma soma nas duas…
    expect(evidence(get(withZeroRows, "acquisition-coverage"), "ga4.sessions")?.value).toBe(200);
    expect(evidence(get(withoutRows, "acquisition-coverage"), "ga4.sessions")?.value).toBe(200);

    // …zero registrado: cobertura completa, nada a reportar
    expect(find(withZeroRows, "partial-period")).toBeUndefined();
    expect(find(withZeroRows, "period-mismatch")).toBeUndefined();
    expect(find(withZeroRows, "traffic-and-rd-conversions")).toBeDefined();

    // …ausência de linha: atraso, período parcial e períodos não equivalentes
    expect(codes(get(withoutRows, "partial-period"))).toEqual(["ga4_partial_days", "ga4_data_lag"]);
    expect(find(withoutRows, "period-mismatch")).toBeDefined();
    expect(find(withoutRows, "traffic-and-rd-conversions")).toBeUndefined();
  });

  it("o atraso depende da ÚLTIMA LINHA, não do valor: zero no último dia com linha = em dia; última linha em 02 = 2 dias de atraso", () => {
    const zeroLast = periodContext({
      period: OCT,
      ga4Rows: [row("2026-10-01", 100), row("2026-10-02", 100), row("2026-10-03", 0), row("2026-10-04", 0)],
    });
    expect(zeroLast.coverage.lastDate).toBe("2026-10-04"); // o último dia COM LINHA — o zero conta
    expect(zeroLast.coverage.expectedLastDate).toBe("2026-10-04");
    expect(find(buildCrossSourceInsights(zeroLast), "partial-period")).toBeUndefined();

    const lagged = periodContext({
      period: OCT,
      ga4Rows: [row("2026-10-01", 100), row("2026-10-02", 100)],
    });
    expect(lagged.coverage.lastDate).toBe("2026-10-02");
    const lag = evidence(get(buildCrossSourceInsights(lagged), "partial-period"), "ga4.data_lag_days");
    expect(lag?.value).toBe(2);
  });

  it("GA4 SEM nenhuma linha é ausência de dado: fonte indisponível, e a evidência é `null` — nunca 0", () => {
    const out = run({ period: OCT, ga4Rows: [], ga4LastDate: "2026-09-20", rdMarketing: rdOct(), rdCrm: crmOct() });
    expect(codes(get(out, "source-unavailable"))).toEqual(["ga4_unavailable"]);
    for (const insight of ["acquisition-coverage", "source-unavailable"] as const) {
      expect(evidence(get(out, insight), "ga4.sessions"), insight).toMatchObject({
        value: null,
        note: "o GA4 não tem nenhuma linha no período (ausência de dado, não zero sessões)",
      });
    }
    expect(textOf(get(out, "acquisition-coverage"), "fact")[0]).toBe(
      "Não há dados do GA4 no período analisado (nenhuma linha em 01/10/2026 a 04/10/2026): ausência de dado, não zero sessões.",
    );
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
  });

  it("zero registrado × ausência de linha: o `ga4.sessions` mostra 0 num caso e `null` no outro", () => {
    const zero = run({ period: OCT, ga4Rows: zeroEverywhere, rdMarketing: rdOct() });
    const absent = run({ period: OCT, ga4Rows: [], ga4LastDate: "2026-09-20", rdMarketing: rdOct() });
    expect(evidence(get(zero, "acquisition-coverage"), "ga4.sessions")?.value).toBe(0);
    expect(evidence(get(absent, "acquisition-coverage"), "ga4.sessions")?.value).toBeNull();
  });

  it("os cenários com zero registrado seguem estruturalmente válidos e sem causalidade indevida", () => {
    const out = run({ period: OCT, ga4Rows: zeroEverywhere, rdMarketing: rdOct(), rdCrm: crmOct() });
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
  });
});

describe("modo padrão com o GA4 parado (contexto montado): a janela foi encurtada", () => {
  // janela padrão encolhida até o último dia do GA4 (25/09); o esperado era 02/10
  const window = { start: "2026-08-29", end: "2026-09-25" };
  const out = run({
    period: window,
    expectedLastDate: "2026-10-02",
    rdMarketing: makeRdMarketing(assets, { window, dates: range(window.start, window.end) }),
  });

  it("diz até quando há dados e que as outras fontes ficaram de fora da janela", () => {
    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["ga4_data_lag"]); // a janela É o que o GA4 tem: sem dias faltando
    const text = p.statements.find((s) => s.code === "ga4_data_lag")!.text;
    expect(text).toContain("só tem dados até 25/09/2026, 7 dias antes do último dia esperado (02/10/2026)");
    expect(text).toContain("a janela de análise termina no último dia com dados do GA4");
    expect(text).toContain("dados posteriores das outras fontes não entram na comparação");
  });

  it("as fontes cobrem a mesma janela → seguem comparáveis (o atraso não é um desalinhamento)", () => {
    expect(find(out, "period-mismatch")).toBeUndefined();
    expect(find(out, "traffic-and-rd-conversions")).toBeDefined();
  });
});

describe("RD Marketing parcialmente coberto: pedido 01–04, linhas só em 01–02", () => {
  const out = run({ period: OCT, rdMarketing: rdOct(["2026-10-01", "2026-10-02"]), rdCrm: crmOct() });

  it("distingue período solicitado, dias com dado e período efetivamente coberto", () => {
    const dc = get(out, "data-coverage");
    expect(textOf(dc, "fact")[1]).toBe(
      "RD Marketing: registros em 2 de 4 dias do período (01/10/2026 a 04/10/2026); primeiro registro em 01/10/2026 e último em 02/10/2026.",
    );
    expect(evidence(dc, "rd_marketing.days_with_data")).toMatchObject({ value: 2, period: OCT });
  });

  it("partial-period aponta os dias que faltam", () => {
    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["rd_marketing_partial_days"]);
    expect(textOf(p, "limitation")[0]).toContain("registros em 2 de 4 dias do período");
  });

  it("period-mismatch mostra a cobertura real do RD Marketing (01–02)", () => {
    const pm = get(out, "period-mismatch");
    expect(textOf(pm, "limitation")[0]).toContain("RD Marketing 01/10/2026 a 02/10/2026");
    expect(evidence(pm, "rd_marketing.covered_days")).toMatchObject({
      value: 2,
      period: { start: "2026-10-01", end: "2026-10-02" },
    });
  });

  it("os valores são os das linhas que existem — dia ausente não vira linha zerada", () => {
    expect(evidence(get(out, "acquisition-coverage"), "rd_marketing.visits")?.value).toBe(6);
  });

  it("sem lado a lado nem coexistência (o período do RD não é o do GA4)", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
    expect(codes(get(out, "acquisition-coverage"))).toContain("period_not_aligned");
  });

  it("linhas só no MEIO do período (02–03): a cobertura é 02–03, não 01–04", () => {
    const mid = run({ period: OCT, rdMarketing: rdOct(["2026-10-02", "2026-10-03"]), rdCrm: crmOct() });
    expect(textOf(get(mid, "period-mismatch"), "limitation")[0]).toContain("RD Marketing 02/10/2026 a 03/10/2026");
  });

  it("buraco no MEIO com as pontas presentes (01, 04): as pontas cobrem o período — o buraco é só 'parcial'", () => {
    const hole = run({ period: OCT, rdMarketing: rdOct(["2026-10-01", "2026-10-04"]), rdCrm: crmOct() });
    expect(find(hole, "period-mismatch")).toBeUndefined();
    expect(codes(get(hole, "partial-period"))).toEqual(["rd_marketing_partial_days"]);
    expect(find(hole, "traffic-and-rd-conversions")).toBeDefined();
  });

  it("estruturalmente válido e sem causalidade indevida", () => {
    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
  });
});

describe("zero é zero: linha com 0 visitas ≠ dia sem linha", () => {
  it("RD Marketing com linha em TODOS os dias e 0 visitas → cobertura completa, nenhuma limitação de período", () => {
    const zero = makeRdMarketing([{ assetId: "a1", visits: 0, conversions: 0 }], { window: OCT, dates: OCT_DAYS });
    const out = run({ period: OCT, rdMarketing: zero, rdCrm: crmOct() });
    expect(find(out, "partial-period")).toBeUndefined();
    expect(find(out, "period-mismatch")).toBeUndefined();
    const t = get(out, "traffic-and-rd-conversions");
    expect(evidence(t, "rd_marketing.visits")?.value).toBe(0);
    expect(codes(get(out, "acquisition-coverage"))).toContain("rd_marketing_no_conversions");
  });
});

describe("janelas diferentes entre as fontes (período explícito)", () => {
  const before = { start: "2026-09-27", end: "2026-09-30" };
  const out = run({
    period: OCT,
    rdMarketing: makeRdMarketing(assets, { window: before, dates: range(before.start, before.end) }),
    rdCrm: crmOct(),
  });

  it("diz que os períodos não são equivalentes e mostra a janela de cada fonte", () => {
    const pm = get(out, "period-mismatch");
    expect(textOf(pm, "limitation")[0]).toContain("não são equivalentes entre as fontes");
    expect(evidence(pm, "ga4.window_days")?.period).toEqual(OCT);
    expect(evidence(pm, "rd_marketing.window_days")?.period).toEqual(before);
    expect(evidence(pm, "rd_crm.window_days")?.period).toEqual(OCT);
  });

  it("não compara períodos diferentes como iguais", () => {
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();
    for (const i of out) expect(textOf(i, "observable_relationship"), i.type).toEqual([]);
  });
});

describe("histórico de CRM IMPORTADO: parcial ≠ completo (não é o início do histórico real do CRM)", () => {
  it("histórico importado que começa DEPOIS do início do período → piso, dito em 3 lugares", () => {
    const out = run({ period: OCT, rdMarketing: rdOct(), rdCrm: crmOct("2026-10-02") });

    const p = get(out, "partial-period");
    expect(codes(p)).toEqual(["rd_crm_partial_imported_history"]);
    const text = textOf(p, "limitation")[0]!;
    expect(text).toContain("O histórico de CRM importado para o SaaS começa em 02/10/2026");
    expect(text).toContain("depois do início do período (01/10/2026)");
    // a frase NÃO sugere que se conhece o início do histórico real do CRM
    expect(text).toContain("É o início do histórico importado, não o do histórico real do CRM, que não é conhecido.");
    expect(text).not.toMatch(/histórico do CRM começa|CRM começou/);
    expect(evidence(p, "rd_crm.covered_days")).toMatchObject({
      value: 3, // 02, 03 e 04/10
      period: { start: "2026-10-02", end: "2026-10-04" },
    });

    expect(codes(get(out, "commercial-activity"))).toContain("rd_crm_partial_imported_history");
    expect(
      get(out, "commercial-activity").statements.find((x) => x.code === "rd_crm_partial_imported_history")!.text,
    ).toContain("O histórico de CRM importado para o SaaS começa em 02/10/2026");
    expect(textOf(get(out, "period-mismatch"), "limitation")[0]).toContain("RD CRM 02/10/2026 a 04/10/2026");
    // com o CRM só parcial, a coexistência com aquisição não vale
    expect(find(out, "commercial-vs-acquisition")).toBeUndefined();

    expectStructurallyValid(out);
    expectNoUnnegatedCausality(out);
  });

  it("histórico que começa NO início do período, ou antes → completo, nenhuma limitação", () => {
    for (const history of ["2026-10-01", "2026-04-07"]) {
      const out = run({ period: OCT, rdMarketing: rdOct(), rdCrm: crmOct(history) });
      expect(find(out, "partial-period"), history).toBeUndefined();
      expect(codes(get(out, "commercial-activity")), history).not.toContain("rd_crm_partial_imported_history");
      expect(find(out, "commercial-vs-acquisition"), history).toBeDefined();
    }
  });

  it("início do histórico DESCONHECIDO → o contexto não afirma que é completo nem parcial", () => {
    const out = run({ period: OCT, rdMarketing: rdOct(), rdCrm: crmOct(null) });
    expect(codes(get(out, "commercial-activity"))).not.toContain("rd_crm_partial_imported_history");
    expect(find(out, "partial-period")).toBeUndefined();
  });

  it("histórico que começa DEPOIS do fim do período não cobre nada dele — e não gera período invertido", () => {
    const out = run({ period: OCT, rdMarketing: rdOct(), rdCrm: crmOct("2026-12-01") });
    const p = get(out, "partial-period");
    expect(evidence(p, "rd_crm.covered_days")).toMatchObject({
      value: 1,
      period: { start: "2026-10-04", end: "2026-10-04" },
    });
    for (const i of out) for (const e of i.evidence) expect(e.period.start <= e.period.end).toBe(true);
  });
});

describe("uma fonte ausente num período explícito", () => {
  it("RD Marketing sem nenhuma linha em 01–04 → fonte indisponível; GA4 e CRM seguem", () => {
    const out = run({ period: OCT, rdCrm: crmOct() });
    expect(codes(get(out, "source-unavailable"))).toEqual(["rd_marketing_unavailable"]);
    expect(find(out, "traffic-and-rd-conversions")).toBeUndefined();
    expect(evidence(get(out, "commercial-activity"), "rd_crm.won_deals")?.value).toBe(5);
    expect(find(out, "commercial-vs-acquisition")).toBeDefined(); // GA4 + CRM, mesmo período
  });

  it("CRM sem negócio em 01–04 → fonte indisponível", () => {
    const out = run({ period: OCT, rdMarketing: rdOct() });
    expect(codes(get(out, "source-unavailable"))).toEqual(["rd_crm_unavailable"]);
    expect(find(out, "commercial-activity")).toBeUndefined();
  });

  it("um único negócio criado no período já basta para o CRM aparecer", () => {
    const out = run({
      period: OCT,
      rdMarketing: rdOct(),
      rdCrm: makeRdCrm([deal({ dealCreatedAt: "2026-10-03" })], OCT, "2026-04-07"),
    });
    expect(evidence(get(out, "commercial-activity"), "rd_crm.created_deals")?.value).toBe(1);
  });
});
