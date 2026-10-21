import { describe, expect, it } from "vitest";

import {
  EMPTY_TOTALS,
  compareMetric,
  kindLabel,
  metaBreakdown,
  metricValues,
  resultDefinition,
  type Totals,
} from "@/server/campaigns/metrics";

const t = (over: Partial<Totals> = {}): Totals => ({ ...EMPTY_TOTALS, ...over });

describe("resultDefinition", () => {
  it("Google: Conversões da conta; Meta: depende do objetivo", () => {
    expect(resultDefinition("google_ads", null)?.key).toBe("google_conversions");
    expect(resultDefinition("meta_ads", "OUTCOME_LEADS")?.key).toBe("meta_lead");
    expect(resultDefinition("meta_ads", "OUTCOME_SALES")?.key).toBe("meta_purchase");
  });

  it("Meta sem objetivo mapeável → sem resultado (não soma lead com compra)", () => {
    expect(resultDefinition("meta_ads", "OUTCOME_TRAFFIC")).toBeNull();
    expect(resultDefinition("meta_ads", null)).toBeNull();
  });

  it("toda definição diz que não é venda confirmada", () => {
    for (const d of [resultDefinition("google_ads", null), resultDefinition("meta_ads", "OUTCOME_LEADS"), resultDefinition("meta_ads", "OUTCOME_SALES")]) {
      expect(d!.description).toMatch(/não é (venda|lead qualificado)/);
    }
  });
});

describe("metricValues", () => {
  it("razões com denominador zero são null (nunca 0 nem infinito)", () => {
    const v = metricValues(resultDefinition("google_ads", null), t({ cost: 100 }));
    expect(v).toMatchObject({ cost: 100, ctr: null, cpc: null, cpm: null, results: 0, cost_per_result: null });
  });

  it("CTR, CPC, CPM e custo por resultado", () => {
    const v = metricValues(resultDefinition("google_ads", null), t({ cost: 200, impressions: 10_000, clicks: 100, conversions: 4 }));
    expect(v.ctr).toBeCloseTo(0.01);
    expect(v.cpc).toBe(2);
    expect(v.cpm).toBe(20);
    expect(v.cost_per_result).toBe(50);
  });

  it("Meta usa só o evento do objetivo como resultado", () => {
    const v = metricValues(resultDefinition("meta_ads", "OUTCOME_LEADS"), t({ cost: 90, conversions: 10, actions: { lead: 3, purchase: 7 } }));
    expect(v.results).toBe(3);
    expect(v.cost_per_result).toBe(30);
  });

  it("sem totais (nada importado) → tudo null", () => {
    expect(Object.values(metricValues(null, null)).every((x) => x === null)).toBe(true);
  });
});

describe("compareMetric", () => {
  const def = resultDefinition("google_ads", null);
  const base = { platform: "google_ads" as const, def };

  it("variação absoluta e percentual quando comparável", () => {
    const m = compareMetric({ ...base, key: "cost", current: t({ cost: 150 }), previous: t({ cost: 100 }), comparable: true });
    expect(m).toMatchObject({ current: 150, previous: 100, deltaAbs: 50, deltaPct: 0.5 });
  });

  it("não comparável → mostra os dois valores, sem variação", () => {
    const m = compareMetric({ ...base, key: "cost", current: t({ cost: 150 }), previous: t({ cost: 100 }), comparable: false });
    expect(m).toMatchObject({ current: 150, previous: 100, deltaAbs: null, deltaPct: null });
  });

  it("base zero → só variação absoluta, com o motivo", () => {
    const m = compareMetric({ ...base, key: "cost", current: t({ cost: 150 }), previous: t(), comparable: true });
    expect(m).toMatchObject({ deltaAbs: 150, deltaPct: null });
    expect(m.note).toMatch(/Base anterior zero/);
  });

  it("razão indefinida num dos lados → sem variação", () => {
    const m = compareMetric({ ...base, key: "cpc", current: t({ cost: 10, clicks: 5 }), previous: t({ cost: 10 }), comparable: true });
    expect(m).toMatchObject({ current: 2, previous: null, deltaAbs: null, deltaPct: null });
  });

  it("ausência de dado ≠ zero", () => {
    const missing = compareMetric({ ...base, key: "cost", current: null, previous: null, comparable: false });
    const zero = compareMetric({ ...base, key: "cost", current: t(), previous: null, comparable: false });
    expect(missing.current).toBeNull();
    expect(missing.note).toMatch(/Sem dados importados/);
    expect(zero.current).toBe(0);
  });

  it("rótulos respeitam a definição da plataforma", () => {
    const meta = { platform: "meta_ads" as const, def: resultDefinition("meta_ads", "OUTCOME_LEADS"), current: t(), previous: null, comparable: false };
    expect(compareMetric({ ...meta, key: "clicks" }).label).toBe("Cliques no link");
    expect(compareMetric({ ...meta, key: "cost_per_result" }).label).toBe("Custo por lead");
    expect(compareMetric({ ...base, key: "cost_per_result", current: t(), previous: null, comparable: false }).label).toBe("Custo por conversão");
  });
});

describe("metaBreakdown e rótulos", () => {
  it("eventos por tipo, com variação só se comparável", () => {
    const [lead] = metaBreakdown(t({ actions: { lead: 6 } }), t({ actions: { lead: 3 } }), true);
    expect(lead).toMatchObject({ label: "Leads", current: 6, previous: 3, deltaPct: 1 });
  });

  it("código desconhecido sai cru (não é inventado)", () => {
    expect(kindLabel("google_ads", null, "PERFORMANCE_MAX")).toBe("Performance Max");
    expect(kindLabel("google_ads", null, "NOVO_TIPO")).toBe("NOVO_TIPO");
    expect(kindLabel("meta_ads", "OUTCOME_LEADS", null)).toBe("Objetivo: cadastros");
  });
});
