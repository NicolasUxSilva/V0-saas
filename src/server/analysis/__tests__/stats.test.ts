import { describe, expect, it } from "vitest";

import {
  changePoint,
  deseasonalize,
  mad,
  mean,
  median,
  normalCdf,
  robustZOfMean,
  twoProportionZTest,
  twoTailedP,
  weekdayProfile,
} from "@/server/analysis/stats";

/** série diária com sazonalidade semanal: dias úteis ~240, fim de semana ~40 */
function seasonalSeries(
  weeks: number,
  weekday: number,
  weekend: number,
  startISO = "2026-01-05", // uma segunda-feira
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dow = d.getUTCDay();
    const base = dow === 0 || dow === 6 ? weekend : weekday;
    out.push({
      date: d.toISOString().slice(0, 10),
      value: base + (i % 3) - 1, // ruído ±1
    });
  }
  return out;
}

describe("estatística básica", () => {
  it("mean / median / mad", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(mad([1, 1, 1, 1])).toBe(0);
    expect(mad([1, 2, 3, 4, 5])).toBe(1); // desvios: 2,1,0,1,2 -> mediana 1
  });

  it("normalCdf aproxima Φ", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("twoTailedP: z=1.96 -> p≈0.05", () => {
    expect(twoTailedP(1.96)).toBeCloseTo(0.05, 2);
    expect(twoTailedP(0)).toBeCloseTo(1, 3);
  });
});

describe("twoProportionZTest", () => {
  it("proporções iguais -> z≈0, p≈1", () => {
    const r = twoProportionZTest(50, 1000, 100, 2000);
    expect(Math.abs(r.z)).toBeLessThan(0.001);
    expect(r.p).toBeGreaterThan(0.99);
  });

  it("queda de 3.4% para 2.1% em amostras grandes é significativa", () => {
    // ~1600 conv / 47000 sess vs ~2000 / 58000
    const r = twoProportionZTest(987, 47000, 1972, 58000);
    expect(r.z).toBeLessThan(-4); // p1 < p2 -> z negativo
    expect(r.p).toBeLessThan(0.001);
  });

  it("n=0 não quebra", () => {
    const r = twoProportionZTest(0, 0, 10, 100);
    expect(r.z).toBe(0);
    expect(r.p).toBe(1);
  });
});

describe("robustZOfMean", () => {
  it("amostra na média do baseline -> z≈0", () => {
    const baseline = Array.from({ length: 100 }, (_, i) => 1000 + ((i % 5) - 2) * 10);
    const sample = Array.from({ length: 28 }, () => 1000);
    const r = robustZOfMean(sample, baseline);
    expect(Math.abs(r.z)).toBeLessThan(1);
  });

  it("queda forte -> z bem negativo", () => {
    const baseline = Array.from({ length: 100 }, (_, i) => 1000 + ((i % 5) - 2) * 10);
    const sample = Array.from({ length: 28 }, () => 600);
    const r = robustZOfMean(sample, baseline);
    expect(r.z).toBeLessThan(-5);
  });

  it("sigma 0 (baseline constante) -> z 0, sem NaN", () => {
    const r = robustZOfMean([500], Array(50).fill(1000));
    expect(r.z).toBe(0);
    expect(Number.isNaN(r.z)).toBe(false);
  });
});

describe("weekdayProfile / deseasonalize (D1 #4)", () => {
  it("perfil: fim de semana com fator baixo, dia útil ~1", () => {
    const s = seasonalSeries(12, 240, 40);
    const p = weekdayProfile(s);
    expect(p).toHaveLength(7);
    // domingo (0) e sábado (6) bem abaixo de 1
    expect(p[0]).toBeLessThan(0.5);
    expect(p[6]).toBeLessThan(0.5);
    // terça (2) perto de 1
    expect(p[2]).toBeGreaterThan(0.9);
    expect(p[2]).toBeLessThan(1.1);
  });

  it("deseasonalize aproxima fim de semana e dia útil (de ~6x para ~1x)", () => {
    const s = seasonalSeries(12, 240, 40);
    const p = weekdayProfile(s);
    const adj = deseasonalize(s, p);
    const isWeekend = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
      return d === 0 || d === 6;
    };
    const wkndAdj = adj.filter((x) => isWeekend(x.date)).map((x) => x.value);
    const wkdayAdj = adj.filter((x) => !isWeekend(x.date)).map((x) => x.value);
    // antes: dia útil / fim de semana ≈ 6. depois: perto de 1.
    const ratioAdj = median(wkdayAdj) / median(wkndAdj);
    expect(ratioAdj).toBeGreaterThan(0.7);
    expect(ratioAdj).toBeLessThan(1.4);
  });

  it("série sem sazonalidade -> fatores ~1, deseasonalize é quase no-op", () => {
    const flat = Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10),
      value: 100 + (i % 4),
    }));
    const p = weekdayProfile(flat);
    for (const f of p) expect(Math.abs(f - 1)).toBeLessThan(0.1);
  });

  it("poucas amostras por dia da semana -> fator 1 (fallback)", () => {
    const short = seasonalSeries(2, 240, 40); // só 2 de cada dia da semana
    const p = weekdayProfile(short, 4);
    expect(p.every((f) => f === 1)).toBe(true);
  });

  it("remove o viés de sazonalidade no z (queda real de ~10%)", () => {
    // baseline sazonal estável; janela atual = mesma sazonalidade -10%
    const baseline = seasonalSeries(16, 240, 40).map((x) => x.value);
    const baselineDated = seasonalSeries(16, 240, 40);
    const currentDated = seasonalSeries(4, 240, 40, "2026-05-04").map((x) => ({
      date: x.date,
      value: x.value * 0.9,
    }));
    const profile = weekdayProfile(baselineDated);
    const baseAdj = deseasonalize(baselineDated, profile).map((x) => x.value);
    const curAdj = deseasonalize(currentDated, profile).map((x) => x.value);

    const raw = robustZOfMean(
      currentDated.map((x) => x.value),
      baseline,
    );
    const des = robustZOfMean(curAdj, baseAdj);
    // ambos detectam queda (z negativo), mas não são idênticos
    expect(raw.z).toBeLessThan(0);
    expect(des.z).toBeLessThan(0);
    expect(des.z).not.toBeCloseTo(raw.z, 1);
  });
});

describe("changePoint", () => {
  it("detecta degrau claro", () => {
    const series = [
      ...Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, value: 100 })),
      ...Array.from({ length: 20 }, (_, i) => ({ date: `d${20 + i}`, value: 40 })),
    ];
    const cp = changePoint(series, { minSegment: 5, minT: 3 });
    expect(cp).not.toBeNull();
    expect(cp?.date).toBe("d20");
  });

  it("série plana -> null (sem quebra)", () => {
    const series = Array.from({ length: 40 }, (_, i) => ({
      date: `d${i}`,
      value: 100 + (i % 3),
    }));
    expect(changePoint(series, { minSegment: 5, minT: 3 })).toBeNull();
  });

  it("série curta -> null", () => {
    expect(changePoint([{ date: "a", value: 1 }])).toBeNull();
  });
});
