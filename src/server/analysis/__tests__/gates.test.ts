import { describe, expect, it } from "vitest";

import { evaluateGates } from "@/server/analysis/gates";

import { makeContext } from "./fixtures";

const healthy = () =>
  makeContext({
    currentChannels: [
      ["Organic Search", 5000, 150],
      ["Direct", 3000, 90],
      ["Paid Search", 2000, 60],
    ],
    previousChannels: [
      ["Organic Search", 5100, 155],
      ["Direct", 3050, 92],
      ["Paid Search", 2050, 61],
    ],
    distinctDates: 176,
  });

describe("evaluateGates — G0 disponibilidade", () => {
  it("histórico ok -> janelas comparáveis, nada suprimido por G0", () => {
    const g = evaluateGates(healthy());
    expect(g.hasComparableWindows).toBe(true);
  });

  it("cobertura baixa -> suprime tudo + insight insufficient_history", () => {
    const ctx = makeContext({
      currentChannels: [["Organic Search", 5000, 150]],
      previousChannels: [["Organic Search", 5000, 150]],
      distinctDates: 90,
    });
    const g = evaluateGates(ctx);
    expect(g.hasComparableWindows).toBe(false);
    expect(g.suppress.has("traffic")).toBe(true);
    expect(g.suppress.has("conversion")).toBe(true);
    expect(g.dataQualityInsights.map((i) => i.type)).toContain(
      "insufficient_history",
    );
  });

  it("janela atual com poucos dias -> não comparável", () => {
    const ctx = healthy();
    ctx.current.daysWithData = 10;
    expect(evaluateGates(ctx).hasComparableWindows).toBe(false);
  });
});

describe("evaluateGates — G4 qualidade de dados", () => {
  it("sem key events -> suprime 'conversion' + insight no_key_events (não é erro)", () => {
    const ctx = makeContext({
      currentChannels: [
        ["Organic Search", 5000, 0],
        ["Direct", 3000, 0],
      ],
      previousChannels: [
        ["Organic Search", 5100, 0],
        ["Direct", 3050, 0],
      ],
      distinctDates: 176,
    });
    const g = evaluateGates(ctx);
    expect(g.suppress.has("conversion")).toBe(true);
    expect(g.suppress.has("traffic")).toBe(false);
    const dq = g.dataQualityInsights.find((i) => i.type === "no_key_events");
    expect(dq).toBeDefined();
    expect(dq?.kind).toBe("data_quality");
    expect(dq?.severity).toBe("attention"); // atenção, não erro
  });

  it("(not set)/(direct) alto -> suprime 'attribution' + insight", () => {
    const ctx = healthy();
    ctx.notSetDirectSessionShare = 0.55;
    const g = evaluateGates(ctx);
    expect(g.suppress.has("attribution")).toBe(true);
    expect(g.dataQualityInsights.map((i) => i.type)).toContain(
      "high_not_set_share",
    );
  });

  it("buraco de coleta -> insight collection_gap (sem suprimir)", () => {
    const ctx = healthy();
    ctx.zeroDayGap = true;
    const g = evaluateGates(ctx);
    expect(g.dataQualityInsights.map((i) => i.type)).toContain("collection_gap");
    expect(g.suppress.has("traffic")).toBe(false);
  });

  it("healthy -> nenhum insight de data_quality", () => {
    expect(evaluateGates(healthy()).dataQualityInsights).toHaveLength(0);
  });
});
