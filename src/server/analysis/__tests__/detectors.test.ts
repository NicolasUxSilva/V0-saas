import { describe, expect, it } from "vitest";

import {
  detectConversionEfficiencyDrop,
  detectDataQuality,
  detectTrafficVolumeDrop,
} from "@/server/analysis/detectors";
import { evaluateGates } from "@/server/analysis/gates";
import { priorityScore } from "@/server/analysis/scoring";

import { makeContext } from "./fixtures";

describe("detectTrafficVolumeDrop", () => {
  it("queda grande e concentrada -> 1 insight, canal responsável certo", () => {
    const ctx = makeContext({
      // ~140/dia baseline; atual cai forte, puxado por Organic Search
      baselineDailyMean: 350,
      currentChannels: [
        ["Organic Search", 2000],
        ["Direct", 2800],
        ["Paid Search", 2000],
      ],
      previousChannels: [
        ["Organic Search", 5200],
        ["Direct", 2900],
        ["Paid Search", 2050],
      ],
      onsetChannel: "Organic Search",
      onsetDate: "2026-08-10",
      distinctDates: 176,
    });
    const gates = evaluateGates(ctx);
    const out = detectTrafficVolumeDrop(ctx, gates);

    expect(out).toHaveLength(1);
    const i = out[0]!;
    expect(i.detector).toBe("traffic-volume-drop");
    expect(i.kind).toBe("problem");
    expect(i.responsibleDimension?.value).toBe("Organic Search");
    expect(i.impact?.unit).toBe("sessions");
    expect(i.impact?.value).toBeGreaterThan(300);
    expect(i.evidence.deltaPct).toBeLessThan(-0.1);
    // onset foi detectado -> aparece no texto
    expect(i.hypothesis).toContain("Organic Search");
    expect(["alta", "media"]).toContain(i.confidence);
    // scoring produz nota plausível
    const score = priorityScore(i, "2026-08-10");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("tráfego estável -> nenhum insight", () => {
    const ctx = makeContext({
      baselineDailyMean: 360,
      currentChannels: [
        ["Organic Search", 5000],
        ["Direct", 3000],
        ["Paid Search", 2000],
      ],
      previousChannels: [
        ["Organic Search", 5050],
        ["Direct", 3020],
        ["Paid Search", 1990],
      ],
      distinctDates: 176,
    });
    expect(detectTrafficVolumeDrop(ctx, evaluateGates(ctx))).toHaveLength(0);
  });

  it("queda pequena (< 10%) -> nenhum insight (materialidade)", () => {
    const ctx = makeContext({
      baselineDailyMean: 360,
      currentChannels: [["Organic Search", 9400], ["Direct", 200]],
      previousChannels: [["Organic Search", 10000], ["Direct", 200]],
      distinctDates: 176,
    });
    expect(detectTrafficVolumeDrop(ctx, evaluateGates(ctx))).toHaveLength(0);
  });

  it("volume abaixo do mínimo -> nenhum insight (G1)", () => {
    const ctx = makeContext({
      baselineDailyMean: 10,
      currentChannels: [["Organic Search", 120]],
      previousChannels: [["Organic Search", 300]],
      distinctDates: 176,
    });
    expect(detectTrafficVolumeDrop(ctx, evaluateGates(ctx))).toHaveLength(0);
  });
});

describe("detectConversionEfficiencyDrop", () => {
  it("sem key events -> suprimido, nenhum insight", () => {
    const ctx = makeContext({
      currentChannels: [["Organic Search", 5000, 0]],
      previousChannels: [["Organic Search", 5100, 0]],
      distinctDates: 176,
    });
    const gates = evaluateGates(ctx);
    expect(gates.suppress.has("conversion")).toBe(true);
    expect(detectConversionEfficiencyDrop(ctx, gates)).toHaveLength(0);
  });

  it("queda de taxa significativa -> 1 insight de problema", () => {
    const ctx = makeContext({
      currentChannels: [
        ["Organic Search", 47000, 987], // 2,1%
        ["Direct", 10000, 400],
      ],
      previousChannels: [
        ["Organic Search", 48000, 1632], // 3,4%
        ["Direct", 10000, 410],
      ],
      distinctDates: 176,
    });
    const out = detectConversionEfficiencyDrop(ctx, evaluateGates(ctx));
    expect(out).toHaveLength(1);
    expect(out[0]!.detector).toBe("conversion-efficiency-drop");
    expect(out[0]!.impact?.unit).toBe("conversions");
    expect(out[0]!.evidence.test).toContain("z de 2 proporções");
  });
});

describe("detectDataQuality", () => {
  it("repassa os insights dos gates", () => {
    const ctx = makeContext({
      currentChannels: [["Organic Search", 5000, 0]],
      previousChannels: [["Organic Search", 5000, 0]],
      distinctDates: 176,
    });
    const gates = evaluateGates(ctx);
    const dq = detectDataQuality(ctx, gates);
    expect(dq.length).toBeGreaterThan(0);
    expect(dq.every((i) => i.kind === "data_quality")).toBe(true);
  });
});
