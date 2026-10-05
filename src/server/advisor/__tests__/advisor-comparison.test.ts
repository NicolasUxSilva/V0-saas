/**
 * Comparação entre períodos — a ÚNICA aritmética do Advisor, feita pelo sistema
 * antes do modelo. "Só deve responder se os dois períodos forem comparáveis; se
 * não forem, não computável — nunca inventar comparação."
 */
import { describe, expect, it } from "vitest";

import { deepFreeze } from "@/server/analysis/__tests__/cross-source-asserts";
import { createMemoryStore } from "@/server/analysis/__tests__/cross-source-store-memory";
import { getCrossSourceInsights } from "@/server/analysis/cross-source-store";

import { COMPARABLE_METRICS, compareAdvisorContexts } from "../comparison";
import { composeAdvisorContext } from "../compose";
import { buildAdvisorContext } from "../context";
import type { AdvisorComparison, AdvisorContext } from "../types";
import {
  NOW,
  OCT,
  OCT_PERIOD,
  SEP,
  SEP_PERIOD,
  WS,
  deal,
  lost,
  makeRdCrm,
  makeRdMarketing,
  octoberContext,
  periodContext,
  persist,
  septemberContext,
  sourcesFrom,
  won,
} from "./advisor-fixtures";

type Ctx = ReturnType<typeof octoberContext>;

async function compare(
  current: Ctx = octoberContext(),
  baseline: Ctx | null = septemberContext(),
  baselinePeriod = SEP_PERIOD,
): Promise<AdvisorComparison> {
  const memory = await persist(current, OCT_PERIOD);
  if (baseline) await persist(baseline, baselinePeriod, memory);
  const c = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: baselinePeriod }, sourcesFrom(memory));
  expect(c.comparison).not.toBeNull();
  return c.comparison!;
}

const item = (cmp: AdvisorComparison, metricId: string) => cmp.items.find((i) => i.metricId === metricId);

describe("comparação — períodos comparáveis", () => {
  it("calcula diferença e variação % a partir dos valores de evidência (outubro × 27–30/09)", async () => {
    const cmp = await compare();
    expect(cmp.status).toBe("computed");
    expect(cmp.reasons).toEqual([]);

    const sessions = item(cmp, "ga4.sessions")!;
    expect([sessions.current, sessions.baseline, sessions.delta]).toEqual([487, 410, 77]);
    expect(sessions.deltaPct).toBeCloseTo(77 / 410, 12);
    expect([sessions.currentDisplay, sessions.baselineDisplay, sessions.deltaDisplay, sessions.deltaPctDisplay]).toEqual([
      "487",
      "410",
      "+77",
      "+18,8%",
    ]);

    expect(item(cmp, "rd_marketing.visits")).toMatchObject({ current: 6, baseline: 4, delta: 2, deltaPctDisplay: "+50,0%" });
    expect(item(cmp, "rd_crm.created_deals")).toMatchObject({ current: 9, baseline: 6, delta: 3, deltaPctDisplay: "+50,0%" });
    expect(item(cmp, "rd_crm.won_deals")).toMatchObject({ current: 5, baseline: 2, delta: 3, deltaPctDisplay: "+150,0%" });
    expect(item(cmp, "rd_crm.lost_deals")).toMatchObject({ current: 14, baseline: 7, delta: 7, deltaPctDisplay: "+100,0%" });
  });

  it("cada item aponta para a evidência de cada período, e a do período-base vem junto", async () => {
    const cmp = await compare();
    for (const i of cmp.items) {
      expect(i.currentRef).toMatch(/@2026-10-01\.\.2026-10-04$/);
      expect(i.baselineRef).toMatch(/@2026-09-27\.\.2026-09-30$/);
    }
    expect(cmp.baselineEvidence.map((e) => e.ref).sort()).toEqual(cmp.items.map((i) => i.baselineRef).sort());
    expect(cmp.baselinePeriod).toEqual({ startDate: SEP.start, endDate: SEP.end, days: 4 });
  });

  it("só métricas permitidas, na ordem fixa — nenhuma taxa, nenhuma razão entre fontes", async () => {
    const cmp = await compare();
    const ids = cmp.items.map((i) => i.metricId);
    for (const id of ids) expect(COMPARABLE_METRICS).toContain(id);
    expect(ids).toEqual(COMPARABLE_METRICS.filter((id) => ids.includes(id)));
    expect(cmp.items.some((i) => i.format === "rate")).toBe(false);
    expect(ids.some((id) => /win_rate|ratio|cac|roas|rate/.test(id))).toBe(false);
  });

  it("variação sobre base ZERO é `null` (nunca Infinity, nunca 0) — e diferença zero continua zero", async () => {
    const cmp = await compare(); // conversões do RD Marketing: 0 × 0; eventos-chave do GA4: 0 × 0
    for (const id of ["rd_marketing.conversions", "ga4.key_events"]) {
      const i = item(cmp, id)!;
      expect(i.baseline).toBe(0);
      expect(i.delta).toBe(0);
      expect(i.deltaPct).toBeNull();
      expect(i.deltaPctDisplay).toBeNull();
    }
    for (const i of cmp.items) {
      expect(Number.isFinite(i.delta)).toBe(true);
      if (i.deltaPct !== null) expect(Number.isFinite(i.deltaPct)).toBe(true);
    }
  });

  it("base zero com atual positivo também não vira infinito", async () => {
    const baseline = septemberContext({ visits: 0 });
    const cmp = await compare(octoberContext(), baseline);
    const visits = item(cmp, "rd_marketing.visits")!;
    expect([visits.current, visits.baseline, visits.delta]).toEqual([6, 0, 6]);
    expect(visits.deltaPct).toBeNull();
  });

  it("queda também funciona: diferença e variação negativas, com o sinal certo", async () => {
    const baseline = septemberContext({ sessions: [200, 210, 195, 205] }); // 810
    const cmp = await compare(octoberContext(), baseline);
    const sessions = item(cmp, "ga4.sessions")!;
    expect(sessions.delta).toBe(487 - 810);
    expect(sessions.deltaDisplay).toBe("−323");
    expect(sessions.deltaPctDisplay).toBe("−39,9%");
  });

  it("valor ganho só é comparado quando TODOS os ganhos dos dois períodos têm valor", async () => {
    // o período-base sem NENHUM ganho com valor: o valor ganho dele não é calculável → pulado
    const none = await compare();
    expect(item(none, "rd_crm.won_value")).toBeUndefined();
    expect(none.skipped.find((s) => s.metricId === "rd_crm.won_value")?.reason).toMatch(/não é calculável/);

    // outubro real (1 de 5 ganhos com valor) contra um período-base também parcial → pulado, com o motivo
    const partialBase = septemberContext({
      crmRows: [
        ...Array.from({ length: 6 }, () => deal({ dealCreatedAt: "2026-09-28" })),
        won({ totalPrice: 500, dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" }),
        won({ dealClosedAt: "2026-09-30", dealCreatedAt: "2026-08-01" }),
        ...Array.from({ length: 7 }, () => lost({ dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" })),
      ],
    });
    const partial = await compare(octoberContext(), partialBase);
    expect(item(partial, "rd_crm.won_value")).toBeUndefined();
    expect(partial.skipped.find((s) => s.metricId === "rd_crm.won_value")?.reason).toMatch(
      /nem todos os negócios ganhos têm valor/,
    );

    // todos com valor nos dois lados → comparado, em valor sem símbolo (moeda não informada)
    const cur = octoberContext({
      rdCrm: makeRdCrm(
        [
          ...Array.from({ length: 9 }, () => deal({ dealCreatedAt: "2026-10-02" })),
          ...Array.from({ length: 5 }, () => won({ totalPrice: 1000, dealClosedAt: "2026-10-01" })),
          ...Array.from({ length: 14 }, () => lost({ dealClosedAt: "2026-10-02" })),
        ],
        OCT,
        "2026-04-07",
      ),
    });
    const base = septemberContext({
      crmRows: [
        ...Array.from({ length: 6 }, () => deal({ dealCreatedAt: "2026-09-28" })),
        ...Array.from({ length: 2 }, () => won({ totalPrice: 1000, dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" })),
        ...Array.from({ length: 7 }, () => lost({ dealClosedAt: "2026-09-29", dealCreatedAt: "2026-08-01" })),
      ],
    });
    const full = await compare(cur, base);
    const value = item(full, "rd_crm.won_value")!;
    expect([value.current, value.baseline, value.delta]).toEqual([5000, 2000, 3000]);
    expect(value.currency).toBeNull();
    expect([value.currentDisplay, value.deltaDisplay, value.deltaPctDisplay]).toEqual(["5.000,00", "+3.000,00", "+150,0%"]);
  });

  it("é determinística e não muta os contextos", async () => {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    await persist(septemberContext(), SEP_PERIOD, memory);
    const deps = sourcesFrom(memory);
    const c = await buildAdvisorContext(WS, OCT_PERIOD, {}, deps);
    const b = await buildAdvisorContext(WS, SEP_PERIOD, {}, deps);
    const frozenC = deepFreeze(structuredClone(c));
    const frozenB = deepFreeze(structuredClone(b));
    const a1 = compareAdvisorContexts(frozenC, frozenB);
    const a2 = compareAdvisorContexts(frozenC, frozenB);
    expect(a1).toEqual(a2);
    expect(a1.status).toBe("computed");
  });
});

describe("comparação — NÃO computável (nunca inventa comparação)", () => {
  const codes = (cmp: AdvisorComparison) => cmp.reasons.map((r) => r.code);

  it("duração diferente: 4 dias × 7 dias não se comparam — o Advisor não normaliza por dia", async () => {
    const sevenDays = { start: "2026-09-24", end: "2026-09-30" };
    const baseline = periodContext({ period: sevenDays, sessionsPerDay: 100, rdMarketing: null, rdCrm: null });
    const cmp = await compare(octoberContext(), baseline, { startDate: sevenDays.start, endDate: sevenDays.end });
    expect(cmp.status).toBe("not_computable");
    expect(codes(cmp)).toEqual(["comparison_not_computable:different_duration"]);
    expect(cmp.reasons[0]?.message).toMatch(/4 e 7 dias/);
    expect(cmp.items).toEqual([]);
    expect(cmp.reasons.every((r) => r.severity === "blocking" && r.origin === "advisor")).toBe(true);
  });

  it("o caso real: outubro (4 dias, 1–4/10) × setembro inteiro (30 dias) não é computável", async () => {
    const fullSeptember = { start: "2026-09-01", end: "2026-09-30" };
    const baseline = periodContext({ period: fullSeptember, sessionsPerDay: 100, rdMarketing: null, rdCrm: null });
    const cmp = await compare(octoberContext(), baseline, { startDate: fullSeptember.start, endDate: fullSeptember.end });
    expect(cmp.status).toBe("not_computable");
    expect(codes(cmp)).toEqual(["comparison_not_computable:different_duration"]);
    expect(cmp.reasons[0]?.message).toMatch(/4 e 30 dias/);
  });

  it("período-base sem Cross-source gerado", async () => {
    const cmp = await compare(octoberContext(), null);
    expect(cmp.status).toBe("not_computable");
    expect(codes(cmp)).toEqual(["comparison_not_computable:baseline_cross_source_missing"]);
    expect(cmp.reasons[0]?.message).toContain("27/09/2026 a 30/09/2026");
  });

  it("período atual sem Cross-source gerado", async () => {
    const memory = await persist(septemberContext(), SEP_PERIOD);
    const c = await buildAdvisorContext(WS, OCT_PERIOD, { comparePeriod: SEP_PERIOD }, sourcesFrom(memory));
    expect(c.comparison?.status).toBe("not_computable");
    expect(c.comparison?.reasons.map((r) => r.code)).toEqual(["comparison_not_computable:current_cross_source_missing"]);
  });

  it("períodos que se sobrepõem, ou com o de comparação DEPOIS do atual", async () => {
    const overlapping = { start: "2026-09-30", end: "2026-10-03" };
    const base = periodContext({ period: overlapping, sessionsPerDay: 100, rdMarketing: null, rdCrm: null });
    const cmp = await compare(octoberContext(), base, { startDate: overlapping.start, endDate: overlapping.end });
    expect(codes(cmp)).toEqual(["comparison_not_computable:periods_overlap"]);

    const after = { start: "2026-10-05", end: "2026-10-08" };
    const later = periodContext({ period: after, sessionsPerDay: 100, rdMarketing: null, rdCrm: null });
    const cmpAfter = await compare(octoberContext(), later, { startDate: after.start, endDate: after.end });
    expect(codes(cmpAfter)).toEqual(["comparison_not_computable:periods_overlap"]);

    // o mesmo período contra si mesmo também não é uma comparação
    const same = await compare(octoberContext(), octoberContext(), OCT_PERIOD);
    expect(codes(same)).toEqual(["comparison_not_computable:periods_overlap"]);
  });

  it("vários motivos se somam — cada um com a sua limitação", async () => {
    const memory = createMemoryStore(); // nenhum dos dois períodos tem Cross-source
    const c = await buildAdvisorContext(
      WS,
      OCT_PERIOD,
      { comparePeriod: { startDate: "2026-09-01", endDate: "2026-09-30" } },
      sourcesFrom(memory),
    );
    expect(c.comparison?.reasons.map((r) => r.code).sort()).toEqual([
      "comparison_not_computable:baseline_cross_source_missing",
      "comparison_not_computable:current_cross_source_missing",
      "comparison_not_computable:different_duration",
    ]);
  });

  it("fonte parcial em um dos períodos: as métricas dela saem, as demais continuam", async () => {
    const baseline = septemberContext();
    // GA4 com só 2 dos 4 dias no período-base
    const partialBase = periodContext({
      period: SEP,
      ga4Days: ["2026-09-27", "2026-09-28"],
      rdMarketing: makeRdMarketing([{ assetId: "a1", visits: 4, conversions: 0 }], { window: SEP, days: 4 }),
      rdCrm: baseline.rdCrm,
    });
    const cmp = await compare(octoberContext(), partialBase);
    expect(cmp.status).toBe("computed");
    expect(cmp.items.some((i) => i.source === "ga4")).toBe(false);
    expect(cmp.skipped.filter((s) => s.metricId.startsWith("ga4."))).not.toHaveLength(0);
    expect(cmp.skipped.find((s) => s.metricId === "ga4.sessions")?.reason).toMatch(/GA4 não cobre o período inteiro/);
    expect(item(cmp, "rd_marketing.visits")).toBeDefined();
    expect(item(cmp, "rd_crm.created_deals")).toBeDefined();
  });

  it("histórico de CRM importado parcial no período-base: o CRM não entra na comparação", async () => {
    const base = septemberContext({ importedHistoryStartDate: "2026-09-29" });
    const cmp = await compare(octoberContext(), base);
    expect(cmp.items.some((i) => i.source === "rd_crm")).toBe(false);
    expect(cmp.skipped.find((s) => s.metricId === "rd_crm.won_deals")?.reason).toMatch(/RD CRM não cobre o período inteiro/);
  });

  it("nenhuma métrica comparável → não computável, com o motivo (e as puladas listadas)", async () => {
    const empty = periodContext({ period: SEP, ga4Days: [], rdMarketing: null, rdCrm: null });
    const cmp = await compare(octoberContext(), empty);
    expect(cmp.status).toBe("not_computable");
    expect(codes(cmp)).toEqual(["comparison_not_computable:no_comparable_metrics"]);
    expect(cmp.items).toEqual([]);
    expect(cmp.skipped.length).toBeGreaterThan(0);
  });
});

describe("comparação — formato e moeda", () => {
  async function composePair(mutate: (stored: Awaited<ReturnType<typeof getCrossSourceInsights>>) => void) {
    const memory = await persist(octoberContext(), OCT_PERIOD);
    await persist(septemberContext(), SEP_PERIOD, memory);
    const cur = await getCrossSourceInsights(WS, OCT_PERIOD, { store: memory.store });
    const baseStored = await getCrossSourceInsights(WS, SEP_PERIOD, { store: memory.store });
    mutate(baseStored);
    const mk = (stored: typeof cur, p: typeof OCT_PERIOD): AdvisorContext =>
      composeAdvisorContext({ workspaceId: WS, period: p, crossSource: stored, diagnostics: [], generatedAt: NOW.toISOString() });
    return compareAdvisorContexts(mk(cur, OCT_PERIOD), mk(baseStored, SEP_PERIOD));
  }

  it("métrica com formato diferente entre os períodos é pulada, não comparada", async () => {
    const cmp = await composePair((s) => {
      for (const i of s.insights) {
        const e = i.evidence.find((x) => x.id === "ga4.sessions");
        if (e) e.format = "rate";
      }
    });
    expect(item(cmp, "ga4.sessions")).toBeUndefined();
    expect(cmp.skipped.find((s) => s.metricId === "ga4.sessions")?.reason).toMatch(/formato ou moeda diferente/);
  });

  it("valor `null` em um dos períodos é pulado — ausência de dado nunca vira zero na conta", async () => {
    const cmp = await composePair((s) => {
      for (const i of s.insights) {
        const e = i.evidence.find((x) => x.id === "rd_marketing.visits");
        if (e) e.value = null;
      }
    });
    expect(item(cmp, "rd_marketing.visits")).toBeUndefined();
    expect(cmp.skipped.find((s) => s.metricId === "rd_marketing.visits")?.reason).toMatch(/não é calculável/);
  });
});
