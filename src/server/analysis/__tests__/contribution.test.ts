import { describe, expect, it } from "vitest";

import {
  decomposeBySegment,
  detectOnset,
  topContributors,
} from "@/server/analysis/contribution";
import type { SegmentTotals } from "@/server/analysis/types";

function seg(key: string, sessions: number): SegmentTotals {
  return {
    key,
    sessions,
    totalUsers: sessions,
    newUsers: sessions,
    engagedSessions: sessions,
    keyEvents: 0,
    conversionValue: 0,
  };
}

describe("decomposeBySegment", () => {
  it("shares somam ~1 e o maior contribuinte é o que mais caiu", () => {
    const previous = [seg("Organic", 5000), seg("Direct", 3000), seg("Paid", 2000)];
    const current = [seg("Organic", 3500), seg("Direct", 2900), seg("Paid", 1950)];
    const d = decomposeBySegment(current, previous, "sessions");

    const totalShare = d.reduce((a, c) => a + c.share, 0);
    expect(totalShare).toBeCloseTo(1, 5);

    expect(d[0]?.key).toBe("Organic");
    // Organic: -1500 de -1650 total
    expect(d[0]?.share).toBeCloseTo(1500 / 1650, 3);
  });

  it("segmento novo (só no atual) entra com previous 0", () => {
    const d = decomposeBySegment([seg("New", 100)], [], "sessions");
    expect(d[0]?.previous).toBe(0);
    expect(d[0]?.delta).toBe(100);
  });
});

describe("topContributors", () => {
  it("retorna os que somam >= 70% da queda, mesma direção", () => {
    const previous = [
      seg("A", 5000),
      seg("B", 3000),
      seg("C", 2000),
      seg("D", 1000),
    ];
    const current = [seg("A", 3500), seg("B", 2900), seg("C", 2100), seg("D", 1050)];
    const d = decomposeBySegment(current, previous, "sessions");
    const top = topContributors(d, 0.7);
    // A caiu 1500; total ~ -1350 (A -1500, B -100, C +100, D +50)
    // só A já passa de 70% -> [A]
    expect(top.map((t) => t.key)).toEqual(["A"]);
  });
});

describe("detectOnset", () => {
  it("acha a data do degrau", () => {
    const daily = [
      ...Array.from({ length: 15 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
        value: 100,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        value: 30,
      })),
    ];
    const onset = detectOnset(daily);
    expect(onset?.date).toBe("2026-08-01");
  });

  it("declínio gradual -> null", () => {
    const daily = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      value: 100 - i, // desce devagar
    }));
    expect(detectOnset(daily)).toBeNull();
  });
});
