/**
 * Testes do período da análise (V1.1): validação do período explícito e
 * planejamento das janelas. Tudo puro — nenhum banco, nenhum relógio (a "data de
 * hoje" entra como argumento).
 */
import { describe, expect, it } from "vitest";

import { addDays } from "@/lib/dates";
import {
  AnalysisPeriodError,
  BASELINE_DAYS,
  HISTORY_DAYS,
  MAX_PERIOD_DAYS,
  WINDOW_DAYS,
  inclusiveDays,
  isIsoDate,
  planWindows,
  resolveWindowPlan,
  validateAnalysisPeriod,
} from "@/server/analysis/period";

describe("isIsoDate / inclusiveDays", () => {
  it("aceita datas reais e rejeita formato, calendário e tipo inválidos", () => {
    expect(isIsoDate("2026-10-04")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true); // bissexto
    for (const bad of ["2026-02-30", "2026-13-01", "2027-02-29", "04/10/2026", "2026-1-4", "", "2026-10-04T00:00:00Z"]) {
      expect(isIsoDate(bad), bad).toBe(false);
    }
    for (const bad of [null, undefined, 20261004, {}, []]) expect(isIsoDate(bad)).toBe(false);
  });

  it("conta os dias do intervalo, inclusive nas duas pontas", () => {
    expect(inclusiveDays("2026-10-01", "2026-10-04")).toBe(4);
    expect(inclusiveDays("2026-10-04", "2026-10-04")).toBe(1);
    expect(inclusiveDays("2026-09-05", "2026-10-02")).toBe(28);
    expect(inclusiveDays("2026-10-04", "2026-10-01")).toBe(0); // invertido
    expect(inclusiveDays("x", "2026-10-01")).toBe(0);
  });
});

describe("validateAnalysisPeriod — período explícito", () => {
  it("devolve o período normalizado com a quantidade de dias", () => {
    expect(validateAnalysisPeriod({ startDate: "2026-10-01", endDate: "2026-10-04" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-04",
      days: 4,
    });
    expect(validateAnalysisPeriod({ startDate: "2026-10-04", endDate: "2026-10-04" }).days).toBe(1);
  });

  it("rejeita formato inválido, data inexistente e campos ausentes", () => {
    const bad = [
      { startDate: "01/10/2026", endDate: "2026-10-04" },
      { startDate: "2026-02-30", endDate: "2026-03-04" },
      { startDate: "2026-10-01", endDate: "" },
      {} as never,
      undefined as never,
    ];
    for (const input of bad) {
      expect(() => validateAnalysisPeriod(input)).toThrow(AnalysisPeriodError);
      expect(() => validateAnalysisPeriod(input)).toThrow(/YYYY-MM-DD/);
    }
  });

  it("rejeita início posterior ao fim", () => {
    expect(() => validateAnalysisPeriod({ startDate: "2026-10-05", endDate: "2026-10-04" })).toThrow(
      /startDate \(2026-10-05\) é posterior a endDate \(2026-10-04\)/,
    );
  });

  it(`aceita até ${MAX_PERIOD_DAYS} dias e rejeita mais que isso`, () => {
    expect(validateAnalysisPeriod({ startDate: "2025-10-04", endDate: "2026-10-04" }).days).toBe(366);
    expect(() => validateAnalysisPeriod({ startDate: "2025-10-03", endDate: "2026-10-04" })).toThrow(
      /367 dias excede o máximo de 366/,
    );
  });

  it("o erro é um AnalysisPeriodError reconhecível", () => {
    try {
      validateAnalysisPeriod({ startDate: "x", endDate: "y" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisPeriodError);
      expect((e as Error).name).toBe("AnalysisPeriodError");
    }
  });
});

describe("planWindows — todas as datas lidas, a partir de UM fim e UM tamanho", () => {
  it("janela padrão de 28 dias: bate com as janelas do contexto real do piloto", () => {
    // valores observados no AnalysisContext real em 2026-10-04 (analysisEnd = 2026-10-02)
    expect(planWindows("2026-10-02", WINDOW_DAYS)).toEqual({
      periodStart: "2026-09-05",
      analysisEnd: "2026-10-02",
      windowDays: 28,
      previousStart: "2026-08-08",
      previousEnd: "2026-09-04",
      baselineStart: "2026-04-10",
      baselineEnd: "2026-08-07",
      historyStart: "2026-04-06",
    });
  });

  it("período de 4 dias (01–04/10): previous tem 4 dias, baseline segue com 120", () => {
    const plan = planWindows("2026-10-04", 4);
    expect(plan).toMatchObject({
      periodStart: "2026-10-01",
      analysisEnd: "2026-10-04",
      windowDays: 4,
      previousStart: "2026-09-27",
      previousEnd: "2026-09-30",
      baselineEnd: "2026-09-26",
      baselineStart: "2026-05-30",
      historyStart: "2026-04-08",
    });
    expect(inclusiveDays(plan.baselineStart, plan.baselineEnd)).toBe(BASELINE_DAYS);
    expect(inclusiveDays(plan.historyStart, plan.analysisEnd)).toBe(HISTORY_DAYS);
  });

  it("período de 1 dia: current e previous têm 1 dia cada", () => {
    expect(planWindows("2026-10-04", 1)).toMatchObject({
      periodStart: "2026-10-04",
      previousStart: "2026-10-03",
      previousEnd: "2026-10-03",
    });
  });

  it("as janelas são contíguas e não se sobrepõem (previous termina na véspera do current)", () => {
    for (const days of [1, 4, 28, 31, 90]) {
      const p = planWindows("2026-10-04", days);
      expect(addDays(p.previousEnd, 1)).toBe(p.periodStart);
      expect(addDays(p.baselineEnd, 1)).toBe(p.previousStart);
      expect(inclusiveDays(p.periodStart, p.analysisEnd)).toBe(days);
      expect(inclusiveDays(p.previousStart, p.previousEnd)).toBe(days);
    }
  });
});

describe("resolveWindowPlan — modo padrão (comportamento histórico, intocado)", () => {
  /** A fórmula ORIGINAL de `buildAnalysisContext`, antes da parametrização. */
  function original(naturalEnd: string, lastDate: string) {
    const analysisEnd = naturalEnd < lastDate ? naturalEnd : lastDate;
    const currentStart = addDays(analysisEnd, -(28 - 1));
    const previousEnd = addDays(currentStart, -1);
    const previousStart = addDays(previousEnd, -(28 - 1));
    const baselineEnd = addDays(previousStart, -1);
    const baselineStart = addDays(baselineEnd, -(120 - 1));
    const historyStart = addDays(analysisEnd, -(180 - 1));
    return { currentStart, analysisEnd, previousStart, previousEnd, baselineStart, baselineEnd, historyStart };
  }

  it("produz exatamente as mesmas datas que a fórmula original, em várias combinações", () => {
    const naturals = ["2026-01-31", "2026-03-01", "2026-08-28", "2026-10-02", "2028-02-29"];
    const lasts = ["2025-12-15", "2026-03-01", "2026-09-25", "2026-10-04", "2030-01-01"];
    let combos = 0;
    for (const naturalEnd of naturals) {
      for (const lastDate of lasts) {
        const { plan, expectedLastDate } = resolveWindowPlan(undefined, {
          naturalEnd,
          lastDate,
          today: addDays(naturalEnd, 2),
        });
        const o = original(naturalEnd, lastDate);
        expect(
          {
            currentStart: plan.periodStart,
            analysisEnd: plan.analysisEnd,
            previousStart: plan.previousStart,
            previousEnd: plan.previousEnd,
            baselineStart: plan.baselineStart,
            baselineEnd: plan.baselineEnd,
            historyStart: plan.historyStart,
          },
          `${naturalEnd} / ${lastDate}`,
        ).toEqual(o);
        expect(plan.windowDays).toBe(28);
        expect(expectedLastDate).toBe(naturalEnd);
        combos += 1;
      }
    }
    expect(combos).toBe(25);
  });

  it("GA4 em dia: a janela termina em hoje − 2", () => {
    const { plan } = resolveWindowPlan(undefined, {
      naturalEnd: "2026-10-02",
      lastDate: "2026-10-04",
      today: "2026-10-04",
    });
    expect(plan.analysisEnd).toBe("2026-10-02");
  });

  it("GA4 atrasado: o fim ENCOLHE até o último dia do GA4, e o esperado continua sendo hoje − 2", () => {
    const { plan, expectedLastDate } = resolveWindowPlan(undefined, {
      naturalEnd: "2026-10-02",
      lastDate: "2026-09-25",
      today: "2026-10-04",
    });
    expect(plan.analysisEnd).toBe("2026-09-25"); // comportamento histórico (o que os detectors veem)
    expect(expectedLastDate).toBe("2026-10-02"); // é assim que o atraso fica visível
  });

  it("o modo padrão nunca valida nem usa `today`", () => {
    expect(() =>
      resolveWindowPlan(undefined, { naturalEnd: "2026-10-02", lastDate: "2026-10-04", today: "1999-01-01" }),
    ).not.toThrow();
  });
});

describe("resolveWindowPlan — período explícito", () => {
  const ref = { naturalEnd: "2026-10-02", lastDate: "2026-10-04", today: "2026-10-04" };

  it("a janela é exatamente o período pedido (01–04/10)", () => {
    const { plan, expectedLastDate } = resolveWindowPlan({ startDate: "2026-10-01", endDate: "2026-10-04" }, ref);
    expect(plan.periodStart).toBe("2026-10-01");
    expect(plan.analysisEnd).toBe("2026-10-04"); // NÃO é hoje − 2
    expect(plan.windowDays).toBe(4);
    expect(expectedLastDate).toBe("2026-10-04");
  });

  it("NÃO encolhe o fim quando o GA4 não tem dados até lá — o período pedido é o pedido", () => {
    const { plan, expectedLastDate } = resolveWindowPlan(
      { startDate: "2026-10-01", endDate: "2026-10-04" },
      { ...ref, lastDate: "2026-10-02" }, // GA4 só tem até 02/10
    );
    expect(plan.analysisEnd).toBe("2026-10-04");
    expect(expectedLastDate).toBe("2026-10-04"); // lastDate < expected = GA4 atrasado
  });

  it("aceita um período inteiramente no passado e um que termina hoje", () => {
    expect(resolveWindowPlan({ startDate: "2026-03-01", endDate: "2026-03-31" }, ref).plan.windowDays).toBe(31);
    expect(resolveWindowPlan({ startDate: "2026-10-04", endDate: "2026-10-04" }, ref).plan.windowDays).toBe(1);
  });

  it("rejeita fim no futuro", () => {
    expect(() => resolveWindowPlan({ startDate: "2026-10-01", endDate: "2026-10-05" }, ref)).toThrow(
      /endDate \(2026-10-05\) está no futuro \(hoje é 2026-10-04\)/,
    );
  });

  it("rejeita período inválido com o mesmo erro tipado", () => {
    expect(() => resolveWindowPlan({ startDate: "2026-10-04", endDate: "2026-10-01" }, ref)).toThrow(
      AnalysisPeriodError,
    );
  });
});
