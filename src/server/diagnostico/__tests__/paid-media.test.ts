import { describe, expect, it } from "vitest";

import {
  PAID_WINDOW_DAYS,
  composePaidMediaSnapshot,
  paidWindows,
  type PaidWindowTotals,
} from "../paid-media";

const totals = (over: Partial<PaidWindowTotals> = {}): PaidWindowTotals => ({
  cost: 1000,
  impressions: 50_000,
  clicks: 1_500,
  conversions: 30,
  daysWithData: 28,
  ...over,
});

describe("paidWindows", () => {
  it("28 dias terminando no último dia com dado, e os 28 imediatamente anteriores", () => {
    expect(PAID_WINDOW_DAYS).toBe(28);
    expect(paidWindows("2026-10-07")).toEqual({
      current: { start: "2026-09-10", end: "2026-10-07" },
      previous: { start: "2026-08-13", end: "2026-09-09" },
    });
  });

  it("sem sobreposição nem lacuna entre as duas janelas", () => {
    const w = paidWindows("2026-03-01"); // atravessa fevereiro
    const prevEnd = new Date(`${w.previous.end}T00:00:00Z`).getTime();
    const curStart = new Date(`${w.current.start}T00:00:00Z`).getTime();
    expect(curStart - prevEnd).toBe(86_400_000);
  });
});

describe("composePaidMediaSnapshot", () => {
  const base = { platform: "google_ads" as const, lastDate: "2026-10-07", currency: "BRL" };

  it("quatro métricas da PRÓPRIA plataforma, com atual, anterior e variação", () => {
    const s = composePaidMediaSnapshot({
      ...base,
      current: totals({ cost: 1200, clicks: 1_800, conversions: 36 }),
      previous: totals({ cost: 1000, clicks: 1_500, conversions: 30 }),
    })!;
    expect(s).toMatchObject({
      platform: "google_ads",
      label: "Google Ads",
      currency: "BRL",
      window: { start: "2026-09-10", end: "2026-10-07" },
      comparedTo: { start: "2026-08-13", end: "2026-09-09" },
      daysWithData: 28,
    });
    expect(s.metrics.map((m) => m.key)).toEqual(["cost", "impressions", "clicks", "conversions"]);
    const cost = s.metrics[0]!;
    expect([cost.current, cost.previous, cost.format]).toEqual([1200, 1000, "currency"]);
    expect(cost.deltaPct).toBeCloseTo(0.2, 12);
    expect(s.metrics.find((m) => m.key === "conversions")?.label).toBe("Conversões (da plataforma)");
  });

  it("Meta Ads: o clique é o clique NO LINK", () => {
    const s = composePaidMediaSnapshot({ ...base, platform: "meta_ads", current: totals(), previous: null })!;
    expect(s.label).toBe("Meta Ads");
    expect(s.metrics.find((m) => m.key === "clicks")?.label).toBe("Cliques no link");
  });

  it("sem janela anterior com dados: nada é comparado — previous e variação são null, não 0", () => {
    const s = composePaidMediaSnapshot({
      ...base,
      current: totals(),
      previous: totals({ daysWithData: 0, cost: 0, impressions: 0, clicks: 0, conversions: 0 }),
    })!;
    expect(s.comparedTo).toBeNull();
    for (const m of s.metrics) {
      expect(m.previous).toBeNull();
      expect(m.deltaPct).toBeNull();
    }
    expect(composePaidMediaSnapshot({ ...base, current: totals(), previous: null })!.comparedTo).toBeNull();
  });

  it("base zero com janela anterior que existe: variação não calculável (null), nunca infinito", () => {
    const s = composePaidMediaSnapshot({
      ...base,
      current: totals({ conversions: 5 }),
      previous: totals({ conversions: 0, daysWithData: 10 }),
    })!;
    const conv = s.metrics.find((m) => m.key === "conversions")!;
    expect(conv.previous).toBe(0);
    expect(conv.deltaPct).toBeNull();
    for (const m of s.metrics) expect(m.deltaPct === null || Number.isFinite(m.deltaPct)).toBe(true);
  });

  it("queda aparece como variação negativa", () => {
    const s = composePaidMediaSnapshot({
      ...base,
      current: totals({ cost: 500 }),
      previous: totals({ cost: 1000 }),
    })!;
    expect(s.metrics[0]!.deltaPct).toBe(-0.5);
  });

  it("sem nenhum dia com dado na janela atual, não há cartão", () => {
    expect(composePaidMediaSnapshot({ ...base, current: totals({ daysWithData: 0 }), previous: null })).toBeNull();
  });

  it("moeda ausente fica null (nunca BRL) e ruído de ponto flutuante é arredondado", () => {
    const s = composePaidMediaSnapshot({
      ...base,
      currency: null,
      current: totals({ cost: 0.1 + 0.2 }),
      previous: null,
    })!;
    expect(s.currency).toBeNull();
    expect(s.metrics[0]!.current).toBe(0.3);
  });

  it("não carrega nome de campanha nem identificador: só agregados da plataforma", () => {
    const text = JSON.stringify(
      composePaidMediaSnapshot({ ...base, current: totals(), previous: totals() }),
    );
    expect(text).not.toMatch(/campaign|campanha|"act_/i);
  });
});
